export const ARCHCONTEXT_PRODUCT_NAME = "archctx";
export const ARCHCONTEXT_PRODUCT_VERSION = "0.2.2";
export const ARCHCONTEXT_PACKAGE_MANAGER = "bun@1.3.10";
export const ARCHCONTEXT_NODE_RANGE = ">=24 <26";
export const LOCAL_RUNTIME_RPC_SCHEMA_VERSION = "archcontext.runtime-rpc/v1";
export const ARCHCONTEXT_SCHEMA_SET_VERSION = "2026-06-25.al0-ledger";

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
      requiredVersion: "1.0.1";
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
      sqliteMigrations: "0001_runtime_state..0004_changeset_journal",
      codeGraph: {
        packageName: "@colbymchenry/codegraph",
        requiredVersion: "1.0.1",
        adapter: "codegraph-cli"
      }
    }
  };
}
