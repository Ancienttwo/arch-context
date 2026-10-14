import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stableYaml } from "@archcontext/contracts";
import { loadNativeModelFromArchContext, resolveArchitectureDocumentationLayout } from "@archcontext/core/projection-engine";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { readArchitectureDebt } from "../../../src/architecture-debt";

export function write(root: string, path: string, body: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body);
}
export function nodeA(include = "src/a/*.ts", summary = "Owns A.") {
  return stableYaml({ schemaVersion: "archcontext.node/v2", id: "capability.a", kind: "capability",
    name: "A", status: "active", summary, source: { include: [include] } });
}
export function seed() {
  const root = mkdtempSync(join(tmpdir(), "archctx-d5-inputs-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=.git/no-hooks",
    "-c", "user.name=D5 Fixture", "-c", "user.email=d5@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: "pipe" });
  git("init", "-q"); initializeArchContextModel(root, "Read Inputs");
  write(root, ".gitignore", ".codegraph/\n.archcontext/.local/\n");
  write(root, "src/a/main.ts", "export const value = 1;\n");
  write(root, ".archcontext/model/nodes/capability.a.yaml", nodeA());
  write(root, ".archcontext/model/nodes/capability.b.yaml", stableYaml({ schemaVersion: "archcontext.node/v2",
    id: "capability.b", kind: "capability", name: "B", status: "active", summary: "Owns B.", source: { include: ["src/b/**"] } }));
  const model = loadNativeModelFromArchContext(root);
  const document = resolveArchitectureDocumentationLayout({ nodes: model.nodes, relations: model.relations }).entityPathByNodeId.get("capability.b")!;
  write(root, document, "# B\nCitation: `src/a/main.ts:1` and `src/a/main.ts#value`.\n");
  git("add", "-A"); git("commit", "-qm", "read inputs fixture");
  return { root, document };
}
export function bytes(root: string): string {
  const hash = (path: string) => createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
  const walk = (path: string): unknown => readdirSync(join(root, path), { withFileTypes: true })
    .filter(entry => entry.name !== ".git").sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => { const p = join(path, entry.name); return [p, entry.isDirectory() ? walk(p) : hash(p)]; });
  return JSON.stringify({ files: walk(""), gitIndex: hash(".git/index") });
}
export function states(root: string, document: string) {
  const rows: { label: string; report: ReturnType<typeof readArchitectureDebt> }[] = [];
  const read = (label: string, changedPaths: string[]) => {
    const before = bytes(root); const report = readArchitectureDebt(root, { changedPaths });
    if (bytes(root) !== before) throw new Error("D5 reader changed repository bytes");
    rows.push({ label, report });
  };
  read("initial-index-missing", ["src/a/main.ts"]);
  write(root, "src/a/new/tool.ts", "export const tool = 1;\n");
  read("added-unowned-file", ["src/a/new/tool.ts"]);
  rmSync(join(root, "src/a/main.ts"));
  read("deleted-cited-file", ["src/a/main.ts"]);
  write(root, ".archcontext/model/nodes/capability.a.yaml", nodeA("src/a/**"));
  read("model-ownership-change", [".archcontext/model/nodes/capability.a.yaml"]);
  write(root, document, "# B\nCitation: `src/a/new/tool.ts:1` and `src/a/new/tool.ts#tool`.\n");
  read("repaired-citation", ["src/a/new/tool.ts"]);
  write(root, ".archcontext/model/nodes/capability.a.yaml", nodeA("src/a/**", "See `src/a/missing.ts:1`."));
  read("model-prose-change", [".archcontext/model/nodes/capability.a.yaml"]);
  write(root, ".codegraph/codegraph.db", "unavailable-index");
  read("index-unavailable", ["src/a/new/tool.ts"]);
  return rows;
}

