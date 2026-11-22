import {
  Const,
  CountSchema,
  SchemaDocument,
  Sha256DigestSchema,
  StrictObject,
  StringEnum,
  Type,
  type Static
} from "./schema-kit";

/**
 * Multi-worktree CodeGraph shared-base seeding contract (#641), decoupled from `archctx sync`
 * (architecture documentation projection).
 */
export const INDEX_SEED_SCHEMA_VERSION = "archcontext.index-seed/v1" as const;

export const INDEX_SEED_MODES = ["primary-refresh", "worktree-seed", "already-present"] as const;
export type IndexSeedMode = (typeof INDEX_SEED_MODES)[number];

export const INDEX_SEED_WORKTREE_ROLES = ["primary", "linked"] as const;
export type IndexSeedWorktreeRole = (typeof INDEX_SEED_WORKTREE_ROLES)[number];

export const IndexSeedResultBodySchema = StrictObject({
  schemaVersion: Const(INDEX_SEED_SCHEMA_VERSION),
  mode: StringEnum(INDEX_SEED_MODES),
  worktreeRole: StringEnum(INDEX_SEED_WORKTREE_ROLES),
  seededFromBase: Type.Boolean(),
  hardlinkedFiles: CountSchema,
  copiedFiles: CountSchema,
  elapsedMs: Type.Number({ minimum: 0 }),
  indexDigest: Type.Optional(Sha256DigestSchema)
});

export const IndexSeedResultSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/index-seed.schema.json",
  title: "IndexSeedResultV1",
  description: "Result of `archctx index seed` (#641): refreshes or hardlink-seeds private `.codegraph` storage separately from documentation projection.",
  schema: IndexSeedResultBodySchema
});

export type IndexSeedResultV1 = Static<typeof IndexSeedResultSchema>;
