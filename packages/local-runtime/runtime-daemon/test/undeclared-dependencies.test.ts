import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { okEnvelope, stableYaml, type JsonEnvelope, type ProjectionArchitectureDebtV1, type ProjectionRequestV1, type ProjectionResultV2 } from "@archcontext/contracts";
import { repositoryFingerprint } from "@archcontext/core/architecture-domain";
import { architectureDocumentationProjectionWorktreeDigest, loadNativeModelFromArchContext } from "@archcontext/core/projection-engine";
import { codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { listGitVisibleFiles, readHeadSha } from "@archcontext/local-runtime/git-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { CapabilityDependenciesError, readCapabilityDependencies } from "../src/index";
import { projectionWorkspaceId } from "../src/projection-inputs";
import { projectionArchitectureDebt } from "../src/projection-architecture-debt";
import { runProjectionCheckCommand, runProjectionProtocolCommand, type ProjectionServiceHost } from "../src/projection-service";
import { publishedSchemaIssues } from "../../../contracts/test/published-schemas";
import { rmSync } from "./runtime-test-fixtures";

const TIMEOUT_MS = 300_000;
const RELATION = ".archcontext/model/relations/relation.checkout.calls-billing.yaml";
const PREVIOUS_STATE_DIR = process.env.ARCHCONTEXT_STATE_DIR;
const STATE_ROOT = mkdtempSync(join(tmpdir(), "archctx-undeclared-deps-state-"));
process.env.ARCHCONTEXT_STATE_DIR = STATE_ROOT;

let root = "";

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function codegraph(...args: string[]): void {
  const invocation = codeGraphCliInvocation("codegraph", root);
  execFileSync(invocation.command, [...invocation.argsPrefix, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

/** A capability the repo-harness profile can lay out: it names its contract files. */
function capability(id: string, directory: string): string {
  return stableYaml({
    schemaVersion: "archcontext.node/v2",
    id,
    kind: "capability",
    name: id,
    status: "active",
    summary: `Owns ${directory}.`,
    source: { include: [`${directory}/**`] },
    extensions: { contractFiles: { agents: `${directory}/AGENTS.md`, claude: `${directory}/CLAUDE.md` } }
  });
}

function request(mode: "check" | "plan"): ProjectionRequestV1 {
  return {
    schemaVersion: "archcontext.projection-request/v1",
    requestId: `projection_request.undeclared_${mode}`,
    profile: "repo-harness/v1",
    mode,
    targets: ["agent-context", "architecture-docs"],
    changedPaths: ["src/checkout/pay.ts"],
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

/** `plan` needs only the journal lookup from the daemon; nothing was committed under this requestId. */
const NO_PRIOR_APPLIES = {
  listProjectionPriorCommittedApplies: async () => okEnvelope("projection.prior-committed-applies", { applies: [] })
} as unknown as ProjectionServiceHost;

function depsCode(read: () => unknown): { code: string; reasonCode?: string } {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(CapabilityDependenciesError);
    return { code: (error as CapabilityDependenciesError).code, ...((error as CapabilityDependenciesError).reasonCode ? { reasonCode: (error as CapabilityDependenciesError).reasonCode } : {}) };
  }
  throw new Error("deps answered without code facts");
}

/** Checkout imports billing; the model declares the two capabilities and no relation between them. */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "archctx-undeclared-deps-"));
  const files: Record<string, string> = {
    "src/billing/invoice.ts": "export const invoice = 1;\n",
    "src/checkout/pay.ts": 'import { invoice } from "../billing/invoice";\nexport const pay = invoice;\n'
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body, "utf8");
  }
  initializeArchContextModel(root, "Undeclared Deps App");
  const nodes = join(root, ".archcontext/model/nodes");
  rmSync(join(nodes, "capability.architecture.context.yaml"), { force: true });
  writeFileSync(join(nodes, "capability.shop.billing.yaml"), capability("capability.shop.billing", "src/billing"), "utf8");
  writeFileSync(join(nodes, "capability.shop.checkout.yaml"), capability("capability.shop.checkout", "src/checkout"), "utf8");
  writeFileSync(join(root, ".gitignore"), ".codegraph/\n", "utf8");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  codegraph("init", root);
}, TIMEOUT_MS);

afterAll(() => {
  if (PREVIOUS_STATE_DIR === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
  else process.env.ARCHCONTEXT_STATE_DIR = PREVIOUS_STATE_DIR;
  for (const path of [root, STATE_ROOT]) if (path) rmSync(path, { recursive: true, force: true });
});

describe("undeclared cross-capability dependencies (#326)", () => {
  test("check and plan report an import no relation declares, and deps marks it undeclared", async () => {
    const check = projectionResult(runProjectionCheckCommand(request("check"), root));
    const undeclared: ProjectionArchitectureDebtV1 = {
      coverage: "complete",
      coverageReasonCodes: [],
      items: [{ reasonCode: "undeclared-dependency", fromCapabilityId: "capability.shop.checkout", toCapabilityId: "capability.shop.billing", importEdgeCount: 1 }]
    };
    expect(check.architectureDebt).toEqual(undeclared);
    const plan = projectionResult(await runProjectionProtocolCommand({ action: "run", request: request("plan") } as never, root, NO_PRIOR_APPLIES));
    expect(plan.architectureDebt).toEqual(undeclared);
    // Debt does not block: the same run without it would carry the same status and files.
    expect(["planned", "noop", "adoption-required", "human-action-required"]).toContain(check.status);
    expect(check.humanActions.map((action) => action.reasonCode)).not.toContain("undeclared-dependency" as never);

    const deps = readCapabilityDependencies(root);
    expect(publishedSchemaIssues("runtime/capability-dependencies.schema.json", JSON.parse(JSON.stringify(deps)))).toEqual([]);
    expect(deps.matrix.find((cell) => cell.from === "capability.shop.checkout" && cell.to === "capability.shop.billing"))
      .toEqual({ from: "capability.shop.checkout", to: "capability.shop.billing", imports: 1, calls: null, declared: false, relationIds: [] });
  }, TIMEOUT_MS);

  test("a relation from checkout to billing removes the debt and declares the cell", async () => {
    mkdirSync(join(root, ".archcontext/model/relations"), { recursive: true });
    writeFileSync(join(root, RELATION), stableYaml({
      schemaVersion: "archcontext.relation/v1",
      id: "relation.checkout.calls-billing",
      kind: "calls",
      source: "capability.shop.checkout",
      target: "capability.shop.billing",
      intent: "Checkout reads invoices from billing."
    }), "utf8");
    git("add", "-A");
    git("commit", "-q", "-m", "declare checkout -> billing");
    const check = projectionResult(runProjectionCheckCommand(request("check"), root));
    expect(check.architectureDebt).toEqual({ coverage: "complete", coverageReasonCodes: [], items: [] });
    const plan = projectionResult(await runProjectionProtocolCommand({ action: "run", request: request("plan") } as never, root, NO_PRIOR_APPLIES));
    expect(plan.architectureDebt).toEqual({ coverage: "complete", coverageReasonCodes: [], items: [] });
    expect(readCapabilityDependencies(root).matrix.find((cell) => cell.from === "capability.shop.checkout" && cell.to === "capability.shop.billing"))
      .toMatchObject({ declared: true, relationIds: ["relation.checkout.calls-billing"] });
  }, TIMEOUT_MS);

  test("a stale or missing index is AC_CODE_FACTS_UNAVAILABLE for deps and unknown debt coverage for an optional-facts check", () => {
    // An edit the index has not seen: the index reports pending changes.
    appendFileSync(join(root, "src/checkout/pay.ts"), "export const later = pay;\n", "utf8");
    expect(depsCode(() => readCapabilityDependencies(root))).toEqual({ code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "code-facts-unavailable" });
    git("commit", "-q", "-am", "edit without sync");
    rmSync(join(root, ".codegraph"), { recursive: true, force: true });
    expect(depsCode(() => readCapabilityDependencies(root))).toEqual({ code: "AC_CODE_FACTS_UNAVAILABLE", reasonCode: "code-facts-unavailable" });

    // With code facts optional the run continues, and its debt says it observed nothing.
    declareOptionalCodeFacts(root);
    git("commit", "-q", "-am", "optional code facts");
    const check = projectionResult(runProjectionCheckCommand(request("check"), root));
    expect(check.architectureDebt).toEqual({ coverage: "unknown", coverageReasonCodes: ["code-facts-unavailable"], items: [] });
    expect(readFileSync(join(root, ".archcontext/manifest.yaml"), "utf8")).toContain("required: false");
  }, TIMEOUT_MS);
});

describe("architecture debt workspace map (#326)", () => {
  const evidence = (workspaceRoot: string) => ({
    root: workspaceRoot,
    sourceFiles: [],
    population: undefined,
    codeGraphStatus: "ready" as const,
    worktreeDigest: `sha256:${"0".repeat(64)}`
  });

  test("an unsupported workspace glob is a reported coverage gap; a malformed manifest propagates", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "archctx-undeclared-deps-workspaces-"));
    try {
      writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ workspaces: ["packages/**"] }), "utf8");
      expect(projectionArchitectureDebt({ nodes: [], relations: [] }, evidence(workspaceRoot)))
        .toEqual({ coverage: "partial", coverageReasonCodes: ["workspace-resolution-failed"], items: [] });
      writeFileSync(join(workspaceRoot, "package.json"), "{ not json", "utf8");
      expect(() => projectionArchitectureDebt({ nodes: [], relations: [] }, evidence(workspaceRoot))).toThrow(SyntaxError);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
