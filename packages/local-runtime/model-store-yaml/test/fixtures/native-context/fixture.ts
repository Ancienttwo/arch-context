import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ARCHITECTURE_DOCS_RENDERER_VERSION, digestJson, stableYaml, type Json, type NativeModelRecord } from "@archcontext/contracts";

export const CAPABILITY_ID = "capability.demo.feature";
export const MODULE_DOCUMENT = "docs/architecture/modules/demo/feature.md";
export const TARGET_ID = "projection_target.entity.capability-demo-feature";
export const SELECTOR = { entrypointId: "entrypoint.demo.worker", sourceSymbol: "run", sinkId: "sink.demo.done" };

export function fixtureModel(): { nodes: NativeModelRecord[]; relations: NativeModelRecord[]; flows: NativeModelRecord[] } {
  const nodes: NativeModelRecord[] = [
    { schemaVersion: "archcontext.node/v2", id: CAPABILITY_ID, kind: "capability", name: "Demo", status: "active", summary: "Complete native demo", extensions: { contractFiles: { agents: "AGENTS.md", claude: "CLAUDE.md" } }, source: { include: ["src/app/[locale]/**", "src/a.ts", "src/a-*.ts", "**/*.ts"] } },
    { schemaVersion: "archcontext.node/v2", id: "module.demo.system", kind: "module", name: "System", status: "active", summary: "System", parent: CAPABILITY_ID },
    { schemaVersion: "archcontext.node/v2", id: "component.demo.worker", kind: "component", name: "", status: "planned", summary: "", parent: "module.demo.system", responsibilities: ["Work"], notes: ["Preserve fields"], criticality: "medium", riskDomains: ["integrity"], ownership: { lifecycle: ["demo"] }, interfaces: { provides: ["worker"] }, extensions: { example: { preserved: true } }, source: { include: ["src/worker.ts"], exclude: ["src/worker.test.ts"], entrypoints: [{ id: SELECTOR.entrypointId, path: "src/worker.ts", symbols: [{ name: SELECTOR.sourceSymbol, sinks: [{ id: SELECTOR.sinkId, path: "src/done.ts", symbol: "finish" }] }] }] } },
    ...(["interface", "event", "datastore", "external-system", "deployment"] as const).map((kind, index) => ({ schemaVersion: "archcontext.node/v2", id: `${kind === "external-system" ? "external" : kind}.demo.resource`, kind, name: kind, status: index % 2 === 0 ? "deprecated" : "removed", summary: kind, parent: CAPABILITY_ID }))
  ];
  const step = (id: string, from: string, to: string) => ({ id, from, to, label: id, evidence: { ...SELECTOR } });
  return { nodes, relations: [{ schemaVersion: "archcontext.relation/v1", id: "relation.demo.call", kind: "calls", source: "interface.demo.resource", target: "component.demo.worker", via: "interface.demo.resource", intent: "" }], flows: [
    { schemaVersion: "archcontext.flow/v1", id: "flow.demo.primary", capabilityId: CAPABILITY_ID, name: "Primary", applicability: "required", participants: [{ id: "caller", nodeId: "interface.demo.resource" }, { id: "worker", nodeId: "component.demo.worker" }], steps: [step("request", "caller", "worker")], outcomes: [{ id: "ok", kind: "success", label: "Success", steps: [step("ok", "worker", "caller")], terminal: { participant: "caller", label: "Success" } }, { id: "failed", kind: "error", label: "Error", steps: [step("failed", "worker", "caller")], terminal: { participant: "caller", label: "Error" } }] },
    { schemaVersion: "archcontext.flow/v1", id: "flow.demo.optional", capabilityId: CAPABILITY_ID, name: "Not applicable", applicability: "not-applicable", rationale: "No corresponding flow." }
  ] };
}

export function fixtureDocument(newline = "\r\n"): string {
  const generated = "Generated P1/P2\n";
  const digest = digestJson({ targetId: TARGET_ID, body: generated });
  return ["\uFEFF# Demo", "", `<!-- BEGIN ARCHCONTEXT:generated target="${TARGET_ID}" rendererVersion="${ARCHITECTURE_DOCS_RENDERER_VERSION}" outputDigest="${digest}" -->`, generated.trimEnd(), `<!-- END ARCHCONTEXT:generated target="${TARGET_ID}" -->`, "", "## 3. P3: Design Decisions and Invariants", "", "Human café 🧭.", "<!-- keep this comment -->", "```md", "## Example heading", "<!-- BEGIN ARCHCONTEXT:generated literal -->", "```", "### Nested detail", "", "## Optimization Backlog", " \t", ""].join(newline);
}

export function writeFixtureFile(root: string, path: string, body: string | Buffer): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
}
export function fixtureGit(root: string, args: string[]): string {
  return execFileSync("git", ["-c", `core.hooksPath=${join(root, ".git/native-no-hooks")}`, "-c", "core.fsmonitor=false", "-c", "gc.auto=0", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
export function commitFixture(root: string, message = "native fixture"): string {
  fixtureGit(root, ["add", "--all"]);
  fixtureGit(root, ["-c", "user.name=Native Export Fixture", "-c", "user.email=native-export@example.test", "commit", "--quiet", "-m", message]);
  return fixtureGit(root, ["rev-parse", "HEAD"]);
}
export function createNativeFixture(options: { missingContracts?: boolean; document?: string | null; objectFormat?: "sha256" } = {}): { root: string; commit: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "archctx-native-fixture-"));
  try {
    fixtureGit(root, ["init", "--quiet", "--initial-branch=main", ...(options.objectFormat ? [`--object-format=${options.objectFormat}`] : [])]);
    fixtureGit(root, ["config", "core.autocrlf", "false"]);
    writeFixtureFile(root, ".archcontext/manifest.yaml", stableYaml({ schemaVersion: "archcontext.manifest/v1", model: { layout: "split", root: ".archcontext/model" }, runtime: { contextBudgetBytes: 64 } }));
    const model = fixtureModel();
    for (const kind of ["nodes", "relations", "flows"] as const) for (const value of model[kind]) writeFixtureFile(root, `.archcontext/model/${kind}/${value.id}.yaml`, stableYaml(value));
    if (!options.missingContracts) { writeFixtureFile(root, "AGENTS.md", "# Agent contract\r\n\r\n"); writeFixtureFile(root, "CLAUDE.md", ""); }
    if (options.document !== null) writeFixtureFile(root, MODULE_DOCUMENT, options.document ?? fixtureDocument());
    writeFixtureFile(root, "src/unrelated.ts", "export const source = 1;\n");
    const commit = commitFixture(root);
    return { root, commit, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}
