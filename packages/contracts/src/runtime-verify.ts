import type { ArchitectureDebtReportV1 } from "./architecture-debt";
import type { DependencyConstraintEvaluationV1 } from "./architecture";
import type { DocsAnchorsReportV1 } from "./docs-anchors";
import type { ModelValidationResult } from "./ports";
import type { ArchitectureFlowSelectorCheckV1 } from "./projection";
import type { ProjectionPrVerificationV1 } from "./projection-writer";
import type { ArchContextError } from "./schema";
import type { StateMachineCheckReportV1 } from "./state-machine";

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
