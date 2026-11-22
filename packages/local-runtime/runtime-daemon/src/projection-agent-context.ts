import { digestJson, okEnvelope, type Json } from "@archcontext/contracts";
import { computeWorktreeDigest } from "@archcontext/core/architecture-domain";
import {
  REPO_HARNESS_PROJECTION_PROFILE,
  loadAgentContextProjectionFiles,
  loadArchitectureProjectionInstructionsEnabled,
  loadNativeModelFromArchContext,
  renderAgentContextProjection
} from "@archcontext/core/projection-engine";
import { findRepositoryRoot, listGitVisibleFiles } from "@archcontext/local-runtime/git-adapter";
import {
  committedArchitectureDocsProfile,
  projectionFailureEnvelope,
  projectionFilesBoundToRenderInput
} from "./projection-docs-helpers";
import { publicFailureEnvelope, publicOperationFailure } from "./public-operation-failure";
import type { RuntimeAgentContextProjectionInput, RuntimeDaemonClient } from "./runtime-types";

export type ProjectionServiceHost = Pick<RuntimeDaemonClient, "planUpdate" | "applyUpdate">;

/**
 * `archctx agent-context plan|preview|apply` — the ADR-0043 capability contract files.
 */
export async function runAgentContextProjectionCommand(input: RuntimeAgentContextProjectionInput, cwd: string, daemon: ProjectionServiceHost) {
  try {
    const subcommand = input.action ?? "plan";
    if (!["plan", "preview", "apply"].includes(subcommand)) {
      return publicFailureEnvelope("agent-context", "AC_SCHEMA_INVALID", "agent-context-input-invalid", {});
    }
    const channel = `agent-context.${subcommand}`;
    const root = findRepositoryRoot(cwd);
    let projection: ReturnType<typeof buildAgentContextProjection>;
    try {
      if (!loadArchitectureProjectionInstructionsEnabled(root)) return publicFailureEnvelope(channel, "AC_PRECONDITION_FAILED", "instructions-projection-disabled", {});
      if (committedArchitectureDocsProfile(root) === REPO_HARNESS_PROJECTION_PROFILE) return publicFailureEnvelope(channel, "AC_PRECONDITION_FAILED", "agent-context-owned-by-projection", {});
      projection = buildAgentContextProjection(root);
    } catch (error) {
      return projectionFailureEnvelope(channel, error);
    }
    const changeSetId = input.id
      ?? `changeset.agent-context-${projection.sourceDigest.replace(/^sha256:/, "").slice(0, 16)}`;
    const plan = await daemon.planUpdate(root, {
      id: changeSetId,
      reason: { taskSessionId: input.taskSessionId ?? "task_agent_context_projection" },
      operations: [{
        op: "render_agent_context" as const,
        expectedHash: "missing",
        projectionFiles: projectionFilesBoundToRenderInput(projection.existingFiles, projection.plan.files)
      }]
    });
    if (!plan.ok) return plan;
    if (subcommand === "apply") {
      return daemon.applyUpdate(root, {
        id: changeSetId,
        approved: input.approved === true,
        expectedWorktreeDigest: input.expectedWorktreeDigest ?? computeWorktreeDigest(root, listGitVisibleFiles(root))
      });
    }
    return okEnvelope(channel, {
      schemaVersion: "archcontext.agent-context-projection-change-set/v1",
      sourceDigest: projection.sourceDigest,
      rendererVersion: projection.plan.rendererVersion,
      targetCount: projection.plan.targets.length,
      fileCount: projection.plan.files.length,
      targets: projection.plan.targets.map((target) => ({
        targetId: target.targetId,
        nodeId: target.scope.id,
        path: target.path,
        outputDigest: target.outputDigest
      })),
      draft: (plan.data as any).draft,
      preview: (plan.data as any).preview
    } as unknown as Json);
  } catch (error) {
    throw publicOperationFailure(error);
  }
}

function buildAgentContextProjection(root: string) {
  const model = loadNativeModelFromArchContext(root);
  const sourceDigest = digestJson({ model } as unknown as Json);
  const existingFiles = loadAgentContextProjectionFiles(root, model);
  return {
    model,
    sourceDigest,
    existingFiles,
    plan: renderAgentContextProjection({ model, existingFiles })
  };
}
