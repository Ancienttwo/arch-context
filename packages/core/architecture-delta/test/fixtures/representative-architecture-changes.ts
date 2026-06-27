import { digestJson, type Json, type NormalizedCodeContext } from "@archcontext/contracts";
import type { ArchitectureDeltaDeclaredGraph, ArchitectureDeltaGitChangeMetadata } from "../../src/index";

export const representativeArchitectureChangeScenarios = [
  {
    scenarioId: "monolith-to-service",
    description: "Order handling moves from the legacy monolith into the orders service.",
    path: "src/services/orders/order-service.ts",
    previousPath: "src/legacy/order-service.ts",
    status: "renamed",
    rawStatus: "R100",
    expectedCandidate: {
      kind: "node-moved",
      target: { kind: "node", id: "module.order-service" },
      stateDimension: "target-state",
      changeKind: "moved"
    }
  },
  {
    scenarioId: "persistence-boundary",
    description: "The orders repository changes inside the declared persistence boundary.",
    path: "src/persistence/orders/repository.ts",
    status: "modified",
    rawStatus: "M",
    expectedCandidate: {
      kind: "constraint-materially-changed",
      target: { kind: "constraint", id: "constraint.order-persistence-boundary" },
      stateDimension: "target-state",
      changeKind: "materially_changed"
    }
  },
  {
    scenarioId: "public-api",
    description: "The public orders API contract surface changes.",
    path: "src/api/public/orders.ts",
    status: "modified",
    rawStatus: "M",
    expectedCandidate: {
      kind: "constraint-materially-changed",
      target: { kind: "constraint", id: "constraint.public-orders-api-contract" },
      stateDimension: "target-state",
      changeKind: "materially_changed"
    }
  },
  {
    scenarioId: "payment-webhook",
    description: "A new payment webhook handler becomes part of the architecture graph.",
    path: "src/webhooks/payments/stripe.ts",
    status: "added",
    rawStatus: "A",
    expectedCandidate: {
      kind: "node-added",
      target: { kind: "node", id: "module.payment-webhook" },
      stateDimension: "target-state",
      changeKind: "added"
    }
  },
  {
    scenarioId: "mapper-removal",
    description: "The legacy order mapper is removed and should surface as lifecycle-sensitive removal.",
    path: "src/mappers/order-mapper.ts",
    status: "deleted",
    rawStatus: "D",
    expectedCandidate: {
      kind: "lifecycle-removed",
      target: { kind: "lifecycle", id: "module.order-mapper:lifecycle" },
      stateDimension: "target-state",
      changeKind: "removed"
    }
  },
  {
    scenarioId: "package-layer",
    description: "The package layer entrypoint changes inside the declared orders package.",
    path: "packages/orders/src/index.ts",
    status: "modified",
    rawStatus: "M",
    expectedCandidate: {
      kind: "constraint-materially-changed",
      target: { kind: "constraint", id: "constraint.orders-package-layer" },
      stateDimension: "target-state",
      changeKind: "materially_changed"
    }
  }
] satisfies Array<{
  scenarioId: string;
  description: string;
  path: string;
  previousPath?: string;
  status: ArchitectureDeltaGitChangeMetadata["paths"][number]["status"];
  rawStatus: string;
  expectedCandidate: {
    kind: string;
    target: { kind: string; id: string };
    stateDimension: string;
    changeKind: string;
  };
}>;

export const representativeArchitectureGitPaths: ArchitectureDeltaGitChangeMetadata["paths"] =
  representativeArchitectureChangeScenarios.map(({ path, previousPath, status, rawStatus }) => ({
    path,
    ...(previousPath ? { previousPath } : {}),
    status,
    rawStatus
  }));

export const representativeArchitectureDeclaredGraph: ArchitectureDeltaDeclaredGraph = {
  entities: [
    {
      entityId: "module.order-service",
      kind: "service",
      canonicalName: "Orders Service",
      status: "active",
      path: "src/services/orders",
      metadata: {
        owner: "team.orders",
        migrationState: "extracting-from-monolith"
      }
    },
    {
      entityId: "module.order-persistence",
      kind: "datastore-adapter",
      canonicalName: "Orders Persistence Boundary",
      status: "active",
      path: "src/persistence/orders",
      metadata: { owner: "team.orders" }
    },
    {
      entityId: "api.public-orders",
      kind: "public-api",
      canonicalName: "Public Orders API",
      status: "active",
      path: "src/api/public",
      metadata: { owner: "team.platform" }
    },
    {
      entityId: "module.payment-webhook",
      kind: "webhook",
      canonicalName: "Payment Webhook",
      status: "active",
      path: "src/webhooks/payments",
      metadata: {
        owner: "team.payments",
        lifecycleState: "beta"
      }
    },
    {
      entityId: "module.order-mapper",
      kind: "mapper",
      canonicalName: "Legacy Order Mapper",
      status: "active",
      path: "src/mappers/order-mapper.ts",
      metadata: {
        lifecycleState: "legacy"
      }
    },
    {
      entityId: "package.orders",
      kind: "package",
      canonicalName: "Orders Package",
      status: "active",
      path: "packages/orders/src",
      metadata: { owner: "team.orders" }
    }
  ],
  relations: [
    {
      relationId: "relation.public-api-order-service",
      kind: "depends_on",
      sourceEntityId: "api.public-orders",
      targetEntityId: "module.order-service",
      status: "active"
    },
    {
      relationId: "relation.payment-webhook-order-service",
      kind: "depends_on",
      sourceEntityId: "module.payment-webhook",
      targetEntityId: "module.order-service",
      status: "active"
    },
    {
      relationId: "relation.order-service-persistence",
      kind: "depends_on",
      sourceEntityId: "module.order-service",
      targetEntityId: "module.order-persistence",
      status: "active"
    },
    {
      relationId: "relation.orders-package-service",
      kind: "depends_on",
      sourceEntityId: "package.orders",
      targetEntityId: "module.order-service",
      status: "active"
    }
  ],
  constraints: [
    {
      constraintId: "constraint.order-persistence-boundary",
      kind: "persistence-boundary",
      subjectId: "module.order-persistence",
      status: "active",
      severity: "error"
    },
    {
      constraintId: "constraint.public-orders-api-contract",
      kind: "public-api-contract",
      subjectId: "api.public-orders",
      status: "active",
      severity: "error"
    },
    {
      constraintId: "constraint.payment-webhook-idempotency",
      kind: "payment-webhook-idempotency",
      subjectId: "module.payment-webhook",
      status: "active",
      severity: "error"
    },
    {
      constraintId: "constraint.orders-package-layer",
      kind: "package-layer",
      subjectId: "package.orders",
      status: "active",
      severity: "warning"
    }
  ]
};

const representativeContextDraft = {
  task: "extract order handling from the monolith while preserving API, persistence, webhook and package boundaries",
  symbols: [
    {
      id: "symbol.order-service",
      name: "OrderService",
      kind: "class",
      path: "src/services/orders/order-service.ts",
      range: { startLine: 8, endLine: 80 }
    },
    {
      id: "symbol.order-repository",
      name: "OrderRepository",
      kind: "class",
      path: "src/persistence/orders/repository.ts",
      range: { startLine: 5, endLine: 64 }
    },
    {
      id: "symbol.public-orders-route",
      name: "PublicOrdersRoute",
      kind: "function",
      path: "src/api/public/orders.ts",
      range: { startLine: 10, endLine: 32 }
    },
    {
      id: "symbol.stripe-webhook",
      name: "StripePaymentWebhook",
      kind: "function",
      path: "src/webhooks/payments/stripe.ts",
      range: { startLine: 1, endLine: 42 }
    },
    {
      id: "symbol.order-mapper",
      name: "OrderMapper",
      kind: "class",
      path: "src/mappers/order-mapper.ts",
      range: { startLine: 1, endLine: 55 }
    },
    {
      id: "symbol.orders-package-entrypoint",
      name: "OrdersPackageEntrypoint",
      kind: "module",
      path: "packages/orders/src/index.ts",
      range: { startLine: 1, endLine: 12 }
    }
  ],
  edges: [
    {
      source: "file:src/api/public/orders.ts",
      target: "file:src/services/orders/order-service.ts",
      kind: "imports" as const,
      confidence: "high" as const
    },
    {
      source: "file:src/webhooks/payments/stripe.ts",
      target: "file:src/services/orders/order-service.ts",
      kind: "imports" as const,
      confidence: "high" as const
    },
    {
      source: "file:src/services/orders/order-service.ts",
      target: "file:src/persistence/orders/repository.ts",
      kind: "imports" as const,
      confidence: "high" as const
    },
    {
      source: "file:packages/orders/src/index.ts",
      target: "file:src/services/orders/order-service.ts",
      kind: "imports" as const,
      confidence: "medium" as const
    }
  ],
  evidence: []
};

export const representativeArchitectureCodeContext: NormalizedCodeContext = {
  ...representativeContextDraft,
  digest: digestJson({
    task: representativeContextDraft.task,
    symbols: representativeContextDraft.symbols,
    edges: representativeContextDraft.edges
  } as unknown as Json)
};
