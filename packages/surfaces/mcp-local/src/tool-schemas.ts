import type { validateJsonSchema } from "@archcontext/contracts";

type Schema = Parameters<typeof validateJsonSchema>[0];
const text: Schema = { type: "string", minLength: 1 };
const flag: Schema = { type: "boolean" };
const texts: Schema = { type: "array", items: text };
const budget = { maxBytes: { type: "integer", minimum: 1 }, maxItems: { type: "integer", minimum: 1 } } satisfies Record<string, Schema>;
const operation: Schema = {
  type: "object", required: ["op", "expectedHash"], additionalProperties: false,
  properties: {
    op: { enum: ["create_entity", "update_entity_fields", "delete_entity", "write_policy", "write_waiver", "render_projection", "render_agent_context"] },
    path: text, entityId: text, expectedHash: text, body: { type: "string" },
    projectionFiles: { type: "array", items: { type: "object", required: ["path", "expectedHash", "body"], additionalProperties: false, properties: { path: text, expectedHash: text, body: { type: "string" } } } }
  }
};

function argumentsSchema(properties: Record<string, Schema>, required: string[] = []) {
  return { type: "object" as const, properties: { root: text, ...properties }, required: ["root", ...required], additionalProperties: false };
}

export const MCP_TOOL_INPUT_SCHEMAS = {
  archcontext_prepare_task: argumentsSchema({ task: text, taskSessionId: text, ...budget }, ["task"]),
  archcontext_practices: argumentsSchema({ action: { enum: ["list", "show", "validate", "source-records"] }, id: text, category: text, source: text, strict: flag, maxBytes: budget.maxBytes }),
  archcontext_checkpoint: argumentsSchema({
    taskSessionId: text, task: text, event: { enum: ["manual", "post-edit", "post-write", "pre-complete"] }, changedPaths: texts,
    toolCallId: text, expectedHeadSha: text, expectedWorktreeDigest: text, ...budget
  }),
  archcontext_plan_update: argumentsSchema({
    id: text, taskSessionId: text, operations: { type: "array", items: operation },
    reason: { type: "object", required: ["taskSessionId"], additionalProperties: false, properties: { taskSessionId: text, interventionId: text } }
  }, ["id", "operations"]),
  archcontext_apply_update: argumentsSchema({ id: text, approvalToken: text, expectedWorktreeDigest: text }, ["id", "expectedWorktreeDigest", "approvalToken"]),
  archcontext_projection: argumentsSchema({ action: { enum: ["run", "readback", "recover"] }, request: { type: "object" }, approvalToken: text }, ["action", "request"]),
  archcontext_complete_task: argumentsSchema({
    taskSessionId: text, task: text, posture: text, headSha: text,
    compatibilityPathIntroduced: flag, cleanupRequired: { type: "integer", minimum: 0 }, cleanupCompleted: { type: "integer", minimum: 0 },
    compatibilityContract: { type: "object", additionalProperties: false, properties: { kind: text, reason: text, owner: text, consumers: texts, removalConditions: texts, reviewAt: text } }
  })
};
