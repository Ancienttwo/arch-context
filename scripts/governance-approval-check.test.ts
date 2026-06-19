import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readbackGovernanceApproval } from "./governance-approval-check.mjs";

describe("governance-approval-check", () => {
  test("rejects a missing Sprint 2 approval artifact", async () => {
    await withApprovalFixture(async (root) => {
      await expect(readbackGovernanceApproval({ root })).resolves.toMatchObject({
        ok: false,
        failures: ["docs/approvals/archctx-sprint-2.md: missing or unreadable"]
      });
    });
  });

  test("rejects automation self-attested approvals", async () => {
    await withApprovalFixture(async (root) => {
      await write(root, "docs/approvals/archctx-sprint-2.md", approval({ approvedBy: "Codex automation" }));

      const result = await readbackGovernanceApproval({ root });
      expect(result.ok).toBe(false);
      expect(result.failures).toContain("docs/approvals/archctx-sprint-2.md: Approved By must name a human approver, not automation");
    });
  });

  test("rejects placeholder approvers in pending handoff templates", async () => {
    await withApprovalFixture(async (root) => {
      await write(root, "docs/approvals/archctx-sprint-2.md", approval({ approvedBy: "<human approver required>" }));

      const result = await readbackGovernanceApproval({ root });
      expect(result.ok).toBe(false);
      expect(result.failures).toContain("docs/approvals/archctx-sprint-2.md: Approved By must name a real human approver, not a placeholder");
    });
  });

  test("rejects approvals that do not cover every Sprint 2 ADR", async () => {
    await withApprovalFixture(async (root) => {
      await write(
        root,
        "docs/approvals/archctx-sprint-2.md",
        `# ArchContext Sprint 2 Approval Record

> **Status**: Approved
> **Date**: 2026-06-20
> **Approved By**: Repository Owner
> **Scope**: archctx-s2 contract delta and ADR-0026/ADR-0027

## Approved Boundary

- ADR-0026 and ADR-0027 are accepted for repo-local implementation.
`
      );

      const result = await readbackGovernanceApproval({ root });
      expect(result.ok).toBe(false);
      expect(result.failures).toContain("docs/approvals/archctx-sprint-2.md: missing ADR-0028");
    });
  });

  test("accepts an explicit human approval for the Sprint 2 ADR boundary", async () => {
    await withApprovalFixture(async (root) => {
      await write(root, "docs/approvals/archctx-sprint-2.md", approval({ approvedBy: "Repository Owner" }));

      await expect(readbackGovernanceApproval({ root })).resolves.toEqual({
        ok: true,
        artifactPath: "docs/approvals/archctx-sprint-2.md",
        failures: []
      });
    });
  });
});

function approval({ approvedBy, scope = "archctx-s2 contract delta and ADR-0026/ADR-0027/ADR-0028" }: { approvedBy: string; scope?: string }) {
  return `# ArchContext Sprint 2 Approval Record

> **Status**: Approved
> **Date**: 2026-06-20
> **Approved By**: ${approvedBy}
> **Scope**: ${scope}

## Source

- Human approval covers the Sprint 2 contract delta.

## Approved Boundary

- ADR-0026, ADR-0027, and ADR-0028 are accepted for repo-local implementation.
- This approval does not close production capture or production security scan evidence.
`;
}

async function withApprovalFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "archctx-governance-approval-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function write(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}
