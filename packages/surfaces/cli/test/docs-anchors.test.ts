import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { docsAnchorsReportIssues, stableYaml, validateJsonSchema, type DocsAnchorsReportV1, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { resolveArchitectureDocumentationLayout, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runtimeStatePaths } from "@archcontext/local-runtime/local-store-sqlite";
import type { RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";
import { runCli } from "../src/main";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../../..");
const CLI_ENTRY = resolve(import.meta.dir, "../src/main.ts");
const SCHEMA = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "schemas/runtime/docs-anchors.schema.json"), "utf8"));
const TEST_TIMEOUT_MS = process.platform === "win32" ? 240_000 : 120_000;
const NODE_ID = "capability.billing";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(root: string, path: string, body: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body, "utf8");
}

/**
 * A committed repository with one cited capability. The module document has human-owned citations
 * of every kind, plus a generated region, a fenced block and gitignored paths that must be ignored.
 */
function seedFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-docs-anchors-"));
  git(root, "init", "-q");
  initializeArchContextModel(root, "Docs Anchors App");
  write(root, ".gitignore", "src/billing/cache/\n");
  write(root, "src/billing/charge.ts", [
    "export function chargeCard(amount: number): number {",
    "  return amount;",
    "}",
    "",
    "export function retryCharge(): number {",
    "  return chargeCard(1);",
    "}",
    ""
  ].join("\n"));
  write(root, `.archcontext/model/nodes/${NODE_ID}.yaml`, stableYaml({
    schemaVersion: "archcontext.node/v2",
    id: NODE_ID,
    kind: "capability",
    name: "Billing",
    status: "active",
    summary: "Charges cards through `src/billing/charge.ts#chargeCard`; the old `src/billing/gone.ts` is gone.",
    responsibilities: ["Retry failed charges with `retryCharge()`.", "Refund through `removedRefund()`."],
    source: { include: ["src/billing/**"] }
  } as unknown as Json));
  const model = loadNativeModelFromArchContext(root);
  const documentPath = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations }).entityPathByNodeId.get(NODE_ID)!;
  write(root, documentPath, [
    "# Billing",
    "Valid: `src/billing/charge.ts:2`, `src/billing/charge.ts#chargeCard`, `src/billing` and `charge.ts:6` (`retryCharge`).",
    "Missing path: `src/billing/legacy.ts`.",
    "Missing symbol: `src/billing/charge.ts#refundCard`.",
    "Out of range: `src/billing/charge.ts:40`.",
    "Moved: `src/billing/charge.ts:12` (`retryCharge`).",
    "Not citations: `application/json`, `notASymbolAtAll`, `src/billing/cache/state.json`.",
    "<!-- BEGIN ARCHCONTEXT:generated target=\"projection_target.entity.capability-billing\" sourceDigest=\"sha256:0\" -->",
    "Generated: `src/billing/generated-only.ts` and `src/billing/charge.ts:999`.",
    "<!-- END ARCHCONTEXT:generated target=\"projection_target.entity.capability-billing\" -->",
    "```text",
    "`src/billing/fenced.ts`",
    "```",
    ""
  ].join("\n"));
  git(root, "add", "-A");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "fixture");
  return root;
}

const noRuntime = new Proxy({}, {
  get(_target, property) {
    throw new Error(`docs anchors reached the runtime: ${String(property)}`);
  }
}) as unknown as RuntimeDaemonClient;

/** Runs `docs anchors` in-process with an isolated state root, and checks that it wrote nothing. */
async function runAnchors(root: string, args: string[] = ["--json"]): Promise<DocsAnchorsReportV1> {
  const stateRoot = join(dirname(root), `.archctx-state-${root.split("/").pop()}`);
  const previousStateDir = process.env.ARCHCONTEXT_STATE_DIR;
  const statusBefore = git(root, "status", "--porcelain");
  process.env.ARCHCONTEXT_STATE_DIR = stateRoot;
  let result: Awaited<ReturnType<typeof runCli>>;
  try {
    result = await runCli("docs", ["anchors", ...args], root, { runtimeClient: noRuntime });
  } finally {
    if (previousStateDir === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previousStateDir;
  }
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(existsSync(stateRoot)).toBe(false);
  expect(existsSync(runtimeStatePaths(root, { ...process.env, ARCHCONTEXT_STATE_DIR: stateRoot }).stateRoot)).toBe(false);
  expect(git(root, "status", "--porcelain")).toBe(statusBefore);
  const report = (result as JsonEnvelope).data as unknown as DocsAnchorsReportV1;
  expect(docsAnchorsReportIssues(report)).toEqual([]);
  expect(validateJsonSchema(SCHEMA, report as unknown as Json).issues).toEqual([]);
  return report;
}

function findings(report: DocsAnchorsReportV1) {
  return report.nodes.flatMap((node) => node.findings.map((finding) => [
    node.nodeId,
    finding.kind,
    finding.citation.text,
    finding.origin.kind === "document" ? finding.origin.line : finding.origin.kind,
    finding.currentLines ?? finding.lineCount ?? null
  ]));
}

test("docs anchors reports stale citations with CodeGraph, and ignores generated and fenced text", async () => {
  const root = seedFixture();
  try {
    execFileSync("codegraph", ["init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const report = await runAnchors(root);
    expect(report.profile).toBe("default");
    expect(report.codeGraph).toEqual({ availability: "ready" });
    expect(findings(report)).toEqual([
      [NODE_ID, "missing-path", "src/billing/gone.ts", "node-summary", null],
      [NODE_ID, "missing-symbol", "removedRefund()", "node-responsibility", null],
      [NODE_ID, "missing-path", "src/billing/legacy.ts", 3, null],
      [NODE_ID, "missing-symbol", "src/billing/charge.ts#refundCard", 4, null],
      [NODE_ID, "line-out-of-range", "src/billing/charge.ts:40", 5, 7],
      [NODE_ID, "line-moved", "src/billing/charge.ts:12", 6, [5]]
    ]);
    const node = report.nodes[0]!;
    expect(node.unchecked).toEqual([]);
    // summary 2 + responsibilities 2 + valid line 4 + one per finding line 4.
    expect(node.citationCount).toBe(12);
    expect(report.summary).toEqual(expect.objectContaining({ documents: 1, citations: 12, findings: 6, unchecked: 0 }));
    expect(report.summary.byKind).toEqual({ "line-moved": 1, "line-out-of-range": 1, "missing-path": 2, "missing-symbol": 2 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, TEST_TIMEOUT_MS);

test("docs anchors without a CodeGraph index still checks paths and lines and reports symbol checks as unchecked", async () => {
  const root = seedFixture();
  try {
    expect(existsSync(join(root, ".codegraph"))).toBe(false);
    const report = await runAnchors(root, []);
    expect(report.codeGraph).toEqual({ availability: "unavailable", reasonCode: "index-missing" });
    expect(findings(report)).toEqual([
      [NODE_ID, "missing-path", "src/billing/gone.ts", "node-summary", null],
      [NODE_ID, "missing-path", "src/billing/legacy.ts", 3, null],
      [NODE_ID, "line-out-of-range", "src/billing/charge.ts:40", 5, 7],
      [NODE_ID, "line-out-of-range", "src/billing/charge.ts:12", 6, 7]
    ]);
    expect(report.nodes[0]!.unchecked.map((entry) => [entry.reasonCode, entry.citation.text])).toEqual([
      ["codegraph-unavailable", "src/billing/charge.ts#chargeCard"],
      ["codegraph-unavailable", "retryCharge()"],
      ["codegraph-unavailable", "removedRefund()"],
      ["codegraph-unavailable", "src/billing/charge.ts#chargeCard"],
      ["codegraph-unavailable", "charge.ts:6"],
      ["codegraph-unavailable", "src/billing/charge.ts#refundCard"],
      ["codegraph-unavailable", "src/billing/charge.ts:12"]
    ]);

    // A real process with no runtime client injected answers the same and starts no daemon.
    const stateRoot = join(dirname(root), `.archctx-state-process-${root.split("/").pop()}`);
    const output = execFileSync("bun", [CLI_ENTRY, "docs", "anchors", "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ARCHCONTEXT_STATE_DIR: stateRoot },
      timeout: TEST_TIMEOUT_MS
    });
    expect(JSON.parse(output).data).toEqual(report);
    expect(existsSync(stateRoot)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, TEST_TIMEOUT_MS);

test("docs anchors validates its flags without reading the repository", async () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-docs-anchors-flags-"));
  try {
    const help = await runCli("docs", ["anchors", "--help"], root, { runtimeClient: noRuntime }) as JsonEnvelope;
    expect(help.ok).toBe(true);
    expect((help.data as { capability?: string }).capability).toBe("docs-anchors-v1");
    const unknown = await runCli("docs", ["anchors", "--fix"], root, { runtimeClient: noRuntime }) as JsonEnvelope;
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe("AC_SCHEMA_INVALID");
    const profile = await runCli("docs", ["anchors", "--profile", "other/v9"], root, { runtimeClient: noRuntime }) as JsonEnvelope;
    expect(profile.ok).toBe(false);
    expect(profile.error?.code).toBe("AC_SCHEMA_INVALID");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
