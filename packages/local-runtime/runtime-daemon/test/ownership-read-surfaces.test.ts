import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, type ChangeSetOwnershipDeltaV1, type JsonEnvelope } from "@archcontext/contracts";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { CapabilityDependenciesError, createStartedDaemon, readCapabilityDependencies } from "../src/index";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { rmSync } from "./runtime-test-fixtures";

const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-ownership-read-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

const roots: string[] = [];

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const root of [...roots, STATE_ROOT]) rmSync(root, { recursive: true, force: true });
});

const BILLING = ".archcontext/model/nodes/capability.billing.yaml";
const CHECKOUT = ".archcontext/model/nodes/capability.checkout.yaml";

function nodeYaml(id: string, include: string[], extra: string[] = []): string {
  return [
    `id: "${id}"`,
    'kind: "capability"',
    `name: "${id}"`,
    'schemaVersion: "archcontext.node/v2"',
    ...extra,
    "source:",
    "  include:",
    ...include.map((pattern) => `    - "${pattern}"`),
    'status: "active"',
    `summary: "Owns ${include.join(", ")}."`,
    ""
  ].join("\n");
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

/** Two committed capabilities: billing owns `src/billing/**`, checkout owns `src/checkout/**`. */
function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "archctx-ownership-read-"));
  roots.push(root);
  for (const path of ["src/billing/invoice.ts", "src/billing/chatgpt/browser.ts", "src/checkout/cart.ts", "src/loose/tool.ts"]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), `export const value = ${JSON.stringify(path)};\n`, "utf8");
  }
  initializeArchContextModel(root, "Ownership Read App");
  writeFileSync(join(root, BILLING), nodeYaml("capability.billing", ["src/billing/**"]), "utf8");
  writeFileSync(join(root, CHECKOUT), nodeYaml("capability.checkout", ["src/checkout/**"]), "utf8");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

function startDaemon() {
  return createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
}

function hashOf(root: string, path: string): string {
  return digestJson({ body: readFileSync(join(root, path), "utf8") });
}

function ownershipDeltaOf(envelope: JsonEnvelope): ChangeSetOwnershipDeltaV1 | undefined {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  return (envelope.data as unknown as { preview: { ownershipDelta?: ChangeSetOwnershipDeltaV1 } }).preview.ownershipDelta;
}

function treeSnapshot(root: string): string {
  const walk = (directory: string): string[] => readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.name === ".git") return [];
    return entry.isDirectory() ? walk(path) : [`${path}:${digestJson({ body: readFileSync(join(root, path), "utf8") })}`];
  });
  return walk("").sort().join("\n");
}

describe("plan preview ownership delta (#301)", () => {
  test("an include change reports newly contested and newly owned files with paths, and writes nothing", async () => {
    const root = createRepo();
    const daemon = await startDaemon();
    try {
      const before = treeSnapshot(root);
      // Checkout claims a billing subtree (contested: the two capabilities are on different chains)
      // and the loose tool directory (newly owned).
      const envelope = await daemon.planUpdate(root, {
        id: "changeset.checkout-include",
        operations: [{
          op: "update_entity_fields",
          path: CHECKOUT,
          expectedHash: hashOf(root, CHECKOUT),
          body: nodeYaml("capability.checkout", ["src/checkout/**", "src/billing/chatgpt/**", "src/loose/**"])
        }]
      });
      const delta = ownershipDeltaOf(envelope);
      expect(delta).toMatchObject({
        schemaVersion: "archcontext.changeset-ownership-delta/v1",
        status: "computed",
        ownershipRule: "parent-chain",
        fileUniverse: "head-tracked-files",
        changedNodeIds: ["capability.checkout"],
        before: { multiplyOwnedFileCount: 0 },
        after: { multiplyOwnedFileCount: 1 }
      });
      if (delta?.status !== "computed") throw new Error("expected a computed delta");
      expect(delta.becameContested.files).toEqual([
        { path: "src/billing/chatgpt/browser.ts", before: ["capability.billing"], after: ["capability.billing", "capability.checkout"] }
      ]);
      expect(delta.becameOwned.files).toEqual([{ path: "src/loose/tool.ts", before: [], after: ["capability.checkout"] }]);
      expect(delta.ownerChanged.count).toBe(0);
      expect(delta.becameUnowned.count).toBe(0);
      // Preview stays read-only: the tree is byte-identical after the plan.
      expect(treeSnapshot(root)).toBe(before);
    } finally {
      await daemon.stop();
    }
  });

  test("deleting a node with a footprint reports the files it owned as newly unowned", async () => {
    const root = createRepo();
    const daemon = await startDaemon();
    try {
      const delta = ownershipDeltaOf(await daemon.planUpdate(root, {
        id: "changeset.delete-billing",
        operations: [{ op: "delete_entity", path: BILLING, expectedHash: hashOf(root, BILLING) }]
      }));
      if (delta?.status !== "computed") throw new Error(`expected a computed delta, got ${JSON.stringify(delta)}`);
      expect(delta.changedNodeIds).toEqual(["capability.billing"]);
      expect(delta.becameUnowned.files.map((file) => file.path)).toEqual(["src/billing/chatgpt/browser.ts", "src/billing/invoice.ts"]);
    } finally {
      await daemon.stop();
    }
  });

  test("a planned node body that does not parse reports the delta as unavailable without failing the plan", async () => {
    const root = createRepo();
    const daemon = await startDaemon();
    try {
      const delta = ownershipDeltaOf(await daemon.planUpdate(root, {
        id: "changeset.broken-body",
        operations: [{ op: "update_entity_fields", path: CHECKOUT, expectedHash: hashOf(root, CHECKOUT), body: "id: [unterminated\n" }]
      }));
      expect(delta).toMatchObject({ schemaVersion: "archcontext.changeset-ownership-delta/v1", status: "unavailable" });
      expect((delta as { reason: string }).reason.length).toBeGreaterThan(0);
    } finally {
      await daemon.stop();
    }
  });

  test("a plan that writes no node file carries no ownership delta", async () => {
    const root = createRepo();
    const daemon = await startDaemon();
    try {
      const path = ".archcontext/model/relations/relation.checkout-billing.yaml";
      const envelope = await daemon.planUpdate(root, {
        id: "changeset.relation-only",
        operations: [{
          op: "create_entity",
          path,
          expectedHash: "missing",
          body: [
            'id: "relation.checkout-billing"',
            'kind: "uses"',
            'source: "capability.checkout"',
            'target: "capability.billing"',
            'intent: "charges the cart"',
            ""
          ].join("\n")
        }]
      });
      expect(ownershipDeltaOf(envelope)).toBeUndefined();
    } finally {
      await daemon.stop();
    }
  });
});

describe("refactor scan untracked exclusion (#301)", () => {
  test("the scan states how many worktree files outside HEAD it excluded", async () => {
    const root = createRepo();
    writeFileSync(join(root, ".gitignore"), "ignored.log\n", "utf8");
    git(root, "add", ".gitignore");
    git(root, "commit", "-q", "-m", "ignore");
    // One untracked file, one newly staged file, one ignored file: only the first two count.
    writeFileSync(join(root, "src/checkout/untracked.ts"), "export const untracked = 1;\n", "utf8");
    writeFileSync(join(root, "src/checkout/staged.ts"), "export const staged = 1;\n", "utf8");
    git(root, "add", "src/checkout/staged.ts");
    writeFileSync(join(root, "ignored.log"), "noise\n", "utf8");
    const daemon = await startDaemon();
    try {
      const envelope = await daemon.refactorScan(root);
      expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
      const data = envelope.data as { trackedFileCount: number; untrackedExcludedCount: number };
      expect(data.untrackedExcludedCount).toBe(2);
      expect(publishedSchemaIssues("runtime/runtime-refactor-scan.schema.json", envelope.data)).toEqual([]);
      // The measured set is still exactly the HEAD tree.
      const headBlobs = git(root, "ls-tree", "-r", "--name-only", "HEAD").trim().split("\n");
      expect(data.trackedFileCount).toBe(headBlobs.length);
    } finally {
      await daemon.stop();
    }
  });
});

describe("deps workspace discovery (#301)", () => {
  test("an unsupported workspace glob is a typed input error, not a runtime failure", () => {
    const root = createRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/**"] }), "utf8");
    let caught: unknown;
    try {
      readCapabilityDependencies(root, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CapabilityDependenciesError);
    expect(caught).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "deps-workspace-invalid" });
  });
});
