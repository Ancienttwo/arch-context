import { describe, expect, test } from "bun:test";
import { modelProposalDigest, modelProposalReceipt, parseModelProposal } from "./apply-model-proposal";

const proposal = {
  schemaVersion: "archcontext.model-proposal/v1",
  changeSetId: "changeset.axr7.fixture",
  taskSessionId: "task_axr7_fixture",
  operations: [{
    op: "create_entity",
    path: ".archcontext/model/flows/flow.fixture.yaml",
    entityId: "flow.fixture",
    expectedHash: "missing",
    body: "schemaVersion: archcontext.flow/v1\nid: flow.fixture\ncapabilityId: capability.fixture\nname: Fixture\napplicability: not-applicable\nrationale: Test fixture\n"
  }]
} as const;

describe("apply-model-proposal", () => {
  test("accepts a bounded typed model proposal and emits a body-free receipt", () => {
    const parsed = parseModelProposal(proposal);
    const receipt = modelProposalReceipt({ proposal: parsed, mode: "preview", worktreeDigest: "sha256:worktree", modelDigest: "sha256:model", status: "proposed" });
    expect(receipt.proposalDigest).toBe(modelProposalDigest(parsed));
    expect(receipt.paths).toEqual([".archcontext/model/flows/flow.fixture.yaml"]);
    expect(JSON.stringify(receipt)).not.toContain("rationale: Test fixture");
  });

  test("rejects paths outside the architecture model authority", () => {
    expect(() => parseModelProposal({ ...proposal, operations: [{ ...proposal.operations[0], path: "docs/architecture/fixture.md" }] })).toThrow("outside the model authority");
  });

  test("rejects duplicate paths and unbounded expected hashes", () => {
    expect(() => parseModelProposal({ ...proposal, operations: [proposal.operations[0], proposal.operations[0]] })).toThrow("duplicate");
    expect(() => parseModelProposal({ ...proposal, operations: [{ ...proposal.operations[0], expectedHash: "unknown" }] })).toThrow("invalid expectedHash");
  });

  test("accepts a hash-bound delete without a body", () => {
    const parsed = parseModelProposal({ ...proposal, operations: [{
      op: "delete_entity",
      path: ".archcontext/model/nodes/capability.bootstrap.yaml",
      entityId: "capability.bootstrap",
      expectedHash: `sha256:${"a".repeat(64)}`
    }] });
    expect(parsed.operations[0].op).toBe("delete_entity");
  });
});
