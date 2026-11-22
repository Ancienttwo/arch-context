import {
  FailureError, NativeContextError, RUNTIME_VERIFY_SCHEMA_VERSION, okEnvelope,
  type Json, type JsonEnvelope, type ModelValidationResult, type RuntimeVerifyCheck, type RuntimeVerifyV1
} from "@archcontext/contracts";
import { loadNativeModelFromModelFiles } from "@archcontext/core/projection-engine";
import { loadStateMachinesFromArchContext } from "@archcontext/core/state-machine-engine";
import { findRepositoryRoot, isGitRevisionArgument, listGitVisibleFiles, readHeadSha, resolveNativeGitSnapshot } from "@archcontext/local-runtime/git-adapter";
import { listModelFiles, validateModelFiles } from "@archcontext/local-runtime/model-store-yaml";
import { prepareArchitectureDocumentationProjectionSnapshot, repositoryImportPairs, type CodeGraphSymbolReaderResult } from "@archcontext/local-runtime/codegraph-adapter";
import { codeFactsReadFailure } from "../../codegraph-adapter/src/ready-index-read";
import { assertCodeFactsCompatibility, codeGraphIndexAvailable, movingCodeFacts, openSessionCodeFacts } from "../../codegraph-adapter/src/repository-code-facts";
import { REQUIRED_CODEGRAPH_VERSION, type CodeGraphReadProvider, type CodeGraphReadSession, type CodeGraphReadSessionOpenV1 } from "../../codegraph-adapter/src/read-session";
import { codeGraphSymbolReader } from "../../codegraph-adapter/src/selector-index";
import { withWorkspaceReadOnlyCodeGraph } from "../../codegraph-adapter/src/workspace-read-only";
import { runArchitectureDebtCommand } from "./architecture-debt";
import { runConstraintCheckCommand } from "./constraints-check";
import { runDocsAnchorsCommand } from "./docs-anchors";
import { runFlowSelectorCheckCommand } from "./flow-selector-check";
import { selectedProducerFailureEnvelope } from "./producer-failure";
import { runProjectionCheckCommand } from "./projection-check";
import { runProjectionSnapshotCommand } from "./projection-service";
import { runProjectionVerifyPrCommand } from "./projection-writer";
import { publicFailureEnvelope } from "./public-operation-failure";
import { runStateMachineCheckCommand } from "./state-machine-check";

export function modelValidationEnvelope(result: ModelValidationResult): JsonEnvelope {
  if (result.allowedTargetErrors?.length) {
    return publicFailureEnvelope("validate", "AC_SCHEMA_INVALID", "constraint-model-invalid", { issueCount: result.allowedTargetErrors.length });
  }
  // SAFETY: ModelValidationResult contains only JSON fields.
  return okEnvelope("validate", result as unknown as Json);
}

/** Read the PR worktree in-process. Each producer owns its report and failure semantics. */
export function runRuntimeVerifyCommand(cwd: string, base: string, provider?: CodeGraphReadProvider): JsonEnvelope {
  let root: string;
  try { root = findRepositoryRoot(cwd); }
  catch { return publicFailureEnvelope("verify", "AC_REPO_NOT_FOUND", "git-worktree-required"); }
  if (!isGitRevisionArgument(base)) return publicFailureEnvelope("verify", "AC_SCHEMA_INVALID", "cli-input-invalid");
  try {
    const { commitSha: baseSha } = resolveNativeGitSnapshot(root, base);
    const { commitSha: headSha } = resolveNativeGitSnapshot(root, "HEAD");
    const revisions = { baseSha, headSha };
    const modelFiles = once(() => listModelFiles(root));
    const model = once(() => loadNativeModelFromModelFiles(new Map(modelFiles().map(file => [file.path, file.body]))));
    const machines = once(() => loadStateMachinesFromArchContext(root, model().nodes));
    const files = once(() => listGitVisibleFiles(root));
    // Verify measures the checkout's YAML even when standalone validate serves ledger authority.
    const validate = check<ModelValidationResult>("validate", "cli", () => modelValidationEnvelope(validateModelFiles(modelFiles())));

    const checks = withWorkspaceReadOnlyCodeGraph(root, (opened) => {
      const inputs = { modelFiles, model, machines, files };
      const codeFacts = verifyCodeFacts(opened, codeGraphIndexAvailable(root));
      const found = readChecks(root, base, revisions, inputs, codeFacts);
      // Recheck certification on the same handle. If the index moved, keep local checks and discard
      // facts from that snapshot. A source edit during the read must likewise invalidate fresh proof.
      if (codeFacts.unchanged()) return found;
      return readChecks(root, base, revisions, inputs, verifyCodeFacts({ state: "build-in-progress" }, true));
    }, provider);
    if (readHeadSha(root) !== headSha) throw new NativeContextError("native-context-input-changed", { category: "head-or-tree" });
    const result: RuntimeVerifyV1 = { schemaVersion: RUNTIME_VERIFY_SCHEMA_VERSION, base, ...revisions, checks: { validate, ...checks } };
    // SAFETY: The existing producer reports and failure envelopes contain only JSON fields.
    return okEnvelope("verify", result as unknown as Json);
  } catch (error) {
    return selectedProducerFailureEnvelope("verify", error, "cli");
  }
}

interface VerifyModelInputs {
  modelFiles(): ReturnType<typeof listModelFiles>;
  model(): ReturnType<typeof loadNativeModelFromModelFiles>;
  machines(): ReturnType<typeof loadStateMachinesFromArchContext>;
  files(): string[];
}

function readChecks(root: string, base: string, revisions: { baseSha: string; headSha: string }, inputs: VerifyModelInputs, codeFacts: ReturnType<typeof verifyCodeFacts>): Omit<RuntimeVerifyV1["checks"], "validate"> {
  const { model, machines, files } = inputs;
  const { symbols, readySession, assertCodeFactsCompatible, readImports } = codeFacts;
  const docs = () => runDocsAnchorsCommand(root, {}, { model: model(), files: files(), symbols });
  // Debt uses the same docs evaluation, including its producer failure if it refused.
  const readDocs = once(() => capture("docs.anchors", "docs-anchors", docs));
  return {
    flows: check("flows.check", "flows-check", () => runFlowSelectorCheckCommand(root, {}, { model: model(), files: files(), readySession })),
    "state-machines": check("state-machines.check", "state-machines-check", () => runStateMachineCheckCommand(root, { machines: machines(), files: new Set(files()), symbols })),
    constraints: check("constraints.check", "cli", () => runConstraintCheckCommand(root, { modelFiles: inputs.modelFiles(), model, files, readImports })),
    docs: check("docs.anchors", "docs-anchors", readDocs),
    projection: check("projection.verify-pr", "public-operation", () => runProjectionVerifyPrCommand({
      cwd: root, base, revisions,
      snapshot: () => runProjectionSnapshotCommand(root, { model, files }),
      check: (request) => runProjectionCheckCommand(request, root, {
        model, machines,
        prepareCodeGraph: () => prepareArchitectureDocumentationProjectionSnapshot(root, model(), { sourceFiles: files(), existingSession: readySession() })
      })
    })),
    debt: check("debt", "debt", () => runArchitectureDebtCommand(root, {}, {}, { model, machines, files, symbols, docs: readDocs, assertCodeFactsCompatible }))
  };
}

function verifyCodeFacts(opened: CodeGraphReadSessionOpenV1, hasIndexDirectory: boolean) {
  const session = opened.state === "open" ? opened.session : undefined;
  const symbols: CodeGraphSymbolReaderResult = session
    ? codeGraphSymbolReader(session.graph)
    : { availability: "unavailable", reasonCode: opened.state === "index-missing" ? "index-missing" : "index-open-failed" };
  const unavailable = (reason: "index-missing" | "index-open-failed") => new FailureError("AC_CODE_FACTS_UNAVAILABLE", reason);
  const notReady = () => movingCodeFacts(REQUIRED_CODEGRAPH_VERSION);
  const freshness = once(() => session && openSessionCodeFacts(session, "freshness"));
  return {
    symbols,
    readySession(): CodeGraphReadSession {
      if (opened.state === "build-in-progress") throw codeFactsReadFailure(notReady());
      if (opened.state !== "open") throw unavailable(opened.state);
      const readiness = freshness()!;
      if (readiness.facts.state !== "ready") throw codeFactsReadFailure(readiness);
      return opened.session;
    },
    assertCodeFactsCompatible() {
      if (opened.state === "open") assertCodeFactsCompatibility(openSessionCodeFacts(opened.session, "compatibility"));
      else if (opened.state === "build-in-progress") assertCodeFactsCompatibility(notReady());
      else if (hasIndexDirectory) throw unavailable(opened.state);
    },
    readImports: ((root, limit, digest, files) => {
      if (!session) throw unavailable("index-open-failed");
      return repositoryImportPairs(root, limit, digest, files, { session });
    }) satisfies typeof repositoryImportPairs,
    unchanged() {
      if (!session) return true;
      try {
        if (freshness()?.facts.state === "ready") {
          const pending = session.freshness(true);
          if (pending.added || pending.modified || pending.removed) return false;
        }
        return session.unchangedSinceOpen();
      } catch { return false; }
    }
  };
}

type CheckStage = Parameters<typeof selectedProducerFailureEnvelope>[2];
function capture(requestId: string, stage: CheckStage, read: () => JsonEnvelope): JsonEnvelope {
  try { return read(); }
  catch (error) { return selectedProducerFailureEnvelope(requestId, error, stage); }
}

function check<T>(requestId: string, stage: CheckStage, read: () => JsonEnvelope): RuntimeVerifyCheck<T> {
  const result = capture(requestId, stage, read);
  // SAFETY: Each check calls its typed producer and keeps the payload or failure exactly as emitted.
  return result.ok ? { ok: true, data: result.data as T } : { ok: false, error: result.error! };
}

/** Share the success or the producer refusal for the duration of this call only. */
function once<T>(read: () => T): () => T {
  let result: { value: T } | { error: unknown } | undefined;
  return () => {
    if (result === undefined) {
      try { result = { value: read() }; }
      catch (error) { result = { error }; }
    }
    if ("error" in result) throw result.error;
    return result.value;
  };
}
