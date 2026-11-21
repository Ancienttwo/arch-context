import {
  CodeFactsStateSchema,
  Const,
  JsonObjectSchema,
  NullableType,
  SchemaDocument,
  StrictObject,
  StrictSemverSchema,
  Type,
  UniqueStringArray,
  type Static
} from "./schema-kit";

export const CLI_HELP_SCHEMA_VERSION = "archcontext.cli-help/v1" as const;
export const RESOLVE_PATH_SCHEMA_VERSION = "archcontext.resolve-path/v1" as const;
export const RESOLVE_PATHS_BATCH_SCHEMA_VERSION = "archcontext.resolve-paths-batch/v1" as const;

/**
 * #640: Reported by `archctx doctor --json` and `archctx capabilities --json` so `repo-harness`
 * can verify CodeGraph readiness without parsing unstructured stderr.
 */
export const DoctorCodeFactsIssueSchema = StrictObject({
  code: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 })
});

export const DoctorCodeFactsBodySchema = StrictObject({
  state: CodeFactsStateSchema,
  codeGraphVersion: Type.String({ minLength: 1 }),
  issues: Type.Array(DoctorCodeFactsIssueSchema)
});

export const DoctorCodeFactsSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/doctor-code-facts.schema.json",
  title: "DoctorCodeFactsV1",
  description: "Machine-readable CodeGraph readiness report returned in `archctx doctor --json` and capability diagnostics.",
  schema: DoctorCodeFactsBodySchema
});
export type DoctorCodeFactsV1 = Static<typeof DoctorCodeFactsSchema>;

/** #640: `archctx help --json` command surface for downstream command-disposition checks. */
export const CliHelpOutputBodySchema = StrictObject({
  commands: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
  examples: Type.Optional(Type.Array(Type.String({ minLength: 1 })))
});

export const CliHelpOutputSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/cli-help.schema.json",
  title: "CliHelpOutputV1",
  description: "Structured `archctx help --json` payload listing supported commands and usage examples.",
  schema: CliHelpOutputBodySchema
});
export type CliHelpOutputV1 = Static<typeof CliHelpOutputSchema>;

/** #640: `archctx resolve --path` & `archctx resolve --paths-from` per-path ownership result. */
export const ResolvePathResultSchema = StrictObject({
  path: Type.String({ minLength: 1 }),
  matched: Type.Boolean(),
  ambiguous: Type.Boolean(),
  owningCapabilityId: NullableType("string", { minLength: 1 }),
  stableId: Type.Optional(Type.String({ minLength: 1 })),
  kind: Type.Optional(Type.String({ minLength: 1 })),
  name: Type.Optional(Type.String()),
  source: Type.Optional(JsonObjectSchema),
  extensions: Type.Optional(JsonObjectSchema),
  candidates: Type.Optional(Type.Array(Type.String({ minLength: 1 })))
});
export type ResolvePathResultV1 = Static<typeof ResolvePathResultSchema>;

export const ResolvePathsBatchResultBodySchema = StrictObject({
  results: Type.Array(ResolvePathResultSchema)
});

export const ResolvePathsBatchResultSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/resolve-path.schema.json",
  title: "ResolvePathsBatchResultV1",
  description: "Batch ownership resolution output for `archctx resolve --paths-from`.",
  schema: ResolvePathsBatchResultBodySchema
});
export type ResolvePathsBatchResultV1 = Static<typeof ResolvePathsBatchResultSchema>;

/** #642: Non-intrusive host-ownership isolation controls for `archctx init` and `archctx sync`. */
export const HostOwnershipIsolationOptionsSchema = StrictObject({
  modelOnly: Type.Optional(Type.Boolean()),
  noHooks: Type.Optional(Type.Boolean()),
  noSkills: Type.Optional(Type.Boolean()),
  noInstructions: Type.Optional(Type.Boolean())
});
export type HostOwnershipIsolationOptions = Static<typeof HostOwnershipIsolationOptionsSchema>;

export const ARCHCTX_CAPABILITIES_V2_SCHEMA_VERSION = "archcontext.capabilities/v1" as const;

export function buildCapabilitiesSchemaDocument(input: {
  projectionRequest: string;
  projectionResult: string;
  architectureRefreshSignal: string;
  architectureDocsRenderer: string;
  agentContextRenderer: string;
  featureExamples: readonly string[];
}) {
  return SchemaDocument({
    $id: "https://archcontext.dev/schemas/runtime/archctx-capabilities.schema.json",
    title: "ArchctxCapabilitiesV1",
    schema: StrictObject({
      schemaVersion: Const(ARCHCTX_CAPABILITIES_V2_SCHEMA_VERSION),
      package: StrictObject({
        name: Const("archctx"),
        version: StrictSemverSchema
      }),
      protocols: StrictObject({
        projectionRequest: Const(input.projectionRequest),
        projectionResult: Const(input.projectionResult),
        architectureRefreshSignal: Const(input.architectureRefreshSignal)
      }),
      renderers: StrictObject({
        architectureDocs: Const(input.architectureDocsRenderer),
        agentContext: Const(input.agentContextRenderer)
      }),
      features: UniqueStringArray(
        Type.String({
          pattern: "^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]+$",
          description:
            "One feature flag: a lowercase kebab-case name that ends in a version suffix (-v1, -v2, ...). The pattern is open, so a validator built from this schema accepts flags that a later archctx adds. A consumer must ignore a flag it does not know. examples lists the flags this schema version knows.",
          examples: [...input.featureExamples]
        }),
        { minItems: 3 }
      ),
      codeFacts: Type.Optional(DoctorCodeFactsBodySchema)
    })
  });
}

export const STRICT_SEMVER_PATTERN_CHECK = StrictSemverSchema;
