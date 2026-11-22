import {
  Const,
  RawEnum,
  Ref,
  SchemaDocument,
  SemverSchema,
  StrictObject,
  Type,
  type Static
} from "./schema-kit";

export const ARCHCONTEXT_PRODUCT_NAME = "archctx" as const;
export const ARCHCONTEXT_PRODUCT_VERSION = "0.18.0" as const;
export const ARCHCONTEXT_PACKAGE_MANAGER = "bun@1.4.4" as const;
export const ARCHCONTEXT_NODE_RANGE = ">=22.22 <26" as const;
export const LOCAL_RUNTIME_RPC_SCHEMA_VERSION = "archcontext.runtime-rpc/v2" as const;
export const ARCHCONTEXT_SCHEMA_SET_VERSION = "2026-07-11.explorer-view-v2" as const;

const SurfaceBodySchema = StrictObject({
  packageName: Type.String({ minLength: 1 }),
  version: Ref<string>("#/$defs/semver"),
  entrypoint: Type.String({ minLength: 1 })
});

export type ProductSurfaceVersion = Static<typeof SurfaceBodySchema>;

export const ProductVersionManifestBodySchema = StrictObject({
  schemaVersion: Const("archcontext.product-version-manifest/v1"),
  product: StrictObject({
    name: Const(ARCHCONTEXT_PRODUCT_NAME),
    version: Ref<string>("#/$defs/semver"),
    distribution: RawEnum(["one-package"] as const)
  }),
  packageManager: Type.String({ minLength: 1 }),
  engines: StrictObject({
    node: Const(ARCHCONTEXT_NODE_RANGE)
  }),
  surfaces: StrictObject({
    cli: Ref<ProductSurfaceVersion>("#/$defs/surface"),
    daemon: StrictObject({
      packageName: Type.String({ minLength: 1 }),
      version: Ref<string>("#/$defs/semver"),
      entrypoint: Type.String({ minLength: 1 }),
      rpcSchemaVersion: Const(LOCAL_RUNTIME_RPC_SCHEMA_VERSION)
    })
  }),
  schemas: StrictObject({
    schemaSetVersion: Type.String({ minLength: 1 }),
    contractsPackageVersion: Ref<string>("#/$defs/semver")
  }),
  runtime: StrictObject({
    localRpc: StrictObject({
      schemaVersion: Const(LOCAL_RUNTIME_RPC_SCHEMA_VERSION),
      protocol: RawEnum(["http-loopback"] as const)
    }),
    sqliteMigrations: Type.String({ minLength: 1 }),
    codeGraph: StrictObject({
      packageName: Const("@colbymchenry/codegraph"),
      requiredVersion: Type.String({ minLength: 1 }),
      adapter: RawEnum(["codegraph-cli"] as const)
    })
  })
});

export const ProductVersionManifestSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/product-version-manifest.schema.json",
  title: "ProductVersionManifest",
  schema: ProductVersionManifestBodySchema,
  $defs: {
    semver: SemverSchema,
    surface: SurfaceBodySchema
  }
});

export type ProductVersionManifest = Static<typeof ProductVersionManifestSchema>;

export function productVersionManifest(): ProductVersionManifest {
  return {
    schemaVersion: "archcontext.product-version-manifest/v1",
    product: {
      name: ARCHCONTEXT_PRODUCT_NAME,
      version: ARCHCONTEXT_PRODUCT_VERSION,
      distribution: "one-package"
    },
    packageManager: ARCHCONTEXT_PACKAGE_MANAGER,
    engines: {
      node: ARCHCONTEXT_NODE_RANGE
    },
    surfaces: {
      cli: {
        packageName: "@archcontext/surfaces",
        version: ARCHCONTEXT_PRODUCT_VERSION,
        entrypoint: "archctx"
      },
      daemon: {
        packageName: "@archcontext/local-runtime",
        version: ARCHCONTEXT_PRODUCT_VERSION,
        entrypoint: "archctx daemon start",
        rpcSchemaVersion: LOCAL_RUNTIME_RPC_SCHEMA_VERSION
      }
    },
    schemas: {
      schemaSetVersion: ARCHCONTEXT_SCHEMA_SET_VERSION,
      contractsPackageVersion: ARCHCONTEXT_PRODUCT_VERSION
    },
    runtime: {
      localRpc: {
        schemaVersion: LOCAL_RUNTIME_RPC_SCHEMA_VERSION,
        protocol: "http-loopback"
      },
      sqliteMigrations: "0001_runtime_state..0012_explorer_projection_index",
      codeGraph: {
        packageName: "@colbymchenry/codegraph",
        requiredVersion: "1.6.4",
        adapter: "codegraph-cli"
      }
    }
  };
}

/**
 * Whether a Node.js version (`process.versions.node`) satisfies `range`, a space-separated list of
 * `>=`, `>`, `<=`, `<` or `=` comparators over `major[.minor[.patch]]` (missing parts are 0), the
 * only form `ARCHCONTEXT_NODE_RANGE` uses. A version that does not start with `major.minor.patch`
 * does not satisfy any range; a prerelease suffix is ignored, so `26.0.0-pre` counts as `26.0.0`
 * and fails `<26`. A comparator outside that form throws: the range is product metadata, not input.
 */
export function nodeVersionSatisfiesRange(nodeVersion: string, range: string = ARCHCONTEXT_NODE_RANGE): boolean {
  const comparators = range.trim().split(/\s+/).map((token) => {
    const match = /^(>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(token);
    if (!match) throw new Error(`unsupported node engine comparator: ${token}`);
    return { operator: match[1] ?? "=", version: [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)] };
  });
  const parsed = /^v?(\d+)\.(\d+)\.(\d+)/.exec(nodeVersion);
  if (!parsed) return false;
  const version = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  return comparators.every(({ operator, version: bound }) => {
    const order = compareVersionTriples(version, bound);
    if (operator === ">=") return order >= 0;
    if (operator === ">") return order > 0;
    if (operator === "<=") return order <= 0;
    if (operator === "<") return order < 0;
    return order === 0;
  });
}

function compareVersionTriples(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}
