import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REFACTOR_PROPOSAL_SCHEMA_VERSION,
  REFACTOR_REQUEST_SCHEMA_VERSION,
  moduleStatisticsSnapshotInvariantIssues,
  refactorProposalDigest,
  refactorScanInvariantIssues,
  type JsonEnvelope,
  type ModuleStatisticsSnapshotV1,
  type RefactorAssessmentV1,
  type RefactorProposalV1,
  type RefactorRequestV1
} from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { readTrackedSourceFiles } from "@archcontext/local-runtime/git-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { REPOSITORY_REFACTOR_REQUEST, refactorRequestId } from "../src/refactor-scan";
import { ArchctxRuntimeRpcServer, RuntimeRpcClient, createStartedDaemon } from "../src/index";

const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-refactor-scan-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

const roots: string[] = [];

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const root of [...roots, STATE_ROOT]) rmSync(root, { recursive: true, force: true });
});

const OWNED_FILE = "src/owned.ts";
const UNTRACKED_FILE = "src/never-committed.ts";
const EXTRA_FILE = "src/extra.ts";
const OWNER_NODE_ID = "module.refactor-scan-fixture";
const MOVED_FILE = "src/moved-underneath.ts";
const COMMITTER_DATE = "2026-04-05T06:07:08+00:00";
const SECOND_COMMITTER_DATE = "2026-04-06T06:07:08+00:00";
const THIRD_COMMITTER_DATE = "2026-04-07T06:07:08+00:00";

/**
 * Moves the tree from inside the daemon's own call graph. The ledger replay runs after a scan has
 * captured the worktree identity and before it materializes any input, and after a record has
 * validated the registered identity and before it appends: exactly the two windows a
 * time-of-check/time-of-use check has to close, and the only ones a test can enter honestly.
 */
class MutatingReplayLocalStore extends TestLocalStore {
  mutateOnNextReplay: (() => void) | undefined;

  override async replayArchitectureLedger(input: Parameters<TestLocalStore["replayArchitectureLedger"]>[0]) {
    const mutate = this.mutateOnNextReplay;
    this.mutateOnNextReplay = undefined;
    mutate?.();
    return super.replayArchitectureLedger(input);
  }
}

/** Reads the in-process registry a scan writes; nothing else can prove a scan registered nothing. */
function registeredAssessmentCount(daemon: unknown): number {
  return (daemon as { refactorAssessments: { size: number } }).refactorAssessments.size;
}

/** Commits everything currently in the tree at a fixed committer date. */
function commitFixture(root: string, message: string, committerDate: string): void {
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=ArchContext Test",
      "-c",
      "user.email=archcontext@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      message,
      "--date",
      committerDate
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_COMMITTER_DATE: committerDate }
    }
  );
}

/** A committed repository with one declared module that owns exactly `src/**`. */
function createFixtureRepo(options: { withModel?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-refactor-scan-"));
  roots.push(root);
  writeFileSync(join(root, "README.md"), "# refactor scan fixture\n", "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, OWNED_FILE), "export const owned = 1;\n", "utf8");
  if (options.withModel !== false) {
    initializeArchContextModel(root, "Refactor Scan App");
    writeFileSync(
      join(root, ".archcontext/model/nodes", `${OWNER_NODE_ID}.yaml`),
      [
        `id: "${OWNER_NODE_ID}"`,
        'kind: "module"',
        'name: "Refactor Scan Fixture"',
        'schemaVersion: "archcontext.node/v2"',
        "source:",
        "  include:",
        '    - "src/**"',
        'status: "active"',
        'summary: "Owns the fixture source tree."',
        ""
      ].join("\n"),
      "utf8"
    );
  }
  execFileSync("git", ["init"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  commitFixture(root, "fixture", COMMITTER_DATE);
  // The daemon must not observe the file the proposal names as missing for the wrong reason.
  writeFileSync(join(root, UNTRACKED_FILE), "export const never = 1;\n", "utf8");
  rmSync(join(root, UNTRACKED_FILE));
  return root;
}

/** The daemon clock is deliberately far from the commit date, so a clock read is visible. */
function startDaemon(store: TestLocalStore) {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: store,
    clock: () => "2026-12-31T23:59:59.000Z"
  });
}

function proposalFor(scopePaths: string[]): RefactorProposalV1 {
  const authored: RefactorProposalV1 = {
    schemaVersion: REFACTOR_PROPOSAL_SCHEMA_VERSION,
    authoredBy: { kind: "subagent", id: "agent.refactor-planner", source: "subagent" },
    intent: "Collapse the fixture module boundary.",
    scopePaths,
    targetOutcomes: [],
    killList: [],
    proposalDigest: ""
  };
  return { ...authored, proposalDigest: refactorProposalDigest(authored) };
}

function scanData(envelope: JsonEnvelope): {
  requestId: string;
  trackedFileCount: number;
  worktree: { headSha: string; worktreeDigest: string };
  snapshot: ModuleStatisticsSnapshotV1;
  assessment: RefactorAssessmentV1;
  proposal?: RefactorProposalV1;
  proposedRecommendations: { recommendationId: string }[];
} {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  return envelope.data as never;
}

function errorOf(envelope: JsonEnvelope): { code: string; message: string } {
  return (envelope as { error?: { code: string; message: string } }).error!;
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function suppressionReasons(envelope: JsonEnvelope): string[] {
  return ((envelope.data as { suppressed?: { reasonCode: string }[] }).suppressed ?? []).map((entry) => entry.reasonCode);
}

describe("daemon refactorScan", () => {
  test("measures the repository and returns a contract-valid scan envelope", async () => {
    const root = createFixtureRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const envelope = await daemon.refactorScan(root);
      const data = scanData(envelope);

      expect(data.snapshot.schemaVersion).toBe("archcontext.module-statistics/v1");
      expect(moduleStatisticsSnapshotInvariantIssues(data.snapshot)).toEqual([]);
      expect(refactorScanInvariantIssues({ snapshot: data.snapshot, assessment: data.assessment })).toEqual([]);
      expect(data.assessment.statisticsSnapshotDigest).toBe(data.snapshot.snapshotDigest);
      expect(data.assessment.requestId).toBe(refactorRequestId(REPOSITORY_REFACTOR_REQUEST));
      expect(data.requestId).toBe(data.assessment.requestId);
      // No index in the fixture, so nothing attested this tree and the builder must say so.
      expect(data.snapshot.codeFacts).toMatchObject({ coverage: "unknown", indexedWorktreeDigest: null, truncated: true });
      expect(data.snapshot.modules.map((module) => module.nodeId)).toContain(OWNER_NODE_ID);
      expect(data.trackedFileCount).toBe(readTrackedSourceFiles(root).length);
      expect(data.proposal).toBeUndefined();
    } finally {
      await daemon.stop();
    }
  });

  test("dates both measurements by the HEAD committer date, never the daemon clock", async () => {
    const root = createFixtureRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const data = scanData(await daemon.refactorScan(root));
      expect(data.snapshot.createdAt).toBe("2026-04-05T06:07:08.000Z");
      expect(data.assessment.createdAt).toBe("2026-04-05T06:07:08.000Z");
    } finally {
      await daemon.stop();
    }
  });

  test("two scans at the same HEAD are byte-identical", async () => {
    const root = createFixtureRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const first = await daemon.refactorScan(root);
      const second = await daemon.refactorScan(root);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    } finally {
      await daemon.stop();
    }
  });

  test("registers the measurement so refactor record consumes exactly what was scanned", async () => {
    const root = createFixtureRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      const data = scanData(await daemon.refactorScan(root));
      const recorded = await daemon.refactorRecord(root, {
        assessmentDigest: data.assessment.assessmentDigest,
        expectedWorktreeDigest: computeWorktreeDigest(root)
      });
      expect(recorded.ok).toBe(true);
      expect((recorded.data as { assessmentDigest: string }).assessmentDigest).toBe(data.assessment.assessmentDigest);
      // The scan itself appended nothing; only the record did.
      expect(store.architectureEvents).toHaveLength(1);
    } finally {
      await daemon.stop();
    }
  });

  test("publishes the live worktree identity, so scan then record works over an existing ledger", async () => {
    const root = createFixtureRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      // Event #1: after this the ledger scope carries the identity of the tree as it is now.
      const seed = scanData(await daemon.refactorScan(root));
      const seededDigest = seed.worktree.worktreeDigest;
      expect(seededDigest).toBe(computeWorktreeDigest(root));
      expect(seed.worktree.headSha).toBe(gitOut(root, "rev-parse", "HEAD"));
      const seedRecord = await daemon.refactorRecord(root, {
        assessmentDigest: seed.assessment.assessmentDigest,
        expectedWorktreeDigest: seededDigest
      });
      expect(seedRecord.ok, JSON.stringify(seedRecord)).toBe(true);

      // Move the tree, so the last stored event's worktree identity is no longer current.
      writeFileSync(join(root, EXTRA_FILE), "export const extra = 1;\n", "utf8");
      commitFixture(root, "extra tracked file", SECOND_COMMITTER_DATE);
      const liveDigest = computeWorktreeDigest(root);
      expect(liveDigest).not.toBe(seededDigest);

      const scan = scanData(await daemon.refactorScan(root));
      // The published identity is the tree as it is at scan time, not the last event's: both
      // fields are read back from git here, not just compared against the seeded pair.
      expect(scan.worktree.worktreeDigest).toBe(liveDigest);
      expect(scan.worktree.worktreeDigest).not.toBe(seededDigest);
      expect(scan.worktree.headSha).toBe(gitOut(root, "rev-parse", "HEAD"));
      expect(scan.worktree.headSha).not.toBe(seed.worktree.headSha);

      const recorded = await daemon.refactorRecord(root, {
        assessmentDigest: scan.assessment.assessmentDigest,
        expectedWorktreeDigest: scan.worktree.worktreeDigest
      });
      expect(recorded.ok, JSON.stringify(recorded)).toBe(true);

      // The same digests a second time are honestly reported as already open, not re-recorded.
      const again = await daemon.refactorRecord(root, {
        assessmentDigest: scan.assessment.assessmentDigest,
        expectedWorktreeDigest: scan.worktree.worktreeDigest
      });
      expect(again.ok, JSON.stringify(again)).toBe(true);
      expect(suppressionReasons(again)).toContain("duplicate-active-fingerprint");
    } finally {
      await daemon.stop();
    }
  });

  test("feeds the assessment the same tracked-file set the snapshot measured", async () => {
    const root = createFixtureRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const owned = scanData(await daemon.refactorScan(root, {
        request: { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" }, proposal: proposalFor([OWNED_FILE]) }
      }));
      // A tracked, declared file can only resolve to its owner if the classifier saw the same
      // tracked-file set the snapshot was built from.
      expect(owned.assessment.affectedNodeIds).toEqual([OWNER_NODE_ID]);
      expect(owned.assessment.scaleReasonCodes).not.toContain("unowned-paths");
      expect(owned.proposal?.proposalDigest).toBe(proposalFor([OWNED_FILE]).proposalDigest);

      // Single-variable control: same request, one path the commit does not carry.
      const untracked = scanData(await daemon.refactorScan(root, {
        request: { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" }, proposal: proposalFor([UNTRACKED_FILE]) }
      }));
      expect(untracked.assessment.affectedNodeIds).toEqual([]);
      expect(untracked.assessment.scaleReasonCodes).toContain("unowned-paths");
    } finally {
      await daemon.stop();
    }
  });

  test("rejects a request whose expected state no longer holds", async () => {
    const root = createFixtureRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const staleHead = await daemon.refactorScan(root, {
        request: { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" }, expectedHeadSha: "0".repeat(40) }
      });
      expect(staleHead.ok).toBe(false);
      expect(errorOf(staleHead).code).toBe("AC_REFACTOR_STALE");

      const staleWorktree = await daemon.refactorScan(root, {
        request: {
          schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION,
          scope: { kind: "repository" },
          expectedWorktreeDigest: `sha256:${"1".repeat(64)}`
        }
      });
      expect(staleWorktree.ok).toBe(false);
      expect(errorOf(staleWorktree).code).toBe("AC_REFACTOR_STALE");

      // The same request with the current state is accepted, so staleness is the only variable.
      const current = await daemon.refactorScan(root, {
        request: {
          schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION,
          scope: { kind: "repository" },
          expectedWorktreeDigest: computeWorktreeDigest(root)
        }
      });
      expect(current.ok).toBe(true);
    } finally {
      await daemon.stop();
    }
  });

  test("fails closed when the repository declares no architecture model", async () => {
    const root = createFixtureRepo({ withModel: false });
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const envelope = await daemon.refactorScan(root);
      expect(envelope.ok).toBe(false);
      expect(errorOf(envelope).code).toBe("AC_MODEL_ADOPTION_REQUIRED");
    } finally {
      await daemon.stop();
    }
  });

  test("rejects a request that violates the frozen request invariants", async () => {
    const root = createFixtureRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const badVersion = await daemon.refactorScan(root, {
        request: { schemaVersion: "archcontext.refactor-request/v0", scope: { kind: "repository" } } as unknown as RefactorRequestV1
      });
      expect(badVersion.ok).toBe(false);
      expect(errorOf(badVersion).code).toBe("AC_SCHEMA_INVALID");

      const emptyPaths = await daemon.refactorScan(root, {
        request: { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "paths", paths: [] } }
      });
      expect(emptyPaths.ok).toBe(false);
      expect(errorOf(emptyPaths).code).toBe("AC_SCHEMA_INVALID");

      const undeclaredNode = await daemon.refactorScan(root, {
        request: { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "node", nodeId: "module.not-declared" } }
      });
      expect(undeclaredNode.ok).toBe(false);
      expect(errorOf(undeclaredNode).code).toBe("AC_SCHEMA_INVALID");
    } finally {
      await daemon.stop();
    }
  });

  test("fails closed when the tree moves while the scan is reading it", async () => {
    const root = createFixtureRepo();
    const store = new MutatingReplayLocalStore();
    const daemon = await startDaemon(store);
    try {
      const capturedHead = gitOut(root, "rev-parse", "HEAD");
      // Fires after the identity is captured and before any input is materialized.
      store.mutateOnNextReplay = () => {
        writeFileSync(join(root, MOVED_FILE), "export const moved = 1;\n", "utf8");
        commitFixture(root, "moved under the scan", SECOND_COMMITTER_DATE);
      };

      const envelope = await daemon.refactorScan(root);

      expect(envelope.ok, JSON.stringify(envelope)).toBe(false);
      expect(errorOf(envelope).code).toBe("AC_REFACTOR_STALE");
      expect(errorOf(envelope).message).toContain("headSha");
      expect(errorOf(envelope).message).toContain("worktreeDigest");
      expect(gitOut(root, "rev-parse", "HEAD")).not.toBe(capturedHead);
      // Nothing measured under a mixed state may reach the registry `refactor record` reads.
      expect(registeredAssessmentCount(daemon)).toBe(0);
      expect(store.architectureEvents).toHaveLength(0);

      // Single-variable control: the same daemon and store, with the tree left alone.
      const settled = await daemon.refactorScan(root);
      expect(settled.ok, JSON.stringify(settled)).toBe(true);
      expect(registeredAssessmentCount(daemon)).toBe(1);
    } finally {
      await daemon.stop();
    }
  });

  test("appends nothing when the tree moves between the record identity check and the append", async () => {
    const root = createFixtureRepo();
    const store = new MutatingReplayLocalStore();
    const daemon = await startDaemon(store);
    try {
      const seed = scanData(await daemon.refactorScan(root));
      const seeded = await daemon.refactorRecord(root, {
        assessmentDigest: seed.assessment.assessmentDigest,
        expectedWorktreeDigest: seed.worktree.worktreeDigest
      });
      expect(seeded.ok, JSON.stringify(seeded)).toBe(true);
      expect(store.architectureEvents).toHaveLength(1);

      writeFileSync(join(root, EXTRA_FILE), "export const extra = 1;\n", "utf8");
      commitFixture(root, "extra tracked file", SECOND_COMMITTER_DATE);
      const scan = scanData(await daemon.refactorScan(root));

      // Fires after the registered identity is validated and before the event is appended.
      store.mutateOnNextReplay = () => {
        writeFileSync(join(root, MOVED_FILE), "export const moved = 1;\n", "utf8");
        commitFixture(root, "moved under the record", THIRD_COMMITTER_DATE);
      };
      const recorded = await daemon.refactorRecord(root, {
        assessmentDigest: scan.assessment.assessmentDigest,
        expectedWorktreeDigest: scan.worktree.worktreeDigest
      });

      expect(recorded.ok, JSON.stringify(recorded)).toBe(false);
      expect(errorOf(recorded).code).toBe("AC_REFACTOR_STALE");
      expect(errorOf(recorded).message).toContain("worktreeDigest");
      expect(store.architectureEvents).toHaveLength(1);
      expect(store.architectureEventAppends).toHaveLength(1);
    } finally {
      await daemon.stop();
    }
  });

  test("rejects a malformed RPC param at the dispatch boundary instead of throwing", async () => {
    const root = createFixtureRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    const rpc = new ArchctxRuntimeRpcServer(daemon, { root, port: 0, token: "refactor-scan-rpc-token" });
    try {
      const client = new RuntimeRpcClient(await rpc.start());

      // `null` is not an absent request: only an absent one selects the default repository scan.
      const nullRequest = await client.refactorScan(root, { request: null } as never);
      expect(nullRequest.ok, JSON.stringify(nullRequest)).toBe(false);
      expect(errorOf(nullRequest).code).toBe("AC_SCHEMA_INVALID");

      const scalarRequest = await client.refactorScan(root, { request: "repository" } as never);
      expect(scalarRequest.ok).toBe(false);
      expect(errorOf(scalarRequest).code).toBe("AC_SCHEMA_INVALID");

      // Previously a TypeError inside the daemon, which the transport reported as HTTP 500.
      const nullRecord = await client.refactorRecord(root, null as never);
      expect(nullRecord.ok, JSON.stringify(nullRecord)).toBe(false);
      expect(errorOf(nullRecord).code).toBe("AC_SCHEMA_INVALID");

      const badSelection = await client.refactorRecord(root, {
        assessmentDigest: `sha256:${"a".repeat(64)}`,
        expectedWorktreeDigest: `sha256:${"b".repeat(64)}`,
        selection: ["ok", 7]
      } as never);
      expect(badSelection.ok).toBe(false);
      expect(errorOf(badSelection).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(badSelection).message).toContain("selection");

      // A well-formed selection is still rejected: nothing consumes it, so honouring it would
      // record every planned recommendation under a narrower request.
      const wellFormedSelection = await client.refactorRecord(root, {
        assessmentDigest: `sha256:${"a".repeat(64)}`,
        expectedWorktreeDigest: `sha256:${"b".repeat(64)}`,
        selection: ["x"]
      } as never);
      expect(wellFormedSelection.ok, JSON.stringify(wellFormedSelection)).toBe(false);
      expect(errorOf(wellFormedSelection).code).toBe("AC_SCHEMA_INVALID");
      expect(errorOf(wellFormedSelection).message).toContain("does not support selection");
      expect(store.architectureEventAppends).toHaveLength(0);
    } finally {
      await rpc.stop();
      await daemon.stop();
    }
  });

  test("derives requestId from the request payload alone", () => {
    const base: RefactorRequestV1 = { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "repository" } };
    expect(refactorRequestId(base)).toBe(refactorRequestId({ ...base }));
    expect(refactorRequestId(base)).toMatch(/^refactor_request\.[a-f0-9]{16}$/);
    expect(refactorRequestId({ ...base, scope: { kind: "node", nodeId: OWNER_NODE_ID } })).not.toBe(refactorRequestId(base));
  });
});
