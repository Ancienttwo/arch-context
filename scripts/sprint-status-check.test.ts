import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectSprintStatusFailures } from "./sprint-status-check.mjs";

describe("sprint-status-check", () => {
  test("rejects Sprint 2 full-green claims when launch evidence is still pending", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete

| **合计** | | **56** | **25** | **81 / 81** |

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| CD-EG3 | ☑ | ADR-0026/0027/0028 记录并 Human Gate 批准 | 签批记录存档 |
| MR-16 | ☑ | 重建：删本地库后从各 repo Git + CodeGraph 重建跨仓图 | local-store-sqlite |
| MR-EG3 | ☑ | 删本地库可重建跨仓图 | rebuild e2e |
| MR-EG5 | ☑ | 跨仓抓包无代码/路径进 SaaS | 路由审计 + 抓包 |
| TR-EG4 | ☑ | runner 不向 ArchContext SaaS 上传代码/Finding | 抓包 + 路由审计 |
| HL-EG1 | ☑ | 跨仓代码不进 SaaS 验证完成 | 全链路抓包 + 路由审计 |
| HL-EG5 | ☑ | Critical/High 安全 Finding 为零 | 安全扫描报告 |
| HL-EG6 | ☑ | 关键 Eval 达标 | Eval 报告 |
`,
      async (root) => {
        const failures = await collectSprintStatusFailures(root);
        expect(failures.some((failure) => failure.includes("must not claim 81/81"))).toBe(true);
        expect(failures.some((failure) => failure.includes("CD-EG3"))).toBe(true);
        expect(failures.some((failure) => failure.includes("MR-16"))).toBe(true);
        expect(failures.some((failure) => failure.includes("MR-EG3"))).toBe(true);
        expect(failures.some((failure) => failure.includes("HL-EG1"))).toBe(true);
        expect(failures.some((failure) => failure.includes("HL-EG5"))).toBe(true);
        expect(failures.some((failure) => failure.includes("HL-EG6"))).toBe(true);
      }
    );
  });

  test("allows repo-local completion when pending gates are labeled honestly", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）

| **合计** | | **56** | **25** | **73 deterministic / 81 tracked** |

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| CD-EG3 | ◐ | ADR-0026/0027/0028 记录；Human Gate 批准记录待归档 | 签批记录存档 |
| MR-16 | ◐ | 重建：删本地库后从各 repo Git + CodeGraph 重建跨仓图 | local-store-sqlite |
| MR-EG3 | ◐ | 删本地库可重建跨仓图 | rebuild e2e pending |
| MR-EG5 | ◐ | 跨仓抓包无代码/路径进 SaaS | fixture 路由审计 + 抓包；production capture pending |
| TR-EG4 | ◐ | runner 不向 ArchContext SaaS 上传代码/Finding | fixture 抓包 + 路由审计；production capture pending |
| HL-EG1 | ◐ | 跨仓代码不进 SaaS repo-local 验证完成；生产验证待补 | fixture 抓包 + 路由审计；production capture pending |
| HL-EG5 | ◐ | deterministic surface Critical/High 安全 Finding 为零；production scan 待补 | deterministic security review；production scan pending |
| HL-EG6 | ◐ | 关键 Eval 有合同/单测覆盖；代表性 Eval 待补 | Eval report pending |
`,
      async (root) => {
        await expect(collectSprintStatusFailures(root)).resolves.toEqual([]);
      }
    );
  });

  test("rejects green CD-EG3 when the approval artifact is automation self-attested", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）

| ID | St | Gate | 验证方式（目标） |
|----|:--:|------|------------------|
| CD-EG3 | ☑ | ADR-0026/0027/0028 记录并 Human Gate 批准 | docs/approvals/archctx-sprint-2.md |
`,
      async (root) => {
        const failures = await collectSprintStatusFailures(root);
        expect(failures.some((failure) => failure.includes("CD-EG3") && failure.includes("missing or invalid"))).toBe(true);
      },
      {
        approvalArtifact: approvalArtifact("Codex automation")
      }
    );
  });

  test("accepts local GitHub governance follow-up only as deferred draft intake", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root);
        await write(
          root,
          "tasks/todos.md",
          [
            "# Deferred Goal Ledger",
            "",
            "| Goal | Why Deferred | Tradeoff | Revisit Trigger |",
            "|------|--------------|----------|-----------------|",
            "| Local GitHub governance follow-up | Draft intake only | not active | plans/sprints/archctx-local-github-governance-sprint.md |"
          ].join("\n")
        );
        await expect(collectSprintStatusFailures(root)).resolves.toEqual([]);
      }
    );
  });

  test("rejects local GitHub governance follow-up completion claims during draft intake", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          sprintStatus: "> **Status**: Complete",
          total: "| **合计** | | **141** | **51** | **192 / 192** |",
          completedTask: "| FG0-01 | ☑ | 评审并接受 Follow-up PRD | docs/product | E0 | — |"
        });
        await write(root, "tasks/todos.md", "# Deferred Goal Ledger\n");
        const failures = await collectSprintStatusFailures(root);
        expect(failures.some((failure) => failure.includes("Draft — Not Started"))).toBe(true);
        expect(failures.some((failure) => failure.includes("0 / 192"))).toBe(true);
        expect(failures.some((failure) => failure.includes("must not be marked complete"))).toBe(true);
      }
    );
  });
});

async function withFixture(sprint2: string, run: (root: string) => Promise<void>, options: { approvalArtifact?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "archctx-sprint-status-"));
  try {
    await write(root, "docs/spec.md", "Full PRD: plans/prds/20260619-2039-archcontext.prd.md\n");
    await write(
      root,
      "plans/prds/20260619-2039-archcontext.prd.md",
      ["**Status**: Active", "**Slug**: archctx", "**Created**: 2026-06-19", "**Updated**: 2026-06-19", "**Source Spec**: docs/spec.md"].join("\n")
    );
    await write(
      root,
      "plans/sprints/archctx-sprint.md",
      [
        "# Sprint 1",
        "> **Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`",
        "## M0",
        "## M1",
        "## M2",
        "## M3",
        "## M4",
        "## M5",
        "## M6"
      ].join("\n")
    );
    await write(root, "plans/sprints/archctx-sprint-2.md", sprint2);
    if (options.approvalArtifact) {
      await write(root, "docs/approvals/archctx-sprint-2.md", options.approvalArtifact);
    }
    await write(
      root,
      "packages/cloud/hardening/src/index.ts",
      `export function sprint2LaunchGateReport() {
  return {
    securityFindings: { productionScan: "pending" },
    packetCapture: { production: "pending-production-environment" }
  };
}
`
    );
    await write(
      root,
      "docs/security/captures/manifest.json",
      JSON.stringify(
        {
          schemaVersion: "archcontext.privacy-capture-manifest/v1",
          captures: [
            { id: "fixture.metadata-only", environment: "fixture", status: "verified" },
            { id: "production.real-capture", environment: "production", status: "pending" }
          ]
        },
        null,
        2
      )
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function approvalArtifact(approvedBy: string) {
  return `# ArchContext Sprint 2 Approval Record

> **Status**: Approved
> **Date**: 2026-06-20
> **Approved By**: ${approvedBy}
> **Scope**: archctx-s2 contract delta and ADR-0026/ADR-0027/ADR-0028

## Approved Boundary

- ADR-0026, ADR-0027, and ADR-0028 are accepted.
`;
}

async function write(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function writeGovernanceFollowup(root: string, options: { sprintStatus?: string; total?: string; completedTask?: string } = {}) {
  const prdPath = "plans/prds/20260620-0236-archcontext-local-github-governance.prd.md";
  const sprintPath = "plans/sprints/archctx-local-github-governance-sprint.md";
  await write(
    root,
    prdPath,
    [
      "# ArchContext Follow-up PRD",
      "> **Status**: Draft for Architecture Review",
      "> **Slug**: archcontext-local-github-governance",
      "> **Created**: 2026-06-20",
      "> **Updated**: 2026-06-20",
      "> **Source PRD**: `plans/prds/20260619-2039-archcontext.prd.md`",
      "> **Source Spec**: `docs/spec.md`"
    ].join("\n")
  );
  await write(
    root,
    sprintPath,
    [
      "# Sprint: ArchContext Local Product + GitHub Governance",
      options.sprintStatus ?? "> **Status**: Draft — Not Started",
      "> **Slug**: archctx-local-github-governance",
      `> **Source PRD**: \`${prdPath}\``,
      "> **Parent Sprint**: `plans/sprints/archctx-sprint.md`",
      "",
      options.total ?? "| **合计** | | **141** | **51** | **0 / 192** |",
      "",
      "| ID | St | 任务 | Owner | Target | Deps |",
      "|---|:---:|---|---|:---:|---|",
      options.completedTask ?? "| FG0-01 | ◻ | 评审并接受 Follow-up PRD | docs/product | E0 | — |"
    ].join("\n")
  );
}
