import type { ArchitectureDebtReportV1 } from "./architecture-debt";
import type { DependencyConstraintEvaluationV1 } from "./architecture";
import type { DocsAnchorsReportV1 } from "./docs-anchors";
import type { ModelValidationResult } from "./ports";
import type { ArchitectureFlowSelectorCheckV1 } from "./projection";
import type { ProjectionPrVerificationV1 } from "./projection-writer";
import type { ArchContextError } from "./schema";
import type { StateMachineCheckReportV1 } from "./state-machine";
import {
  ArchContextErrorSchema,
  Const,
  GitOidSchema,
  JsonValueSchema,
  OneOf,
  RawEnum,
  Ref,
  SchemaDocument,
  Sha256DigestSchema,
  StrictObject,
  Type
} from "./schema-kit";

export const RUNTIME_VERIFY_SCHEMA_VERSION = "archcontext.runtime-verify/v1" as const;

export type RuntimeVerifyCheck<T> = { ok: true; data: T } | { ok: false; error: ArchContextError };

export interface RuntimeVerifyV1 {
  schemaVersion: typeof RUNTIME_VERIFY_SCHEMA_VERSION;
  base: string;
  baseSha: string;
  headSha: string;
  checks: {
    validate: RuntimeVerifyCheck<ModelValidationResult>;
    flows: RuntimeVerifyCheck<ArchitectureFlowSelectorCheckV1>;
    "state-machines": RuntimeVerifyCheck<StateMachineCheckReportV1>;
    constraints: RuntimeVerifyCheck<DependencyConstraintEvaluationV1 & { warnings: string[] }>;
    docs: RuntimeVerifyCheck<DocsAnchorsReportV1>;
    projection: RuntimeVerifyCheck<ProjectionPrVerificationV1>;
    debt: RuntimeVerifyCheck<ArchitectureDebtReportV1>;
  };
}

const StringsRefSchema = Type.Array(Type.String());
const PassedEnvelopeSchema = StrictObject({
  ok: Const(true),
  data: JsonValueSchema
});
const FailedEnvelopeSchema = StrictObject({
  ok: Const(false),
  error: ArchContextErrorSchema
});
const VerifyValidationBodySchema = StrictObject({
  valid: Type.Boolean(),
  errors: Ref<string[]>("#/$defs/strings"),
  modelDigest: Sha256DigestSchema,
  referenceErrors: Type.Optional(Ref<string[]>("#/$defs/strings")),
  layerOrderErrors: Type.Optional(Ref<string[]>("#/$defs/strings")),
  allowedTargetErrors: Type.Optional(Ref<string[]>("#/$defs/strings")),
  warnings: Type.Optional(Ref<string[]>("#/$defs/strings")),
  diagnostics: Type.Optional(
    Type.Array(
      StrictObject({
        path: Type.String(),
        code: RawEnum(["missing-file", "schema-version-missing", "node-schema-invalid"] as const),
        error: Type.String()
      })
    )
  ),
  nodeSchemaErrors: Type.Optional(
    Type.Array(
      StrictObject({
        path: Type.String(),
        error: Type.String()
      })
    )
  )
});

function verifyCheckArm(dataSchema: Record<string, unknown>) {
  return OneOf([
    Ref("#/$defs/failed"),
    Type.Unsafe({
      allOf: [{ $ref: "#/$defs/passed" }, { properties: { data: dataSchema } }]
    })
  ]);
}

export const RuntimeVerifyBodySchema = StrictObject({
  schemaVersion: Const(RUNTIME_VERIFY_SCHEMA_VERSION),
  base: Type.String({ minLength: 1 }),
  baseSha: Ref<string>("#/$defs/oid"),
  headSha: Ref<string>("#/$defs/oid"),
  checks: StrictObject({
    validate: verifyCheckArm({ $ref: "#/$defs/validation" }),
    flows: verifyCheckArm({ $ref: "flow-selector-check.schema.json" }),
    "state-machines": verifyCheckArm({ $ref: "state-machine-check.schema.json" }),
    constraints: verifyCheckArm({ $ref: "dependency-constraint-evaluation.schema.json" }),
    docs: verifyCheckArm({ $ref: "docs-anchors.schema.json" }),
    projection: verifyCheckArm({ $ref: "projection-pr-verification.schema.json" }),
    debt: verifyCheckArm({ $ref: "https://archctx.repoharness.com/schemas/runtime/architecture-debt.schema.json" })
  })
});

export const RuntimeVerifySchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/runtime-verify.schema.json",
  title: "RuntimeVerifyV1",
  schema: RuntimeVerifyBodySchema,
  $defs: {
    oid: GitOidSchema,
    strings: StringsRefSchema,
    passed: PassedEnvelopeSchema,
    failed: FailedEnvelopeSchema,
    validation: VerifyValidationBodySchema
  }
});
