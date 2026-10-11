import { describe, expect, test } from "bun:test";
import type { NativeNode } from "@archcontext/core/projection-engine";
import { measureCapabilityDependencies, type CapabilityDependencyInputV1 } from "../src/index";
import { WORKTREE_DIGEST, digestOf } from "./factories";

/**
 * Two capabilities with one nested component each, a contested file, a file under a
 * non-capability root and an unowned file, so every attribution cause is exercised.
 */
const NODES: NativeNode[] = [
  { id: "capability.billing", kind: "capability", name: "Billing", source: { include: ["src/billing/**"] } },
  { id: "component.invoice", kind: "component", name: "Invoice", parent: "capability.billing", source: { include: ["src/billing/invoice/**"] } },
  { id: "capability.checkout", kind: "capability", name: "Checkout", source: { include: ["src/checkout/**"] } },
  { id: "component.cart", kind: "component", name: "Cart", parent: "capability.checkout", source: { include: ["src/checkout/cart/**", "src/shared/money.ts"] } },
  { id: "module.shared", kind: "module", name: "Shared", source: { include: ["src/shared/**"] } }
];

const FILES = [
  "src/billing/invoice/invoice.ts",
  "src/billing/ledger.ts",
  "src/checkout/cart/cart.ts",
  "src/checkout/pay.ts",
  "src/shared/money.ts",
  "src/shared/time.ts",
  "src/other/loose.ts"
];

function input(overrides: Partial<CapabilityDependencyInputV1> = {}): CapabilityDependencyInputV1 {
  return {
    nodes: NODES,
    worktreeDigest: WORKTREE_DIGEST,
    files: FILES,
    importEdges: [
      // checkout -> billing, twice through two files, plus a duplicate specifier for the same pair.
      { from: "src/checkout/cart/cart.ts", specifier: "../../billing/invoice/invoice", to: "src/billing/invoice/invoice.ts" },
      { from: "src/checkout/cart/cart.ts", specifier: "../../billing/invoice/invoice.ts", to: "src/billing/invoice/invoice.ts" },
      { from: "src/checkout/pay.ts", specifier: "../billing/ledger", to: "src/billing/ledger.ts" },
      // inside billing: rolls up to the diagonal cell.
      { from: "src/billing/ledger.ts", specifier: "./invoice/invoice", to: "src/billing/invoice/invoice.ts" },
      // billing -> contested file (cart and shared both claim money.ts on different chains).
      { from: "src/billing/ledger.ts", specifier: "../shared/money", to: "src/shared/money.ts" },
      // billing -> a file whose only owner has no capability ancestor.
      { from: "src/billing/ledger.ts", specifier: "../shared/time", to: "src/shared/time.ts" },
      // unowned importer.
      { from: "src/other/loose.ts", specifier: "../checkout/pay", to: "src/checkout/pay.ts" },
      // a repository-local specifier no producer resolved, and a package import that is not local.
      { from: "src/checkout/pay.ts", specifier: "./missing", to: null },
      { from: "src/checkout/pay.ts", specifier: "react", to: null }
    ],
    workspacePackages: [],
    truncated: false,
    importNodeCount: 9,
    importNodeLimit: 50_000,
    importNodeLimitExceeded: false,
    codeFacts: { availability: "ready", indexedWorktreeDigest: WORKTREE_DIGEST },
    ...overrides
  };
}

describe("capability dependency matrix (#301)", () => {
  test("owners roll up to their capability and only attributed edges fill the matrix", () => {
    const result = measureCapabilityDependencies(input());
    expect(result.capabilities).toEqual(["capability.billing", "capability.checkout"]);
    expect(result.matrix).toEqual([
      { from: "capability.billing", to: "capability.billing", imports: 1, calls: null },
      { from: "capability.checkout", to: "capability.billing", imports: 2, calls: null }
    ]);
    expect(result.imports).toMatchObject({
      coverage: "complete",
      reasonCodes: [],
      edgeCount: 6,
      unresolvedCount: 1,
      unattributed: { unownedEndpoint: 1, contestedEndpoint: 1, noCapabilityEndpoint: 1 }
    });
    expect(result.calls).toEqual({ coverage: "unknown", reasonCodes: ["call-edges-not-exposed"] });
    expect(result.edges.count).toBe(3);
    expect(result.edges.items[0]).toEqual({
      fromPath: "src/billing/ledger.ts",
      toPath: "src/billing/invoice/invoice.ts",
      fromCapability: "capability.billing",
      toCapability: "capability.billing"
    });
  });

  test("--into keeps edges whose imported file the node or a descendant owns", () => {
    const into = measureCapabilityDependencies(input({ into: "capability.billing" }));
    expect(into.filter).toEqual({ from: null, into: "capability.billing" });
    expect(into.matrix).toEqual([
      { from: "capability.billing", to: "capability.billing", imports: 1, calls: null },
      { from: "capability.checkout", to: "capability.billing", imports: 2, calls: null }
    ]);
    expect(into.imports.unresolvedCount).toBe(0);
    // A descendant filter narrows to the files that node owns.
    const component = measureCapabilityDependencies(input({ into: "component.invoice" }));
    expect(component.edges.items.map((edge) => edge.fromPath)).toEqual(["src/billing/ledger.ts", "src/checkout/cart/cart.ts"]);
  });

  test("--from keeps edges whose importing file the node or a descendant owns", () => {
    const from = measureCapabilityDependencies(input({ from: "capability.checkout" }));
    expect(from.matrix).toEqual([{ from: "capability.checkout", to: "capability.billing", imports: 2, calls: null }]);
    expect(from.imports.unattributed).toEqual({ unownedEndpoint: 0, contestedEndpoint: 0, noCapabilityEndpoint: 0 });
    expect(from.imports.unresolvedCount).toBe(1);
  });

  test("an index that did not attest to this tree gives unknown coverage and no edges", () => {
    const stale = measureCapabilityDependencies(input({ codeFacts: { availability: "ready", indexedWorktreeDigest: digestOf("other") } }));
    expect(stale.matrix).toEqual([]);
    expect(stale.imports).toMatchObject({ coverage: "unknown", reasonCodes: ["code-facts-stale"], edgeCount: 0 });
    const missing = measureCapabilityDependencies(input({ codeFacts: { availability: "unavailable", indexedWorktreeDigest: null }, truncated: true, importNodeCount: null }));
    expect(missing.imports).toMatchObject({ coverage: "unknown", reasonCodes: ["code-facts-unavailable"], truncated: true, importNodeCount: null });
  });

  test("a read cut by the import node limit is partial and says so", () => {
    const limited = measureCapabilityDependencies(input({ importNodeLimitExceeded: true, importNodeCount: 70_000 }));
    expect(limited.imports).toMatchObject({
      coverage: "partial",
      reasonCodes: ["code-facts-import-limit"],
      truncated: false,
      importNodeCount: 70_000,
      importNodeLimitExceeded: true
    });
  });

  test("edges list at most edgeLimit items and keep the full count", () => {
    const limited = measureCapabilityDependencies(input({ edgeLimit: 1 }));
    expect(limited.edges).toMatchObject({ limit: 1, count: 3, omittedCount: 2 });
    expect(limited.edges.items).toHaveLength(1);
  });
});
