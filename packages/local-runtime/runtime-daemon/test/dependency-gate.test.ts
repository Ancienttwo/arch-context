import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stableYaml, type Json } from "@archcontext/contracts";
import { CodeGraphAdapter, codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { createStartedDaemon } from "../src/index";

const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-dependency-gate-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

const roots: string[] = [];

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const root of [...roots, STATE_ROOT]) rmSync(root, { recursive: true, force: true });
});

const CONSTRAINT_ID = "constraint.fixture.core-not-runtime";
const LEAK_FILE = "packages/core/src/leak.ts";

function write(root: string, path: string, body: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body, "utf8");
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

/**
 * A two-workspace repository whose model forbids core -> runtime. `packages/core/src/leak.ts` is
 * left untracked on purpose: the violating file exists in the index and the worktree, not in HEAD.
 */
async function fixture(options: {
  leak: boolean;
  index: boolean;
  /** Root `package.json` workspaces; literal directories by default. */
  workspaces?: string[];
  /** The leak's import specifier; a relative path by default. */
  leakSpecifier?: string;
  /** Replaces the init review policy before the fixture commit. */
  policyBody?: string;
  /** Extra top-level constraint fields. */
  constraintExtra?: Record<string, Json>;
}) {
  const root = mkdtempSync(join(tmpdir(), "archctx-dependency-gate-"));
  roots.push(root);
  const workspaces = options.workspaces ?? ["packages/core", "packages/runtime"];
  write(root, "package.json", `${JSON.stringify({ name: "fixture", private: true, workspaces }, null, 2)}\n`);
  write(root, "packages/core/package.json", `${JSON.stringify({ name: "@fixture/core", exports: { ".": "./src/index.ts" } }, null, 2)}\n`);
  write(root, "packages/core/src/index.ts", "export const core = 1;\n");
  write(root, "packages/runtime/package.json", `${JSON.stringify({ name: "@fixture/runtime", exports: { ".": "./src/index.ts" } }, null, 2)}\n`);
  write(root, "packages/runtime/src/index.ts", "import { core } from \"@fixture/core\";\nexport const runtime = core + 1;\n");
  git(root, "init", "-q");

  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  expect((await daemon.init(root, "Dependency Gate Fixture")).ok).toBe(true);
  for (const [id, include] of [["module.fixture.core", "packages/core/**"], ["module.fixture.runtime", "packages/runtime/**"]] as const) {
    write(root, `.archcontext/model/nodes/${id}.yaml`, stableYaml({
      schemaVersion: "archcontext.node/v2",
      id,
      kind: "module",
      name: id,
      parent: "capability.architecture.context",
      status: "active",
      summary: "fixture",
      source: { include: [include] }
    } as Json));
  }
  write(root, `.archcontext/model/constraints/${CONSTRAINT_ID}.yaml`, stableYaml({
    schemaVersion: "archcontext.constraint/v1",
    id: CONSTRAINT_ID,
    name: "Core does not depend on the runtime",
    severity: "error",
    scope: { nodes: ["module.fixture.core"] },
    rule: { type: "forbid-dependency", targets: ["module.fixture.runtime"] },
    rationale: "The runtime depends on core, never the reverse.",
    ...options.constraintExtra
  } as Json));
  if (options.policyBody !== undefined) write(root, ".archcontext/policies/review.yaml", options.policyBody);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  if (options.leak) {
    write(root, LEAK_FILE, `import { runtime } from ${JSON.stringify(options.leakSpecifier ?? "../../runtime/src/index")};\nexport const leak = runtime;\n`);
  }
  if (options.index) {
    const invocation = codeGraphCliInvocation("codegraph", root);
    execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  }
  return { root, daemon };
}

describe("complete_task dependency constraint gate (#163)", () => {
  test("an untracked core -> runtime import is an error-level prohibited-dependency finding", async () => {
    const { root, daemon } = await fixture({ leak: true, index: true });
    try {
      const review = await daemon.completeTask(root, { taskSessionId: "task_dependency_gate" });

      expect(review.ok, JSON.stringify(review)).toBe(true);
      const data = review.data as any;
      expect(data.extensions.dependencyConstraintGate).toMatchObject({ status: "violated", coverage: "complete", reasonCodes: [] });
      expect(data.findings).toContainEqual(expect.objectContaining({
        id: `prohibited-dependency:${CONSTRAINT_ID}:${LEAK_FILE}->packages/runtime/src/index.ts`,
        type: "prohibited-dependency",
        severity: "error"
      }));
      expect(data.result).toBe("fail_action_required");
      // The init policy enforces every category, so nothing was downgraded.
      expect(data.extensions.reviewPolicy).toMatchObject({ source: "policy-file", downgradedFindingIds: [] });
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("the allowed direction alone passes the gate over a complete index", async () => {
    const { root, daemon } = await fixture({ leak: false, index: true });
    try {
      const review = await daemon.completeTask(root, { taskSessionId: "task_dependency_gate" });

      const data = review.data as any;
      expect(data.extensions.dependencyConstraintGate).toMatchObject({ status: "pass", coverage: "complete", violations: [] });
      expect(data.extensions.dependencyConstraintGate.importEdgeCount).toBeGreaterThan(0);
      expect(data.findings.filter((finding: any) => finding.type === "prohibited-dependency")).toEqual([]);
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("without a code index the answer is Cannot determine and blocks, never a pass", async () => {
    const { root, daemon } = await fixture({ leak: true, index: false });
    try {
      const review = await daemon.completeTask(root, { taskSessionId: "task_dependency_gate" });

      expect(review.ok, JSON.stringify(review)).toBe(true);
      const data = review.data as any;
      expect(data.extensions.dependencyConstraintGate).toMatchObject({
        status: "undetermined",
        coverage: "unknown",
        reasonCodes: ["code-facts-unavailable"]
      });
      const finding = data.findings.find((entry: any) => entry.id === "prohibited-dependency:undetermined");
      expect(finding).toMatchObject({ type: "prohibited-dependency", severity: "error" });
      expect(finding.message.startsWith("Cannot determine")).toBe(true);
      expect(data.result).toBe("fail_action_required");
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("a packages/* workspace resolves a bare workspace specifier to the violation", async () => {
    const { root, daemon } = await fixture({ leak: true, index: true, workspaces: ["packages/*"], leakSpecifier: "@fixture/runtime" });
    try {
      const review = await daemon.completeTask(root, { taskSessionId: "task_dependency_gate" });

      expect(review.ok, JSON.stringify(review)).toBe(true);
      const data = review.data as any;
      expect(data.extensions.dependencyConstraintGate).toMatchObject({ status: "violated", reasonCodes: [], unresolvedImports: [] });
      expect(data.findings).toContainEqual(expect.objectContaining({
        id: `prohibited-dependency:${CONSTRAINT_ID}:${LEAK_FILE}->packages/runtime/src/index.ts`,
        severity: "error"
      }));
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("allowedVia validates with a not-enforced warning and the violation is still reported", async () => {
    const { root, daemon } = await fixture({ leak: true, index: true, constraintExtra: { allowedVia: ["module.fixture.runtime"] } });
    try {
      const validation = await daemon.validate(root);
      expect(validation.data).toMatchObject({ valid: true, errors: [] });
      expect((validation.data as any).warnings).toEqual([
        `.archcontext/model/constraints/${CONSTRAINT_ID}.yaml: constraint ${CONSTRAINT_ID} allowedVia is not enforced yet; the constraint is evaluated as if it were absent`
      ]);

      const review = await daemon.completeTask(root, { taskSessionId: "task_dependency_gate" });
      const data = review.data as any;
      expect(data.extensions.dependencyConstraintGate.status).toBe("violated");
      expect(data.result).toBe("fail_action_required");
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("an unsupported workspace pattern is undetermined and blocks instead of throwing", async () => {
    const { root, daemon } = await fixture({ leak: false, index: true, workspaces: ["packages/**"] });
    try {
      const review = await daemon.completeTask(root, { taskSessionId: "task_dependency_gate" });

      expect(review.ok, JSON.stringify(review)).toBe(true);
      const data = review.data as any;
      expect(data.extensions.dependencyConstraintGate).toMatchObject({ status: "undetermined", reasonCodes: ["workspace-resolution-failed"] });
      expect(data.findings).toContainEqual(expect.objectContaining({ id: "prohibited-dependency:undetermined", severity: "error" }));
      expect(data.result).toBe("fail_action_required");
    } finally {
      await daemon.stop();
    }
  }, 120_000);

  test("a malformed review policy cannot downgrade the invalid-schema finding it causes", async () => {
    const policies = [
      "failOn: []\nid: \"policy.review\"\nschemaVersion: \"archcontext.policy/v0\"\n",
      "failOn:\n  - \"stale-context\"\nid: \"policy.review\"\n"
    ];
    for (const policyBody of policies) {
      const { root, daemon } = await fixture({ leak: false, index: true, policyBody });
      try {
        const review = await daemon.completeTask(root, { taskSessionId: "task_dependency_gate" });

        expect(review.ok, JSON.stringify(review)).toBe(true);
        const data = review.data as any;
        expect(data.findings).toContainEqual(expect.objectContaining({ id: "invalid-schema", type: "invalid-schema", severity: "error" }));
        expect(data.findings.find((finding: any) => finding.id === "invalid-schema").message).toContain(".archcontext/policies/review.yaml");
        expect(data.extensions.reviewPolicy).toMatchObject({ source: "default", downgradedFindingIds: [] });
        expect(data.result).toBe("fail_action_required");
      } finally {
        await daemon.stop();
      }
    }
  }, 120_000);
});
