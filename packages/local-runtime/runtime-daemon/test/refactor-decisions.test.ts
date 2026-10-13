import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REFACTOR_REQUEST_SCHEMA_VERSION,
  REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION,
  parseRefactorDecisionFile,
  type JsonEnvelope,
  type RecommendationV3,
  type RefactorAssessmentV1
} from "@archcontext/contracts";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel, listModelFiles, YamlModelStore } from "@archcontext/local-runtime/model-store-yaml";
import { createStartedDaemon } from "../src/index";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { readRefactorNamespace } from "../src/refactor-scan";

const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-refactor-decisions-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

const roots: string[] = [];

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const root of [...roots, STATE_ROOT]) rmSync(root, { recursive: true, force: true });
});

const OWNER_NODE_ID = "module.refactor-decisions-fixture";
const DECISIONS = ".archcontext/refactor-decisions";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function commitAll(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-m", message);
}

/** Declares `count` modules with no footprint: each one is an `undeclared-footprint` candidate. */
function declareUnfootprintedModules(root: string, ids: readonly string[]): void {
  for (const id of ids) {
    writeFileSync(
      join(root, ".archcontext/model/nodes", `${id}.yaml`),
      [`id: "${id}"`, 'kind: "module"', `name: "${id}"`, 'schemaVersion: "archcontext.node/v2"', 'status: "active"', 'summary: "Declares no footprint."', ""].join("\n"),
      "utf8"
    );
  }
}

/** A committed repository on `main` with one footprinted module and two undeclared ones. */
function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-refactor-decisions-"));
  roots.push(root);
  writeFileSync(join(root, "README.md"), "# refactor decisions fixture\n", "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/owned.ts"), "export const owned = 1;\n", "utf8");
  initializeArchContextModel(root, "Refactor Decisions App");
  writeFileSync(
    join(root, ".archcontext/model/nodes", `${OWNER_NODE_ID}.yaml`),
    [`id: "${OWNER_NODE_ID}"`, 'kind: "module"', 'name: "Fixture"', 'schemaVersion: "archcontext.node/v2"', "source:", "  include:", '    - "src/**"', 'status: "active"', 'summary: "Owns src."', ""].join("\n"),
    "utf8"
  );
  declareUnfootprintedModules(root, ["module.decide-a", "module.decide-b"]);
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  commitAll(root, "fixture");
  return root;
}

function startDaemon(store: TestLocalStore) {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: store,
    clock: () => "2026-10-13T09:00:00.000Z"
  });
}

interface ScanData {
  worktree: { headSha: string; worktreeDigest: string };
  namespace: string;
  assessment: RefactorAssessmentV1;
  proposedRecommendations: RecommendationV3[];
  suppressed: { reasonCode: string; fingerprint: string; previousRecommendationId?: string }[];
}

function scanData(envelope: JsonEnvelope): ScanData {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  return envelope.data as unknown as ScanData;
}

function errorOf(envelope: JsonEnvelope): { code: string; message: string; reasonCode?: string } {
  return (envelope as { error?: { code: string; message: string; reasonCode?: string } }).error!;
}

function candidateFor(scan: ScanData, subject: string): RecommendationV3 {
  const candidate = scan.proposedRecommendations.find((entry) => entry.subject === subject);
  expect(candidate, subject).toBeDefined();
  return candidate!;
}

function decisionFiles(root: string): string[] {
  return existsSync(join(root, DECISIONS)) ? readdirSync(join(root, DECISIONS)).sort() : [];
}

function treeFiles(root: string, directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return files;
  for (const entry of readdirSync(absolute, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files[join(entry.parentPath, entry.name)] = readFileSync(join(entry.parentPath, entry.name), "utf8");
  }
  return files;
}

describe("refactor decisions travel through Git (ADR-0046)", () => {
  test("a committed decision follows a new branch and a second worktree with its own store; an uncommitted one does not", async () => {
    const a = createRepo();
    const storeA = new TestLocalStore();
    const daemonA = await startDaemon(storeA);
    let b: string | undefined;
    try {
      git(a, "switch", "-c", "feature/decide");
      const first = scanData(await daemonA.refactorScan(a));
      expect(first.namespace).toBe(readRefactorNamespace(a));
      const decidedA = candidateFor(first, "module.decide-a");
      const undecidedB = candidateFor(first, "module.decide-b");

      const rejected = await daemonA.recommendations(a, { command: "reject", approved: true, recommendationId: decidedA.recommendationId, reason: "Intentional placeholder module." });
      expect(rejected.ok, JSON.stringify(rejected)).toBe(true);
      const decisionPath = `${DECISIONS}/${decidedA.recommendationId}.json`;
      expect((rejected.data as { decisionFile: string }).decisionFile).toBe(decisionPath);
      const decision = parseRefactorDecisionFile(decisionPath, readFileSync(join(a, decisionPath), "utf8"));
      expect(decision).toMatchObject({ recommendationId: decidedA.recommendationId, status: "rejected", namespace: first.namespace, regressesFrom: null });
      commitAll(a, "decide module.decide-a");

      // A new branch in the same worktree.
      git(a, "switch", "-c", "feature/next");
      const onBranch = scanData(await daemonA.refactorScan(a));
      expect(onBranch.proposedRecommendations.map((entry) => entry.recommendationId)).not.toContain(decidedA.recommendationId);
      expect(onBranch.suppressed).toContainEqual(expect.objectContaining({ reasonCode: "decided-fingerprint", previousRecommendationId: decidedA.recommendationId }));

      // A second worktree of the same commit, with its own runtime store and worktree path.
      b = mkdtempSync(join(tmpdir(), "archctx-refactor-decisions-b-"));
      rmSync(b, { recursive: true, force: true });
      roots.push(b);
      git(a, "worktree", "add", "-b", "feature/other-worktree", b);
      const storeB = new TestLocalStore();
      const daemonB = await startDaemon(storeB);
      try {
        const inB = scanData(await daemonB.refactorScan(b));
        expect(inB.proposedRecommendations.map((entry) => entry.recommendationId)).not.toContain(decidedA.recommendationId);
        expect(inB.suppressed).toContainEqual(expect.objectContaining({ reasonCode: "decided-fingerprint", previousRecommendationId: decidedA.recommendationId }));
        // An undecided observation has the same id in both worktrees.
        expect(candidateFor(inB, "module.decide-b").recommendationId).toBe(undecidedB.recommendationId);
        // B's ledger never recorded the id; the checkout still states the decision.
        const listed = await daemonB.recommendations(b, { command: "list", status: "rejected" });
        expect(listed.ok, JSON.stringify(listed)).toBe(true);
        expect((listed.data as { decisions: { recommendationId: string }[] }).decisions.map((entry) => entry.recommendationId)).toEqual([decidedA.recommendationId]);

        // An uncommitted decision in A is not visible in B.
        const deferred = await daemonA.recommendations(a, { command: "defer", approved: true, recommendationId: undecidedB.recommendationId, reason: "Next quarter." });
        expect(deferred.ok, JSON.stringify(deferred)).toBe(true);
        expect(git(a, "status", "--porcelain")).toContain(`${DECISIONS}/${undecidedB.recommendationId}.json`);
        const stillOpenInB = scanData(await daemonB.refactorScan(b));
        expect(candidateFor(stillOpenInB, "module.decide-b").recommendationId).toBe(undecidedB.recommendationId);
        const inA = scanData(await daemonA.refactorScan(a));
        expect(inA.proposedRecommendations.map((entry) => entry.recommendationId)).not.toContain(undecidedB.recommendationId);
        expect(inA.suppressed).toContainEqual(expect.objectContaining({ reasonCode: "duplicate-active-fingerprint", previousRecommendationId: undecidedB.recommendationId }));
      } finally {
        await daemonB.stop();
      }
    } finally {
      await daemonA.stop();
      if (b) execFileSync("git", ["worktree", "remove", "--force", b], { cwd: a, stdio: ["ignore", "pipe", "pipe"] });
    }
  });

  test("a Git-only decision from another worktree can be shown and re-decided there, but not verified or resolved", async () => {
    const a = createRepo();
    const daemonA = await startDaemon(new TestLocalStore());
    let b: string | undefined;
    try {
      const scanA = scanData(await daemonA.refactorScan(a));
      const accepted = candidateFor(scanA, "module.decide-a");
      expect((await daemonA.recommendations(a, { command: "accept", approved: true, recommendationId: accepted.recommendationId, reason: "Worth doing." })).ok).toBe(true);
      commitAll(a, "accept module.decide-a");

      b = mkdtempSync(join(tmpdir(), "archctx-refactor-decisions-b-"));
      rmSync(b, { recursive: true, force: true });
      roots.push(b);
      git(a, "worktree", "add", "-b", "feature/consumer", b);
      const storeB = new TestLocalStore();
      const daemonB = await startDaemon(storeB);
      try {
        const id = accepted.recommendationId;
        const decisionPath = `${DECISIONS}/${id}.json`;

        // show answers from the Git decision, marked as not recorded in this ledger.
        const shown = await daemonB.recommendations(b, { command: "show", recommendationId: id });
        expect(shown.ok, JSON.stringify(shown)).toBe(true);
        expect(shown.data).toMatchObject({ source: "git-decision", status: "accepted", statusAuthority: "git-decision", recommendation: null, gitDecision: { recommendationId: id, status: "accepted" } });
        expect(publishedSchemaIssues("runtime/runtime-recommendation-show.schema.json", shown.data)).toEqual([]);

        // verify and resolve have no baseline here: a typed evidence-required error, nothing written.
        const verify = await daemonB.refactorVerify(b, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: id });
        expect(errorOf(verify)).toMatchObject({ code: "AC_REFACTOR_EVIDENCE_REQUIRED", reasonCode: "git-decision-not-recorded" });
        expect((verify as unknown as { error: { details: { recordCommand: string } } }).error.details.recordCommand).toContain(`--id ${id}`);
        const resolve = await daemonB.recommendations(b, { command: "resolve", approved: true, recommendationId: id, reason: "Done.", evidenceDigest: `sha256:${"1".repeat(64)}` });
        expect(errorOf(resolve)).toMatchObject({ code: "AC_REFACTOR_EVIDENCE_REQUIRED", reasonCode: "git-decision-not-recorded" });
        expect(storeB.architectureEventAppends).toHaveLength(0);

        // reject: the same generation is recorded in B's ledger and the Git file is rewritten.
        const rejected = await daemonB.recommendations(b, { command: "reject", approved: true, recommendationId: id, reason: "Not here after all." });
        expect(rejected.ok, JSON.stringify(rejected)).toBe(true);
        expect(rejected.data).toMatchObject({ recommendationId: id, previousStatus: "accepted", nextStatus: "rejected", decisionFile: decisionPath });
        expect((rejected.data as { implicitRecord: { recommendationIds: string[] } }).implicitRecord.recommendationIds).toContain(id);
        expect(parseRefactorDecisionFile(decisionPath, readFileSync(join(b, decisionPath), "utf8"))).toMatchObject({ recommendationId: id, status: "rejected" });
        expect(git(b, "status", "--porcelain")).toContain(decisionPath);
        const recordedInB = await daemonB.recommendations(b, { command: "show", recommendationId: id });
        expect(recordedInB.data).toMatchObject({ source: "ledger", status: "rejected", statusAuthority: "git-decision" });
        // Now recorded here, verify reaches the measurement instead of the Git-only refusal.
        const verifyAfter = await daemonB.refactorVerify(b, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: id });
        expect((verifyAfter as { error?: { reasonCode?: string } }).error?.reasonCode).not.toBe("git-decision-not-recorded");
      } finally {
        await daemonB.stop();
      }
    } finally {
      await daemonA.stop();
      if (b) execFileSync("git", ["worktree", "remove", "--force", b], { cwd: a, stdio: ["ignore", "pipe", "pipe"] });
    }
  });

  test("the record command a Git-only decision suggests keeps the status its file states", async () => {
    const a = createRepo();
    const daemonA = await startDaemon(new TestLocalStore());
    let b: string | undefined;
    try {
      const scanA = scanData(await daemonA.refactorScan(a));
      const accepted = candidateFor(scanA, "module.decide-a");
      const deferred = candidateFor(scanA, "module.decide-b");
      expect((await daemonA.recommendations(a, { command: "accept", approved: true, recommendationId: accepted.recommendationId, reason: "Worth doing." })).ok).toBe(true);
      expect((await daemonA.recommendations(a, { command: "defer", approved: true, recommendationId: deferred.recommendationId, reason: "Later." })).ok).toBe(true);
      commitAll(a, "decide module.decide-a and module.decide-b");

      b = mkdtempSync(join(tmpdir(), "archctx-refactor-decisions-b-"));
      rmSync(b, { recursive: true, force: true });
      roots.push(b);
      git(a, "worktree", "add", "-b", "feature/consumer-record", b);
      const storeB = new TestLocalStore();
      const daemonB = await startDaemon(storeB);
      try {
        const id = accepted.recommendationId;
        const decisionPath = `${DECISIONS}/${id}.json`;
        type Refusal = { error: { reasonCode?: string; message: string; details: { decisionStatus: string; recordCommand?: string; verifyCommand?: string } } };
        const verify = await daemonB.refactorVerify(b, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: id }) as unknown as Refusal;
        expect(verify.error.reasonCode).toBe("git-decision-not-recorded");
        expect(verify.error.details.decisionStatus).toBe("accepted");
        expect(verify.error.details.recordCommand).toBe(`archctx recommendations accept --id ${id} --reason <why>`);
        expect(verify.error.message).toContain("before changing the code");

        // A resolved file is terminal: no record command is suggested and nothing is written.
        const resolvedPath = `${DECISIONS}/${deferred.recommendationId}.json`;
        const resolvedDecision = JSON.parse(readFileSync(join(b, resolvedPath), "utf8")) as Record<string, unknown>;
        writeFileSync(join(b, resolvedPath), `${JSON.stringify({ ...resolvedDecision, status: "resolved" }, null, 2)}\n`);
        const appends = storeB.architectureEventAppends.length;
        const verifyResolved = await daemonB.refactorVerify(b, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: deferred.recommendationId }) as unknown as Refusal;
        expect(verifyResolved.error.reasonCode).toBe("git-decision-not-recorded");
        expect(verifyResolved.error.details).toEqual({ decisionStatus: "resolved" });
        expect(storeB.architectureEventAppends).toHaveLength(appends);
        git(b, "checkout", "--", resolvedPath);

        // Following the suggestion records the generation here and leaves the Git status as it was.
        const recorded = await daemonB.recommendations(b, { command: "accept", approved: true, recommendationId: id, reason: "Recording it here before the change." });
        expect(recorded.ok, JSON.stringify(recorded)).toBe(true);
        expect(recorded.data).toMatchObject({ recommendationId: id, previousStatus: "accepted", nextStatus: "accepted", decisionFile: decisionPath });
        expect(parseRefactorDecisionFile(decisionPath, readFileSync(join(b, decisionPath), "utf8"))).toMatchObject({ recommendationId: id, status: "accepted" });
        const shown = await daemonB.recommendations(b, { command: "show", recommendationId: id });
        expect(shown.data).toMatchObject({ source: "ledger", status: "accepted", statusAuthority: "git-decision" });
        const verifyAfter = await daemonB.refactorVerify(b, { schemaVersion: REFACTOR_VERIFICATION_REQUEST_SCHEMA_VERSION, recommendationId: id });
        expect((verifyAfter as { error?: { reasonCode?: string } }).error?.reasonCode).not.toBe("git-decision-not-recorded");
        // Once recorded here, the same verb again is the usual lifecycle no-op.
        const again = await daemonB.recommendations(b, { command: "accept", approved: true, recommendationId: id, reason: "Again." });
        expect(errorOf(again)).toMatchObject({ code: "AC_PRECONDITION_FAILED" });
      } finally {
        await daemonB.stop();
      }
    } finally {
      await daemonA.stop();
      if (b) execFileSync("git", ["worktree", "remove", "--force", b], { cwd: a, stdio: ["ignore", "pipe", "pipe"] });
    }
  });

  test("a ledger decision the checkout no longer carries never reopens the decided id", async () => {
    const root = createRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      const first = scanData(await daemon.refactorScan(root));
      const candidate = candidateFor(first, "module.decide-a");
      expect((await daemon.recommendations(root, { command: "reject", approved: true, recommendationId: candidate.recommendationId, reason: "Intentional." })).ok).toBe(true);
      // The decision file is dropped from the checkout; the ledger still holds `rejected`.
      rmSync(join(root, DECISIONS), { recursive: true, force: true });
      const rescanned = scanData(await daemon.refactorScan(root));
      expect(rescanned.proposedRecommendations.map((entry) => entry.recommendationId)).not.toContain(candidate.recommendationId);
      const regenerated = rescanned.proposedRecommendations.find((entry) => entry.fingerprint === candidate.fingerprint);
      expect(regenerated).toBeDefined();
      expect(regenerated!.relations).toEqual({ regressesFrom: candidate.recommendationId });
      // Deciding the audit id would write a Git decision for a superseded generation: refused,
      // naming the generation the scan emits, and nothing is written or appended.
      const appendsBefore = store.architectureEventAppends.length;
      const decideAudit = async () => daemon.recommendations(root, { command: "accept", approved: true, recommendationId: candidate.recommendationId, reason: "Old id." });
      const beforeRecord = await decideAudit();
      expect(errorOf(beforeRecord)).toMatchObject({ code: "AC_REFACTOR_STALE", reasonCode: "ledger-audit-generation" });
      expect((beforeRecord as unknown as { error: { details: unknown } }).error.details).toEqual({ currentRecommendationId: regenerated!.recommendationId, currentRecorded: false });
      expect(decisionFiles(root)).toEqual([]);
      expect(store.architectureEventAppends).toHaveLength(appendsBefore);
      // The new generation is recorded beside the old one.
      const recorded = await daemon.refactorRecord(root, { assessmentDigest: rescanned.assessment.assessmentDigest, expectedWorktreeDigest: rescanned.worktree.worktreeDigest });
      expect(recorded.ok, JSON.stringify(recorded)).toBe(true);

      // The ledger `rejected` is audit only: labelled as such, never the subject's current status
      // and never in an open or status listing; the new generation is the open one.
      const shown = await daemon.recommendations(root, { command: "show", recommendationId: candidate.recommendationId });
      expect(shown.ok, JSON.stringify(shown)).toBe(true);
      expect(shown.data).toMatchObject({ source: "ledger", status: "rejected", statusAuthority: "ledger-audit" });
      expect(publishedSchemaIssues("runtime/runtime-recommendation-show.schema.json", shown.data)).toEqual([]);
      const listedIds = async (status: "open" | "rejected") => {
        const listed = await daemon.recommendations(root, { command: "list", status });
        expect(listed.ok, JSON.stringify(listed)).toBe(true);
        const data = listed.data as { recommendations: { recommendationId: string }[]; ledgerAudit: { recommendationId: string }[] };
        return { listed: data.recommendations.map((entry) => entry.recommendationId), audit: data.ledgerAudit.map((entry) => entry.recommendationId) };
      };
      const open = await listedIds("open");
      expect(open.listed).toContain(regenerated!.recommendationId);
      expect(open.listed).not.toContain(candidate.recommendationId);
      const rejectedList = await listedIds("rejected");
      expect(rejectedList.listed).not.toContain(candidate.recommendationId);
      expect(rejectedList.audit).toEqual([candidate.recommendationId]);
      const book = await daemon.book(root, { command: "recommendations", openOnly: true });
      expect(book.ok, JSON.stringify(book)).toBe(true);
      const bookIds = (book.data as { recommendations: { recommendationId: string }[] }).recommendations.map((entry) => entry.recommendationId);
      expect(bookIds).toContain(regenerated!.recommendationId);
      expect(bookIds).not.toContain(candidate.recommendationId);
      expect((book.data as { ledgerAuditRecommendationIds: string[] }).ledgerAuditRecommendationIds).toEqual([]);
      // Without --open the book returns every record, and labels the audit one as such.
      const fullBook = await daemon.book(root, { command: "recommendations" });
      expect(fullBook.ok, JSON.stringify(fullBook)).toBe(true);
      const full = fullBook.data as { recommendations: { recommendationId: string }[]; ledgerAuditRecommendationIds: string[] };
      expect(full.recommendations.map((entry) => entry.recommendationId)).toEqual(expect.arrayContaining([candidate.recommendationId, regenerated!.recommendationId]));
      expect(full.ledgerAuditRecommendationIds).toEqual([candidate.recommendationId]);

      // Once the current generation is recorded, the refusal says so; still nothing is written.
      const afterRecord = await decideAudit();
      expect(errorOf(afterRecord)).toMatchObject({ code: "AC_REFACTOR_STALE", reasonCode: "ledger-audit-generation" });
      expect((afterRecord as unknown as { error: { details: unknown } }).error.details).toEqual({ currentRecommendationId: regenerated!.recommendationId, currentRecorded: true });
      expect(decisionFiles(root)).toEqual([]);
    } finally {
      await daemon.stop();
    }
  });

  test("a decision changes no model file, no docs/architecture file and no modelDigest", async () => {
    const root = createRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const store = new YamlModelStore();
      const modelBefore = await store.validateModel({ root, repositoryId: "repo", headSha: git(root, "rev-parse", "HEAD") });
      const modelFilesBefore = listModelFiles(root).map((file) => [file.path, file.digest]);
      const docsBefore = treeFiles(root, "docs");
      const scan = scanData(await daemon.refactorScan(root));
      const decided = await daemon.recommendations(root, { command: "accept", approved: true, recommendationId: candidateFor(scan, "module.decide-a").recommendationId, reason: "Worth doing." });
      expect(decided.ok, JSON.stringify(decided)).toBe(true);
      expect(decisionFiles(root)).toHaveLength(1);
      expect(listModelFiles(root).map((file) => [file.path, file.digest])).toEqual(modelFilesBefore);
      expect(treeFiles(root, "docs")).toEqual(docsBefore);
      const modelAfter = await store.validateModel({ root, repositoryId: "repo", headSha: git(root, "rev-parse", "HEAD") });
      expect(modelAfter.modelDigest).toBe(modelBefore.modelDigest);
      // The only path the decision touched is its own file.
      expect(git(root, "status", "--porcelain").split("\n").filter(Boolean)).toEqual([`?? ${DECISIONS}/`]);
    } finally {
      await daemon.stop();
    }
  });
});

describe("refactor decision write boundary", () => {
  test("a decision without approval writes nothing and appends nothing", async () => {
    const root = createRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      const scan = scanData(await daemon.refactorScan(root));
      const refused = await daemon.recommendations(root, { command: "defer", source: "mcp", recommendationId: candidateFor(scan, "module.decide-a").recommendationId, reason: "Later." });
      expect(errorOf(refused).code).toBe("AC_USER_CONFIRMATION_REQUIRED");
      expect(decisionFiles(root)).toEqual([]);
      expect(store.architectureEventAppends).toHaveLength(0);
    } finally {
      await daemon.stop();
    }
  });

  test("plan_update cannot author a decision file", async () => {
    const root = createRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const planned = await daemon.planUpdate(root, {
        id: "changeset.forged-decision",
        operations: [{ op: "write_refactor_decision", path: `${DECISIONS}/recommendation.0123456789abcdef.json`, expectedHash: "missing", body: "{}\n" }]
      });
      expect(errorOf(planned)).toMatchObject({ code: "AC_SCHEMA_INVALID" });
      expect(errorOf(planned).message).toContain("write_refactor_decision");
    } finally {
      await daemon.stop();
    }
  });

  test("a ledger append failure inside the ChangeSet rolls the decision file back", async () => {
    class FailingAppendStore extends TestLocalStore {
      override async appendArchitectureEventsAndCommitChangeSet(): Promise<never> {
        throw new Error("injected ledger append failure");
      }
    }
    const root = createRepo();
    const store = new FailingAppendStore();
    const daemon = await startDaemon(store);
    try {
      const scan = scanData(await daemon.refactorScan(root));
      await expect(daemon.recommendations(root, { command: "reject", approved: true, recommendationId: candidateFor(scan, "module.decide-a").recommendationId, reason: "Intentional." }))
        .rejects.toThrow("injected ledger append failure");
      expect(decisionFiles(root)).toEqual([]);
      expect(git(root, "status", "--porcelain")).toBe("");
      expect(store.architectureEventAppends).toHaveLength(0);
      expect([...store.changeSetJournals.values()].map((journal) => journal.status)).toEqual(["aborted"]);
      // The writer lock was released: the next decision reaches the append again instead of
      // failing on a held lock.
      await expect(daemon.recommendations(root, { command: "reject", approved: true, recommendationId: candidateFor(scan, "module.decide-b").recommendationId, reason: "Intentional." }))
        .rejects.toThrow("injected ledger append failure");
      expect(decisionFiles(root)).toEqual([]);
    } finally {
      await daemon.stop();
    }
  });

  test("the decision apply runs under the writer the verb holds and refuses to run without it", async () => {
    const root = createRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      const scan = scanData(await daemon.refactorScan(root));
      // No nested `withWriter`: the decision completes, one journal committed with its events.
      const decided = await daemon.recommendations(root, { command: "waive", approved: true, recommendationId: candidateFor(scan, "module.decide-a").recommendationId, reason: "Accepted risk." });
      expect(decided.ok, JSON.stringify(decided)).toBe(true);
      const journals = [...store.changeSetJournals.values()];
      expect(journals.map((journal) => journal.status)).toEqual(["committed"]);
      expect(journals[0]!.files.map((file) => [file.path, file.operation])).toEqual([[`${DECISIONS}/${candidateFor(scan, "module.decide-a").recommendationId}.json`, "write_refactor_decision"]]);
      expect(journals[0]!.ledger?.append?.appendedEvents.length).toBe(2);
      const authority = (daemon as unknown as { changeSetAuthority: { applyRefactorDecisionWithinWriter: (root: string, input: unknown) => Promise<unknown> } }).changeSetAuthority;
      await expect(authority.applyRefactorDecisionWithinWriter(root, { writes: [], events: [] })).rejects.toThrow("requires the runtime writer lock");
    } finally {
      await daemon.stop();
    }
  });

  test("a malformed or foreign decision file fails every reader closed", async () => {
    const root = createRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      mkdirSync(join(root, DECISIONS), { recursive: true });
      writeFileSync(join(root, DECISIONS, "recommendation.0123456789abcdef.json"), "<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs\n");
      const scan = await daemon.refactorScan(root);
      expect(errorOf(scan)).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "refactor-decision-invalid" });
      expect(errorOf(scan).message).toContain("refactor-decision-conflicted");
      const listed = await daemon.recommendations(root, { command: "list", status: "rejected" });
      expect(errorOf(listed).code).toBe("AC_SCHEMA_INVALID");
      rmSync(join(root, DECISIONS), { recursive: true, force: true });
      mkdirSync(join(root, DECISIONS, "nested"), { recursive: true });
      expect(errorOf(await daemon.refactorScan(root)).message).toContain("must be a regular file");
    } finally {
      await daemon.stop();
    }
  });

  test("an ignored stray file beside the decisions is never read; a Git-visible stray file fails closed", async () => {
    const root = createRepo();
    writeFileSync(join(root, ".gitignore"), ".DS_Store\n*.swp\n");
    commitAll(root, "ignore editor files");
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const scan = scanData(await daemon.refactorScan(root));
      expect((await daemon.recommendations(root, { command: "defer", approved: true, recommendationId: candidateFor(scan, "module.decide-a").recommendationId, reason: "Later." })).ok).toBe(true);
      writeFileSync(join(root, DECISIONS, ".DS_Store"), "\0\0binary");
      writeFileSync(join(root, DECISIONS, ".recommendation.swp"), "swap");
      const ignoredOnly = await daemon.refactorScan(root);
      expect(ignoredOnly.ok, JSON.stringify(ignoredOnly)).toBe(true);
      const listed = await daemon.recommendations(root, { command: "list", status: "deferred" });
      expect((listed.data as { recommendations: unknown[] }).recommendations).toHaveLength(1);
      // The ChangeSet engine's own backup and temp names of an open journal are not decisions.
      const [decided] = readdirSync(join(root, DECISIONS)).filter((name) => name.endsWith(".json"));
      writeFileSync(join(root, DECISIONS, `${decided}.archctx-backup`), "{}\n");
      writeFileSync(join(root, DECISIONS, `${decided}.archctx-tmp-123-1`), "{}\n");
      expect((await daemon.refactorScan(root)).ok).toBe(true);
      rmSync(join(root, DECISIONS, `${decided}.archctx-backup`));
      rmSync(join(root, DECISIONS, `${decided}.archctx-tmp-123-1`));

      writeFileSync(join(root, DECISIONS, "notes.md.orig"), "merge leftovers\n");
      const stray = await daemon.refactorScan(root);
      expect(errorOf(stray)).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "refactor-decision-invalid" });
      expect(errorOf(stray).message).toContain("notes.md.orig");
    } finally {
      await daemon.stop();
    }
  });

  test("a CRLF checkout of a committed decision reads as that decision and can be re-decided; any other byte change fails closed", async () => {
    const root = createRepo();
    const store = new TestLocalStore();
    const daemon = await startDaemon(store);
    try {
      const scan = scanData(await daemon.refactorScan(root));
      const id = candidateFor(scan, "module.decide-a").recommendationId;
      const decisionPath = `${DECISIONS}/${id}.json`;
      expect((await daemon.recommendations(root, { command: "accept", approved: true, recommendationId: id, reason: "Worth doing." })).ok).toBe(true);
      commitAll(root, "accept module.decide-a");
      const canonical = readFileSync(join(root, decisionPath), "utf8");
      expect(canonical.includes("\r")).toBe(false);

      // What a `core.autocrlf` checkout of that commit leaves on disk.
      writeFileSync(join(root, decisionPath), canonical.replaceAll("\n", "\r\n"));
      expect((await daemon.refactorScan(root)).ok).toBe(true);
      const shown = await daemon.recommendations(root, { command: "show", recommendationId: id });
      expect(shown.data).toMatchObject({ status: "accepted", statusAuthority: "git-decision" });
      const rejected = await daemon.recommendations(root, { command: "reject", approved: true, recommendationId: id, reason: "Not after all." });
      expect(rejected.ok, JSON.stringify(rejected)).toBe(true);
      expect(rejected.data).toMatchObject({ previousStatus: "accepted", nextStatus: "rejected", decisionFile: decisionPath });
      const rewritten = readFileSync(join(root, decisionPath), "utf8");
      expect(rewritten.includes("\r")).toBe(false);
      expect(parseRefactorDecisionFile(decisionPath, rewritten)).toMatchObject({ recommendationId: id, status: "rejected" });

      // A lone CR or any other byte that is not the canonical serialization fails every reader.
      for (const altered of [rewritten.replace("\n", "\r"), rewritten.replace("{\n  ", "{\n   ")]) {
        writeFileSync(join(root, decisionPath), altered);
        for (const read of [await daemon.refactorScan(root), await daemon.recommendations(root, { command: "list", status: "rejected" })]) {
          expect(errorOf(read)).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "refactor-decision-invalid" });
          expect(errorOf(read).message).toContain("refactor-decision-noncanonical");
        }
      }
    } finally {
      await daemon.stop();
    }
  });

  test("a decision file Git ignores fails every reader closed", async () => {
    const root = createRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const scan = scanData(await daemon.refactorScan(root));
      const id = candidateFor(scan, "module.decide-a").recommendationId;
      expect((await daemon.recommendations(root, { command: "defer", approved: true, recommendationId: id, reason: "Later." })).ok).toBe(true);
      // The decision is not committed yet, so an ignore rule that matches it hides it from Git.
      writeFileSync(join(root, ".gitignore"), "recommendation.*.json\n");
      for (const read of [
        await daemon.refactorScan(root),
        await daemon.recommendations(root, { command: "list", status: "deferred" })
      ]) {
        expect(errorOf(read)).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "refactor-decision-invalid" });
        expect(errorOf(read).message).toContain(`${DECISIONS}/${id}.json is ignored by Git`);
      }
      // A committed decision stays Git-visible whatever the ignore rules say.
      git(root, "add", "-f", `${DECISIONS}/${id}.json`);
      git(root, "commit", "-m", "commit the decision");
      expect((await daemon.refactorScan(root)).ok).toBe(true);
    } finally {
      await daemon.stop();
    }
  });

  test("a manifest without product.id cannot scope refactor identity", async () => {
    const root = createRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const manifest = join(root, ".archcontext/manifest.yaml");
      writeFileSync(manifest, readFileSync(manifest, "utf8").replace(/^  id: .*$/m, ""));
      commitAll(root, "drop product.id");
      const scan = await daemon.refactorScan(root);
      expect(errorOf(scan)).toMatchObject({ code: "AC_MODEL_ADOPTION_REQUIRED", reasonCode: "product-id-missing" });
    } finally {
      await daemon.stop();
    }
  });
});

describe("refactor scan scope", () => {
  test("a node scope through the daemon request returns only observations touching that node", async () => {
    const root = createRepo();
    const daemon = await startDaemon(new TestLocalStore());
    try {
      const repository = scanData(await daemon.refactorScan(root));
      const scoped = scanData(await daemon.refactorScan(root, {
        request: { schemaVersion: REFACTOR_REQUEST_SCHEMA_VERSION, scope: { kind: "node", nodeId: OWNER_NODE_ID } }
      }));
      const touching = repository.assessment.observations.filter((observation) => observation.affectedNodeIds.includes(OWNER_NODE_ID));
      expect(scoped.assessment.observations).toEqual(touching);
      expect(scoped.assessment.observations.every((observation) => observation.affectedNodeIds.includes(OWNER_NODE_ID))).toBe(true);
      expect(repository.assessment.observations.length).toBeGreaterThan(scoped.assessment.observations.length);
    } finally {
      await daemon.stop();
    }
  });
});
