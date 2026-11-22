import { DependencyConstraintEvaluationSchema } from "./architecture";
import {
  ArchitectureDebtDeltaReportSchema,
  ArchitectureDebtHookCheckpointSchema,
  ArchitectureDebtReportSchema
} from "./architecture-debt";
import { ArchitectureHistorySchema } from "./architecture-history";
import {
  CliCheckOutputSchema,
  CliHelpOutputSchema,
  DoctorCodeFactsSchema,
  PathContextOutputSchema,
  ResolvePathsBatchResultSchema,
  SyncCheckOutputSchema
} from "./cli-read";
import { DocsAnchorsReportSchema } from "./docs-anchors";
import { IndexSeedResultSchema } from "./index-seed";
import { CapabilityDependenciesSchema } from "./ownership-dependencies";
import { ProductVersionManifestSchema } from "./product-version";
import {
  ArchctxCapabilitiesSchema,
  ArchitectureFlowSelectorCheckSchema,
  ProjectionSliceSchema
} from "./projection";
import {
  RefImpactBatchRequestSchema,
  RefImpactBatchSchema,
  RefImpactSchema
} from "./ref-impact";
import {
  RefactorDecisionFileSchema,
  RefactorScanV2Schema,
  RefactorSimulateV1Schema,
  RefactorVerifyV2Schema
} from "./refactor-v2";
import { RuntimeVerifySchema } from "./runtime-verify";
import type { TSchema } from "./schema-kit";
import { StateMachineCheckReportSchema } from "./state-machine";

/**
 * Single-source TypeBox -> JSON Schema registry.
 * Every path listed here is generated directly from TypeScript TypeBox schemas and verified
 * against `schemas/` in CI so `.schema.json` files never drift from runtime contracts.
 */
export const CONTRACT_SCHEMA_REGISTRY: Readonly<Record<string, TSchema>> = {
  "schemas/repo/refactor-decision.schema.json": RefactorDecisionFileSchema,
  "schemas/runtime/archctx-capabilities.schema.json": ArchctxCapabilitiesSchema,
  "schemas/runtime/architecture-debt-delta.schema.json": ArchitectureDebtDeltaReportSchema,
  "schemas/runtime/architecture-debt.schema.json": ArchitectureDebtReportSchema,
  "schemas/runtime/architecture-history.schema.json": ArchitectureHistorySchema,
  "schemas/runtime/capability-dependencies.schema.json": CapabilityDependenciesSchema,
  "schemas/runtime/cli-check.schema.json": CliCheckOutputSchema,
  "schemas/runtime/cli-help.schema.json": CliHelpOutputSchema,
  "schemas/runtime/dependency-constraint-evaluation.schema.json": DependencyConstraintEvaluationSchema,
  "schemas/runtime/docs-anchors.schema.json": DocsAnchorsReportSchema,
  "schemas/runtime/doctor-code-facts.schema.json": DoctorCodeFactsSchema,
  "schemas/runtime/flow-selector-check.schema.json": ArchitectureFlowSelectorCheckSchema,
  "schemas/runtime/hook-debt-checkpoint.schema.json": ArchitectureDebtHookCheckpointSchema,
  "schemas/runtime/index-seed.schema.json": IndexSeedResultSchema,
  "schemas/runtime/path-context.schema.json": PathContextOutputSchema,
  "schemas/runtime/product-version-manifest.schema.json": ProductVersionManifestSchema,
  "schemas/runtime/projection-slice.schema.json": ProjectionSliceSchema,
  "schemas/runtime/ref-impact-batch-request.schema.json": RefImpactBatchRequestSchema,
  "schemas/runtime/ref-impact-batch.schema.json": RefImpactBatchSchema,
  "schemas/runtime/ref-impact.schema.json": RefImpactSchema,
  "schemas/runtime/refactor-scan-v2.schema.json": RefactorScanV2Schema,
  "schemas/runtime/refactor-simulate.schema.json": RefactorSimulateV1Schema,
  "schemas/runtime/refactor-verify-v2.schema.json": RefactorVerifyV2Schema,
  "schemas/runtime/resolve-path.schema.json": ResolvePathsBatchResultSchema,
  "schemas/runtime/runtime-verify.schema.json": RuntimeVerifySchema,
  "schemas/runtime/state-machine-check.schema.json": StateMachineCheckReportSchema,
  "schemas/runtime/sync-check.schema.json": SyncCheckOutputSchema
};
