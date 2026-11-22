import { buildCapabilitiesSchemaDocument } from "./cli-read";
import {
  AGENT_CONTEXT_RENDERER_VERSION,
  ARCHCTX_CAPABILITIES_SCHEMA_VERSION,
  ARCHCTX_FEATURES,
  ARCHITECTURE_DOCS_RENDERER_VERSION,
  ARCHITECTURE_FLOW_SELECTOR_CHECK_SCHEMA_VERSION,
  ARCHITECTURE_FLOW_SELECTOR_PROOF_STATUSES,
  ARCHITECTURE_PROOF_P2_STATUSES,
  ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION,
  PROJECTION_REQUEST_SCHEMA_VERSION,
  PROJECTION_RESULT_SCHEMA_VERSION,
  PROJECTION_SLICE_SCHEMA_VERSION,
  type ArchitectureFlowSelectorSiteV1
} from "./projection-constants";
import type { ProjectionSliceCapabilityV1, ProjectionSliceEntrypointV1 } from "./projection-types";
import type { ArchctxCapabilitiesV1 } from "./projection-apply-types";
import {
  Const,
  CountSchema,
  GitOidSchema,
  NonEmptyStringSchema,
  NullableType,
  PositiveIntSchema,
  RawEnum,
  Ref,
  SchemaDocument,
  StrictObject,
  Type
} from "./schema-kit";

export function archctxCapabilities(packageVersion: string): ArchctxCapabilitiesV1 {
  return {
    schemaVersion: ARCHCTX_CAPABILITIES_SCHEMA_VERSION,
    package: { name: "archctx", version: packageVersion },
    protocols: {
      projectionRequest: PROJECTION_REQUEST_SCHEMA_VERSION,
      projectionResult: PROJECTION_RESULT_SCHEMA_VERSION,
      architectureRefreshSignal: ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION
    },
    renderers: {
      architectureDocs: ARCHITECTURE_DOCS_RENDERER_VERSION,
      agentContext: AGENT_CONTEXT_RENDERER_VERSION
    },
    features: [...ARCHCTX_FEATURES]
  };
}

export const ArchctxCapabilitiesSchema = buildCapabilitiesSchemaDocument({
  projectionRequest: PROJECTION_REQUEST_SCHEMA_VERSION,
  projectionResult: PROJECTION_RESULT_SCHEMA_VERSION,
  architectureRefreshSignal: ARCHITECTURE_REFRESH_SIGNAL_SCHEMA_VERSION,
  architectureDocsRenderer: ARCHITECTURE_DOCS_RENDERER_VERSION,
  agentContextRenderer: AGENT_CONTEXT_RENDERER_VERSION,
  featureExamples: ARCHCTX_FEATURES
});

const FlowSelectorSitesDefSchema = Type.Array(
  StrictObject({
    path: NonEmptyStringSchema,
    line: Type.Optional(PositiveIntSchema)
  })
);

export const ArchitectureFlowSelectorCheckSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/flow-selector-check.schema.json",
  title: "ArchitectureFlowSelectorCheckV1",
  description:
    "The data of `archctx flows check`: the P2 flow proof of every capability that declares a flow, and the proof status of every declared entrypoint-to-sink selector, computed without rendering. Consumers detect it through the flow-selector-check-v1 capability.",
  schema: StrictObject({
    schemaVersion: Const(ARCHITECTURE_FLOW_SELECTOR_CHECK_SCHEMA_VERSION),
    ok: Type.Boolean({
      description: "True when no capability that declares a flow has an unprovable P2 proof."
    }),
    codeGraph: StrictObject({
      availability: RawEnum(["ready", "unavailable"] as const),
      version: NonEmptyStringSchema
    }),
    summary: StrictObject({
      selectors: CountSchema,
      proven: CountSchema,
      unproven: CountSchema,
      usedUnproven: Type.Integer({
        minimum: 0,
        description: "Unproven selectors that a required-flow step names."
      })
    }),
    selectors: Type.Array(
      StrictObject({
        nodeId: NonEmptyStringSchema,
        entrypointId: NonEmptyStringSchema,
        sourcePath: NonEmptyStringSchema,
        sourceSymbol: NonEmptyStringSchema,
        sinkId: NonEmptyStringSchema,
        sinkPath: NonEmptyStringSchema,
        sinkSymbol: NonEmptyStringSchema,
        status: RawEnum(ARCHITECTURE_FLOW_SELECTOR_PROOF_STATUSES, {
          description: "Only proven binds a flow step."
        }),
        callSites: Ref<ArchitectureFlowSelectorSiteV1[]>("#/$defs/sites"),
        referenceSites: Ref<ArchitectureFlowSelectorSiteV1[]>("#/$defs/sites"),
        rejectedBuiltinCallSites: Ref<ArchitectureFlowSelectorSiteV1[]>("#/$defs/sites"),
        flowSteps: Type.Array(
          StrictObject({
            flowId: NonEmptyStringSchema,
            stepId: NonEmptyStringSchema
          })
        )
      })
    ),
    capabilities: Type.Array(
      StrictObject({
        capabilityId: NonEmptyStringSchema,
        p2Status: RawEnum(ARCHITECTURE_PROOF_P2_STATUSES),
        diagnostics: Type.Array(
          StrictObject({
            code: NonEmptyStringSchema,
            flowId: Type.Optional(NonEmptyStringSchema),
            stepId: Type.Optional(NonEmptyStringSchema),
            detail: Type.String()
          })
        )
      })
    )
  }),
  $defs: {
    sites: FlowSelectorSitesDefSchema
  }
});

const ProjectionSliceEntrypointDefSchema = StrictObject({
  nodeId: Ref<string>("#/$defs/nonEmpty"),
  entrypointId: Ref<string>("#/$defs/nonEmpty"),
  path: Ref<string>("#/$defs/nonEmpty"),
  symbol: Ref<string>("#/$defs/nonEmpty")
});

const ProjectionSliceCapabilityDefSchema = StrictObject({
  capabilityId: Ref<string>("#/$defs/nonEmpty"),
  modulePath: Ref<string>("#/$defs/nonEmpty"),
  diagramMermaid: NullableType("string", {
    minLength: 1,
    description: "Unfenced Mermaid or null when the capability was removed or its P1 diagram is unprovable."
  }),
  entrypoints: Type.Array(Ref<ProjectionSliceEntrypointV1>("#/$defs/entrypoint")),
  markdown: Ref<string>("#/$defs/nonEmpty")
});

export const ProjectionSliceSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/projection-slice.schema.json",
  title: "ProjectionSliceV1",
  description:
    "Read-only pull request projection of capability diagrams and entrypoint anchors from the same merge base and HEAD used to select changed paths.",
  schema: StrictObject(
    {
      schemaVersion: Const(PROJECTION_SLICE_SCHEMA_VERSION),
      base: Ref<string>("#/$defs/nonEmpty"),
      baseSha: Ref<string>("#/$defs/sha"),
      mergeBase: Ref<string>("#/$defs/sha"),
      headSha: Ref<string>("#/$defs/sha"),
      changedPaths: Type.Array(Ref<string>("#/$defs/nonEmpty"), {
        uniqueItems: true,
        description: "Sorted union of paths changed between the merge base and HEAD and explicit changed path overrides."
      }),
      changed: Type.Boolean(),
      affectedCapabilities: Type.Array(Ref<ProjectionSliceCapabilityV1>("#/$defs/capability")),
      markdown: Ref<string>("#/$defs/nonEmpty")
    },
    {
      if: { properties: { changed: { const: true } } },
      then: { properties: { affectedCapabilities: { minItems: 1 } } },
      else: { properties: { affectedCapabilities: { maxItems: 0 } } }
    }
  ),
  $defs: {
    sha: GitOidSchema,
    nonEmpty: NonEmptyStringSchema,
    capability: ProjectionSliceCapabilityDefSchema,
    entrypoint: ProjectionSliceEntrypointDefSchema
  }
});
