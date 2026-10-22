export const ARCHCONTEXT_PRODUCT_NAME = "archctx";
export const ARCHCONTEXT_PRODUCT_VERSION = "0.9.1";
export const ARCHCONTEXT_PACKAGE_MANAGER = "bun@1.4.3";
export const ARCHCONTEXT_NODE_RANGE = ">=22.22 <26";
export const LOCAL_RUNTIME_RPC_SCHEMA_VERSION = "archcontext.runtime-rpc/v2";
export const ARCHCONTEXT_SCHEMA_SET_VERSION = "2026-07-11.explorer-view-v2";

export interface ProductVersionManifest {
  schemaVersion: "archcontext.product-version-manifest/v1";
  product: {
    name: typeof ARCHCONTEXT_PRODUCT_NAME;
    version: typeof ARCHCONTEXT_PRODUCT_VERSION;
    distribution: "one-package";
  };
  packageManager: typeof ARCHCONTEXT_PACKAGE_MANAGER;
  engines: {
    node: typeof ARCHCONTEXT_NODE_RANGE;
  };
  surfaces: {
    cli: ProductSurfaceVersion;
    daemon: ProductSurfaceVersion & {
      rpcSchemaVersion: typeof LOCAL_RUNTIME_RPC_SCHEMA_VERSION;
    };
    mcp: ProductSurfaceVersion & {
      transport: "stdio";
    };
  };
  schemas: {
    schemaSetVersion: typeof ARCHCONTEXT_SCHEMA_SET_VERSION;
    contractsPackageVersion: typeof ARCHCONTEXT_PRODUCT_VERSION;
    reviewChallenge: "archcontext.review-challenge/v2";
    attestation: "archcontext.attestation/v2";
    deviceIdentity: "archcontext.device-identity/v1";
    runnerIdentity: "archcontext.runner-identity/v1";
  };
  runtime: {
    localRpc: {
      schemaVersion: typeof LOCAL_RUNTIME_RPC_SCHEMA_VERSION;
      protocol: "http-loopback";
    };
    sqliteMigrations: string;
    codeGraph: {
      packageName: "@colbymchenry/codegraph";
      requiredVersion: "1.6.2";
      adapter: "codegraph-cli";
    };
  };
}

interface ProductSurfaceVersion {
  packageName: string;
  version: typeof ARCHCONTEXT_PRODUCT_VERSION;
  entrypoint: string;
}

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
      },
      mcp: {
        packageName: "@archcontext/surfaces",
        version: ARCHCONTEXT_PRODUCT_VERSION,
        entrypoint: "archctx mcp",
        transport: "stdio"
      }
    },
    schemas: {
      schemaSetVersion: ARCHCONTEXT_SCHEMA_SET_VERSION,
      contractsPackageVersion: ARCHCONTEXT_PRODUCT_VERSION,
      reviewChallenge: "archcontext.review-challenge/v2",
      attestation: "archcontext.attestation/v2",
      deviceIdentity: "archcontext.device-identity/v1",
      runnerIdentity: "archcontext.runner-identity/v1"
    },
    runtime: {
      localRpc: {
        schemaVersion: LOCAL_RUNTIME_RPC_SCHEMA_VERSION,
        protocol: "http-loopback"
      },
      sqliteMigrations: "0001_runtime_state..0012_explorer_projection_index",
      codeGraph: {
        packageName: "@colbymchenry/codegraph",
        requiredVersion: "1.6.2",
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
