import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH, stableYaml, type JsonEnvelope, type ProjectionRequestV1, type ProjectionResultV2 } from "@archcontext/contracts";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext, REPO_HARNESS_PROJECTION_PROFILE } from "@archcontext/core/projection-engine";
import { listGitVisibleFiles, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { projectionWorkspaceId } from "../src/projection-inputs";
import { buildArchitectureDocsProjection, runProjectionCheckCommand, runProjectionFreshnessCommand } from "../src/projection-service";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { rmSync } from "./runtime-test-fixtures";

/**
 * Issue #402 phase 2 end to end: topology nodes anchor to configuration files CodeGraph does not
 * index (`compose.yaml`, `k8s/*.yaml`) through `source.include`. Source stamps cover them because
 * footprints read the Git-visible file list, so editing one marks both topology targets stale with
 * `source-stamp-changed`. archctx never reads what the files say.
 */

const TIMEOUT_MS = 120_000;
const DIAGRAM = "docs/architecture/diagrams/runtime-topology.mmd";
const SUMMARY = "docs/architecture/runtime-topology.md";
const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-topology-freshness-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

let root = "";

function git(...args: string[]): void {
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function write(path: string, body: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body, "utf8");
}

function node(value: Record<string, unknown>): void {
  write(`.archcontext/model/nodes/${String(value.id)}.yaml`, stableYaml({ schemaVersion: "archcontext.node/v2", status: "active", ...value } as Parameters<typeof stableYaml>[0]));
}

function checkRequest(): ProjectionRequestV1 {
  return {
    schemaVersion: "archcontext.projection-request/v1",
    requestId: "projection_request.topology_freshness_check",
    profile: REPO_HARNESS_PROJECTION_PROFILE,
    mode: "check",
    targets: ["architecture-docs"],
    changedPaths: ["compose.yaml"],
    expected: {
      repositoryId: repositoryFingerprint(root),
      workspaceId: projectionWorkspaceId(root),
      headSha: readHeadSha(root),
      worktreeDigest: architectureDocumentationProjectionWorktreeDigest(root, loadNativeModelFromArchContext(root), listGitVisibleFiles(root)) as `sha256:${string}`
    }
  };
}

function projectionResult(envelope: JsonEnvelope): ProjectionResultV2 {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  expect(publishedSchemaIssues("runtime/projection-result.schema.json", envelope.data)).toEqual([]);
  return envelope.data as unknown as ProjectionResultV2;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "archctx-topology-freshness-"));
  write("README.md", "# topology freshness fixture\n");
  write("src/shop/index.ts", "export const shop = 1;\n");
  write("compose.yaml", "services:\n  web:\n    image: shop:1\n");
  write("k8s/pod.yaml", "kind: Pod\n");
  initializeArchContextModel(root, "Topology Freshness App");
  rmSync(join(root, ".archcontext/model/nodes/capability.architecture.context.yaml"), { force: true });
  declareOptionalCodeFacts(root);
  node({
    id: "capability.shop.storefront", kind: "capability", name: "Storefront", summary: "Serves the shop.",
    source: { include: ["src/shop/**"] },
    extensions: { contractFiles: { agents: "src/shop/AGENTS.md", claude: "src/shop/CLAUDE.md" } }
  });
  node({ id: "namespace.shop.pod", kind: "namespace", name: "Shop pod", summary: "The shop pod.", namespace: { type: "pod" }, source: { include: ["k8s/*.yaml"] } });
  node({ id: "process.shop.web", kind: "process", name: "Web", summary: "The web server.", source: { include: ["compose.yaml"] } });
  node({ id: "process.shop.cron", kind: "process", name: "Cron", summary: "A model-authored job." });
  write(".archcontext/model/relations/relation.shop.web-pod.yaml", stableYaml({
    schemaVersion: "archcontext.relation/v1", id: "relation.shop.web-pod", kind: "runs-in", source: "process.shop.web", target: "namespace.shop.pod", intent: "Runs in the pod."
  }));
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  for (const file of buildArchitectureDocsProjection(undefined, root, REPO_HARNESS_PROJECTION_PROFILE).files) write(file.path, file.body);
  git("add", "-A");
  git("commit", "-q", "-m", "project architecture documentation");
}, TIMEOUT_MS);

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const path of [root, STATE_ROOT]) if (path) rmSync(path, { recursive: true, force: true });
});

test("the committed topology rows stamp their configuration files, and the summary names every anchor", () => {
  const manifest = JSON.parse(readFileSync(join(root, ARCHITECTURE_DOCS_PROJECTION_MANIFEST_PATH), "utf8"));
  const topologyRows = Object.values(manifest.targets as Record<string, { path: string; sourceStamps?: Record<string, string> }>)
    .filter((row) => row.path === DIAGRAM || row.path === SUMMARY);
  expect(topologyRows).toHaveLength(2);
  for (const row of topologyRows) expect(Object.keys(row.sourceStamps ?? {})).toEqual(["namespace.shop.pod", "process.shop.web"]);
  expect(topologyRows[0]!.sourceStamps).toEqual(topologyRows[1]!.sourceStamps);
  const summary = readFileSync(join(root, SUMMARY), "utf8");
  expect(summary).toContain("| `process.shop.web` Web | `compose.yaml` |");
  expect(summary).toContain("| `namespace.shop.pod` Shop pod | `k8s/*.yaml` |");
  expect(summary).toContain("| `process.shop.cron` Cron | model-authored, no source anchor |");

  const fresh = projectionResult(runProjectionCheckCommand(checkRequest(), root));
  expect(fresh.freshness).toMatchObject({ ok: true, staleNodes: [] });
  for (const path of [DIAGRAM, SUMMARY]) {
    const change = fresh.changes!.find((entry) => entry.path === path)!;
    expect(change.stampChanged, path).toBe(false);
    expect(change.reasonCodes, path).not.toContain("source-stamp-changed");
  }
}, TIMEOUT_MS);

test("editing a file in a topology node's source.include marks both topology targets stale", () => {
  write("compose.yaml", "services:\n  web:\n    image: shop:2\n");
  git("add", "-A");
  git("commit", "-q", "-m", "bump the web image");

  const check = projectionResult(runProjectionCheckCommand(checkRequest(), root));
  for (const path of [DIAGRAM, SUMMARY]) {
    const change = check.changes!.find((entry) => entry.path === path)!;
    expect(change.stampChanged, path).toBe(true);
    expect(change.reasonCodes, path).toContain("source-stamp-changed");
    // The model did not change, so the rendered bytes did not either: only the stamp moved.
    expect(change.reasonCodes, path).not.toContain("rendered-output-changed");
  }
  for (const change of check.changes!.filter((entry) => entry.path !== DIAGRAM && entry.path !== SUMMARY)) {
    expect(change.reasonCodes, change.path).not.toContain("source-stamp-changed");
  }
  expect(check.freshness?.ok).toBe(false);
  expect(check.freshness?.staleNodes.map((entry) => entry.nodeId)).toEqual(["process.shop.web"]);

  // The daemonless freshness surface agrees, and a scoped probe selects the topology node by path.
  const scoped = runProjectionFreshnessCommand(root, { changedPaths: ["compose.yaml"] });
  expect(scoped.ok, JSON.stringify(scoped)).toBe(true);
  expect((scoped.data as any).freshness.staleNodes.map((entry: { nodeId: string }) => entry.nodeId)).toEqual(["process.shop.web"]);
}, TIMEOUT_MS);
