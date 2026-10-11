import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableYaml, type CapabilityDependenciesV1, type JsonEnvelope } from "@archcontext/contracts";
import { codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "../src/main";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";

let root = "";
let stateRoot = "";
const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;

function node(id: string, kind: string, include: string[], parent?: string) {
  return stableYaml({
    schemaVersion: "archcontext.node/v2",
    id,
    kind,
    name: id,
    status: "active",
    summary: `Owns ${include.join(", ")}.`,
    ...(parent ? { parent } : {}),
    source: { include }
  });
}

/**
 * Billing and checkout capabilities, a nested component, real imports between them, and one
 * import-shaped string literal that is not an import. Indexed by the real CodeGraph CLI.
 */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "archctx-cli-deps-"));
  stateRoot = mkdtempSync(join(tmpdir(), "archctx-cli-deps-state-"));
  process.env.ARCHCONTEXT_STATE_DIR = stateRoot;
  const files: Record<string, string> = {
    "src/billing/invoice.ts": "export const invoice = 1;\n",
    "src/billing/ledger.ts": 'import { invoice } from "./invoice";\nexport const ledger = invoice;\n',
    "src/checkout/cart/cart.ts": 'import { invoice } from "../../billing/invoice";\nexport const cart = invoice;\n',
    "src/checkout/pay.ts": [
      'import { ledger } from "../billing/ledger";',
      'import { cart } from "./cart/cart";',
      // Import-shaped text in a string literal: never an import edge.
      'export const example = "import { invoice } from \\"../billing/invoice\\"";',
      "export const pay = ledger + cart;",
      ""
    ].join("\n")
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body, "utf8");
  }
  initializeArchContextModel(root, "CLI Deps App");
  const nodes = join(root, ".archcontext/model/nodes");
  writeFileSync(join(nodes, "capability.billing.yaml"), node("capability.billing", "capability", ["src/billing/**"]), "utf8");
  writeFileSync(join(nodes, "capability.checkout.yaml"), node("capability.checkout", "capability", ["src/checkout/**"]), "utf8");
  writeFileSync(join(nodes, "component.cart.yaml"), node("component.cart", "component", ["src/checkout/cart/**"], "capability.checkout"), "utf8");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  git("init", "-q");
  writeFileSync(join(root, ".gitignore"), ".codegraph/\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  const invocation = codeGraphCliInvocation("codegraph", root);
  execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}, 300_000);

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const path of [root, stateRoot]) if (path) rmSync(path, { recursive: true, force: true });
});

function depsData(envelope: Pick<JsonEnvelope, "ok" | "data">): CapabilityDependenciesV1 {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  expect(publishedSchemaIssues("runtime/capability-dependencies.schema.json", envelope.data)).toEqual([]);
  return envelope.data as never;
}

describe("archctx deps (#301)", () => {
  test("reports the capability import matrix from the CodeGraph index, without string-literal edges", async () => {
    const data = depsData(await runCli("deps", ["--json"], root));
    expect(data.capabilities).toEqual(["capability.architecture.context", "capability.billing", "capability.checkout"]);
    expect(data.matrix).toEqual([
      { from: "capability.billing", to: "capability.billing", imports: 1, calls: null },
      { from: "capability.checkout", to: "capability.billing", imports: 2, calls: null },
      { from: "capability.checkout", to: "capability.checkout", imports: 1, calls: null }
    ]);
    expect(data.imports).toMatchObject({
      coverage: "complete",
      reasonCodes: [],
      truncated: false,
      importNodeCount: 4,
      importNodeLimitExceeded: false,
      edgeCount: 4
    });
    // pay.ts holds an import-shaped string naming invoice.ts; no edge pay.ts -> invoice.ts exists.
    expect(data.edges.items.some((edge) => edge.fromPath === "src/checkout/pay.ts" && edge.toPath === "src/billing/invoice.ts")).toBe(false);
    expect(data.calls).toEqual({ coverage: "unknown", reasonCodes: ["call-edges-not-exposed"] });
  }, 120_000);

  test("--into and --from filter by the owning node's subtree", async () => {
    const into = depsData(await runCli("deps", ["--into", "capability.billing"], root));
    expect(into.filter).toEqual({ from: null, into: "capability.billing" });
    expect(into.matrix.every((cell) => cell.to === "capability.billing")).toBe(true);
    expect(into.edges.items.map((edge) => `${edge.fromPath}->${edge.toPath}`)).toEqual([
      "src/billing/ledger.ts->src/billing/invoice.ts",
      "src/checkout/cart/cart.ts->src/billing/invoice.ts",
      "src/checkout/pay.ts->src/billing/ledger.ts"
    ]);
    const fromComponent = depsData(await runCli("deps", ["--from", "component.cart"], root));
    expect(fromComponent.edges.items.map((edge) => edge.fromPath)).toEqual(["src/checkout/cart/cart.ts"]);
    expect(fromComponent.matrix).toEqual([{ from: "capability.checkout", to: "capability.billing", imports: 1, calls: null }]);
  }, 120_000);

  test("reports a read limit below the index size as partial coverage with the count", async () => {
    const data = depsData(await runCli("deps", ["--import-node-limit", "2"], root));
    expect(data.imports).toMatchObject({
      coverage: "partial",
      reasonCodes: ["code-facts-import-limit"],
      truncated: false,
      importNodeCount: 4,
      importNodeLimit: 2,
      importNodeLimitExceeded: true
    });
  }, 120_000);

  test("refuses an unknown node and bad limits, and prints help", async () => {
    const unknown = await runCli("deps", ["--into", "capability.missing"], root);
    expect(unknown.ok).toBe(false);
    expect((unknown as { error: { code: string; message: string } }).error).toMatchObject({
      code: "AC_SCHEMA_INVALID",
      message: expect.stringContaining("capability.missing")
    });
    const badLimit = await runCli("deps", ["--import-node-limit", "0"], root);
    expect((badLimit as { error: { code: string } }).error.code).toBe("AC_SCHEMA_INVALID");
    const missingValue = await runCli("deps", ["--from"], root);
    expect((missingValue as { error: { code: string } }).error.code).toBe("AC_SCHEMA_INVALID");
    const help = await runCli("deps", ["--help"], root);
    expect(help.ok).toBe(true);
    expect(JSON.stringify(help.data)).toContain("--into <node-id>");
  });

  test("is read-only: no runtime state is created", async () => {
    await runCli("deps", ["--json"], root);
    expect(readdirSync(stateRoot)).toEqual([]);
  }, 120_000);
});
