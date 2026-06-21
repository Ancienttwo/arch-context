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

  test("accepts local GitHub governance follow-up after FG0 evidence is recorded", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG0 Complete",
          total: "| **合计** | | **141** | **51** | **23 / 192** |",
          completedTask: [
            "| FG0-01 | ☑ | 评审并接受 Follow-up PRD | docs/product | E0 | — |",
            "| FG0-EG5 | ☑ | Acceptance ledger 可校验不存在无证据的完成状态 | E1 | `bun run verify:acceptance-ledger` |"
          ].join("\n")
        });
        await writeFg0Evidence(root);
        await expect(collectSprintStatusFailures(root)).resolves.toEqual([]);
      }
    );
  });

  test("accepts local GitHub governance follow-up with FG1 partial ledger evidence", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG1 In Progress",
          total: "| **合计** | | **141** | **51** | **25 / 192** |",
          completedTask: [
            "| FG1 | 单一安装与本地 Surface | 18 | 6 | 2 / 24 |",
            "| FG0-01 | ☑ | 评审并接受 Follow-up PRD | docs/product | E0 | — |",
            "| FG1-01 | ☑ | 建立唯一 Production Composition Root | runtime-daemon | E1 | PRE-01..05 |",
            "| FG1-02 | ☑ | Production 不可注入 Mock Store 或 Mock CodeGraph | runtime-daemon · build | E1 | FG1-01 |"
          ].join("\n")
        });
        await writeFg0Evidence(root, ["FG1-01", "FG1-02"]);
        await write(root, "docs/verification/fg1-local-product-gate.md", "# FG1 Verification\n\n## Decision\n\nPARTIAL\n");
        await expect(collectSprintStatusFailures(root)).resolves.toEqual([]);
      }
    );
  });

  test("accepts FG2 progress only after FG1 exit evidence is complete", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG2 In Progress",
          total: "| **合计** | | **141** | **51** | **48 / 192** |",
          completedTask: [
            "| FG1 | 单一安装与本地 Surface | 18 | 6 | 24 / 24 |",
            "| FG2 | GitHub 隐私治理平面 | 20 | 7 | 1 / 27 |",
            "| FG2-01 | ☑ | 固化 GitHub App permission manifest | github-app · infra | E1 | FG0-11 |"
          ].join("\n")
        });
        await writeFg0Evidence(root, [
          ...Array.from({ length: 18 }, (_, index) => `FG1-${String(index + 1).padStart(2, "0")}`),
          ...Array.from({ length: 6 }, (_, index) => `FG1-EG${index + 1}`),
          "FG2-01"
        ]);
        await write(root, "docs/verification/fg1-local-product-gate.md", "# FG1 Verification\n\n## Decision\n\nPASS for FG1-01 through FG1-18 plus FG1-EG1 through FG1-EG6.\n");
        await write(root, "docs/verification/fg2-github-privacy-gate.md", "# FG2 Verification\n\n## Decision\n\nPARTIAL PASS for FG2-01.\n");
        await expect(collectSprintStatusFailures(root)).resolves.toEqual([]);
      }
    );
  });

  test("accepts FG3 progress only after FG2 exit evidence is complete", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG3 In Progress",
          total: "| **合计** | | **141** | **51** | **75 / 192** |",
          completedTask: [
            "| FG1 | 单一安装与本地 Surface | 18 | 6 | 24 / 24 |",
            "| FG2 | GitHub 隐私治理平面 | 20 | 7 | 27 / 27 |",
            "| FG3 | Challenge/Attestation v2 与 Developer Review | 24 | 8 | 1 / 32 |",
            "| FG3-01 | ☑ | 实现 ReviewChallenge v2 Domain 和 canonical serialization | contracts · attestation | E1 | FG0-06 |"
          ].join("\n")
        });
        await writeFg0Evidence(root, [
          ...Array.from({ length: 18 }, (_, index) => `FG1-${String(index + 1).padStart(2, "0")}`),
          ...Array.from({ length: 6 }, (_, index) => `FG1-EG${index + 1}`),
          ...Array.from({ length: 20 }, (_, index) => `FG2-${String(index + 1).padStart(2, "0")}`),
          ...Array.from({ length: 7 }, (_, index) => `FG2-EG${index + 1}`),
          "FG3-01"
        ]);
        await write(root, "docs/verification/fg1-local-product-gate.md", "# FG1 Verification\n\n## Decision\n\nPASS for FG1-01 through FG1-18 plus FG1-EG1 through FG1-EG6.\n");
        await write(root, "docs/verification/fg2-github-privacy-gate.md", "# FG2 Verification\n\n## Decision\n\nPASS for all FG2 tasks and for FG2-EG1 through FG2-EG7.\n");
        await expect(collectSprintStatusFailures(root)).resolves.toEqual([]);
      }
    );
  });

  test("rejects FG4 progress before FG3 exit evidence is complete", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG4 In Progress",
          total: "| **合计** | | **141** | **51** | **106 / 192** |",
          completedTask: [
            "| FG1 | 单一安装与本地 Surface | 18 | 6 | 24 / 24 |",
            "| FG2 | GitHub 隐私治理平面 | 20 | 7 | 27 / 27 |",
            "| FG3 | Challenge/Attestation v2 与 Developer Review | 24 | 8 | 31 / 32 |",
            "| FG4 | 客户控制 Organization Runner | 21 | 8 | 1 / 29 |",
            "| FG4-01 | ☑ | 实现 RunnerIdentity Domain、状态和 repository/org scope | contracts · runner | E1 | FG0-08 |"
          ].join("\n")
        });
        await writeFg0Evidence(root, [
          ...fgTaskIds("FG1", 18),
          ...fgExitGateIds("FG1", 6),
          ...fgTaskIds("FG2", 20),
          ...fgExitGateIds("FG2", 7),
          ...fgTaskIds("FG3", 24),
          ...fgExitGateIds("FG3", 7),
          "FG4-01"
        ]);
        await writeFg1Evidence(root);
        await writeFg2Evidence(root);
        await write(root, "docs/verification/fg3-developer-review-gate.md", "# FG3 Verification\n\n## Decision\n\nPARTIAL\n");
        const failures = await collectSprintStatusFailures(root);
        expect(failures.some((failure) => failure.includes("FG4-FG6 completion is not accepted until FG3 exit evidence exists"))).toBe(true);
      }
    );
  });

  test("accepts FG4 progress only after FG3 exit evidence is complete", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG4 In Progress",
          total: "| **合计** | | **141** | **51** | **107 / 192** |",
          completedTask: [
            "| FG1 | 单一安装与本地 Surface | 18 | 6 | 24 / 24 |",
            "| FG2 | GitHub 隐私治理平面 | 20 | 7 | 27 / 27 |",
            "| FG3 | Challenge/Attestation v2 与 Developer Review | 24 | 8 | 32 / 32 |",
            "| FG4 | 客户控制 Organization Runner | 21 | 8 | 1 / 29 |",
            "| FG4-01 | ☑ | 实现 RunnerIdentity Domain、状态和 repository/org scope | contracts · runner | E1 | FG0-08 |"
          ].join("\n")
        });
        await writeFg0Evidence(root, [
          ...fgTaskIds("FG1", 18),
          ...fgExitGateIds("FG1", 6),
          ...fgTaskIds("FG2", 20),
          ...fgExitGateIds("FG2", 7),
          ...fgTaskIds("FG3", 24),
          ...fgExitGateIds("FG3", 8),
          "FG4-01"
        ]);
        await writeFg1Evidence(root);
        await writeFg2Evidence(root);
        await writeFg3Evidence(root);
        await expect(collectSprintStatusFailures(root)).resolves.toEqual([]);
      }
    );
  });

  test("keeps FG5 progress blocked before FG4 exit evidence is complete", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG5 In Progress",
          total: "| **合计** | | **141** | **51** | **108 / 192** |",
          completedTask: [
            "| FG1 | 单一安装与本地 Surface | 18 | 6 | 24 / 24 |",
            "| FG2 | GitHub 隐私治理平面 | 20 | 7 | 27 / 27 |",
            "| FG3 | Challenge/Attestation v2 与 Developer Review | 24 | 8 | 32 / 32 |",
            "| FG4 | 客户控制 Organization Runner | 21 | 8 | 1 / 29 |",
            "| FG5 | Control Plane 持久化与 Check Delivery | 20 | 7 | 1 / 27 |",
            "| FG4-01 | ☑ | 实现 RunnerIdentity Domain、状态和 repository/org scope | contracts · runner | E1 | FG0-08 |",
            "| FG5-01 | ☑ | 为 `review_challenges` 建立真实 migration、索引和唯一约束 | cloud-db | E2 | FG3-01,04 |"
          ].join("\n")
        });
        await writeFg0Evidence(root, [
          ...fgTaskIds("FG1", 18),
          ...fgExitGateIds("FG1", 6),
          ...fgTaskIds("FG2", 20),
          ...fgExitGateIds("FG2", 7),
          ...fgTaskIds("FG3", 24),
          ...fgExitGateIds("FG3", 8),
          "FG4-01",
          "FG5-01"
        ]);
        await writeFg1Evidence(root);
        await writeFg2Evidence(root);
        await writeFg3Evidence(root);
        const failures = await collectSprintStatusFailures(root);
        expect(failures.some((failure) => failure.includes("FG5-FG6 completion is not accepted until FG4 exit evidence exists"))).toBe(true);
        expect(failures.some((failure) => failure.includes("unsupported governance entry is completed before its evidence gate: FG5-01"))).toBe(true);
      }
    );
  });

  test("accepts FG4 complete before FG5 starts", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG4 Complete",
          total: "| **合计** | | **141** | **51** | **135 / 192** |",
          completedTask: [
            "| FG1 | 单一安装与本地 Surface | 18 | 6 | 24 / 24 |",
            "| FG2 | GitHub 隐私治理平面 | 20 | 7 | 27 / 27 |",
            "| FG3 | Challenge/Attestation v2 与 Developer Review | 24 | 8 | 32 / 32 |",
            "| FG4 | 客户控制 Organization Runner | 21 | 8 | 29 / 29 |",
            "| FG4-01 | ☑ | 实现 RunnerIdentity Domain、状态和 repository/org scope | contracts · runner | E1 | FG0-08 |",
            "| FG4-EG5 | ☑ | Fork PR 不泄露 Secret，也不执行危险 `pull_request_target` 路径 | E3 | public fork adversarial test |"
          ].join("\n")
        });
        await writeFg0Evidence(root, [
          ...fgTaskIds("FG1", 18),
          ...fgExitGateIds("FG1", 6),
          ...fgTaskIds("FG2", 20),
          ...fgExitGateIds("FG2", 7),
          ...fgTaskIds("FG3", 24),
          ...fgExitGateIds("FG3", 8),
          ...fgTaskIds("FG4", 21),
          ...fgExitGateIds("FG4", 8)
        ]);
        await writeFg1Evidence(root);
        await writeFg2Evidence(root);
        await writeFg3Evidence(root);
        await writeFg4Evidence(root);
        await expect(collectSprintStatusFailures(root)).resolves.toEqual([]);
      }
    );
  });

  test("accepts FG5 progress after FG4 exit evidence is complete", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG5 In Progress",
          total: "| **合计** | | **141** | **51** | **136 / 192** |",
          completedTask: [
            "| FG1 | 单一安装与本地 Surface | 18 | 6 | 24 / 24 |",
            "| FG2 | GitHub 隐私治理平面 | 20 | 7 | 27 / 27 |",
            "| FG3 | Challenge/Attestation v2 与 Developer Review | 24 | 8 | 32 / 32 |",
            "| FG4 | 客户控制 Organization Runner | 21 | 8 | 29 / 29 |",
            "| FG5 | Control Plane 持久化与 Check Delivery | 20 | 7 | 1 / 27 |",
            "| FG4-EG5 | ☑ | Fork PR 不泄露 Secret，也不执行危险 `pull_request_target` 路径 | E3 | public fork adversarial test |",
            "| FG5-01 | ☑ | 为 `review_challenges` 建立真实 migration、索引和唯一约束 | cloud-db | E2 | FG3-01,04 |"
          ].join("\n")
        });
        await writeFg0Evidence(root, [
          ...fgTaskIds("FG1", 18),
          ...fgExitGateIds("FG1", 6),
          ...fgTaskIds("FG2", 20),
          ...fgExitGateIds("FG2", 7),
          ...fgTaskIds("FG3", 24),
          ...fgExitGateIds("FG3", 8),
          ...fgTaskIds("FG4", 21),
          ...fgExitGateIds("FG4", 8),
          "FG5-01"
        ]);
        await writeFg1Evidence(root);
        await writeFg2Evidence(root);
        await writeFg3Evidence(root);
        await writeFg4Evidence(root);
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

  test("rejects FG1 completion while only FG0 has acceptance evidence", async () => {
    await withFixture(
      `# Sprint 2

> **Status**: Complete（repo-local deterministic；production / governance evidence pending）
`,
      async (root) => {
        await writeGovernanceFollowup(root, {
          prdStatus: "> **Status**: Accepted for FG0 Contract Execution",
          sprintStatus: "> **Status**: Executing — FG0 Complete",
          total: "| **合计** | | **141** | **51** | **24 / 192** |",
          completedTask: [
            "| FG0-01 | ☑ | 评审并接受 Follow-up PRD | docs/product | E0 | — |",
            "| FG1-01 | ☑ | 建立唯一 Production Composition Root | runtime-daemon | E1 | PRE-01..05 |"
          ].join("\n")
        });
        await writeFg0Evidence(root);
        const failures = await collectSprintStatusFailures(root);
        expect(failures.some((failure) => failure.includes("FG1 progress must use status"))).toBe(true);
        expect(failures.some((failure) => failure.includes("sprint marks FG1-01 complete without completed ledger evidence"))).toBe(true);
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

async function writeGovernanceFollowup(root: string, options: { prdStatus?: string; sprintStatus?: string; total?: string; completedTask?: string } = {}) {
  const prdPath = "plans/prds/20260620-0236-archcontext-local-github-governance.prd.md";
  const sprintPath = "plans/sprints/archctx-local-github-governance-sprint.md";
  await write(
    root,
    prdPath,
    [
      "# ArchContext Follow-up PRD",
      options.prdStatus ?? "> **Status**: Draft for Architecture Review",
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

async function writeFg0Evidence(root: string, extraCompleted: string[] = []) {
  await write(root, "docs/verification/fg0-contract-correction-gate.md", "# FG0 Verification\n\n## Decision\n\nPASS\n");
  const completed = [
    ...Array.from({ length: 18 }, (_, index) => `FG0-${String(index + 1).padStart(2, "0")}`),
    ...Array.from({ length: 5 }, (_, index) => `FG0-EG${index + 1}`),
    ...extraCompleted
  ];
  await write(
    root,
    "docs/verification/acceptance-ledger.json",
    JSON.stringify(
      {
        schemaVersion: "archcontext.acceptance-ledger/v1",
        entries: completed.map((id) => ({
          id,
          kind: id.includes("-EG") ? "exit-gate" : "task",
          status: "completed",
          target: id === "FG0-18" || id.startsWith("FG0-EG") || id.startsWith("FG1-") ? "E1" : "E0",
          evidence: [governanceEvidenceForId(id)]
        }))
      },
      null,
      2
    )
  );
}

function fgTaskIds(fg: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${fg}-${String(index + 1).padStart(2, "0")}`);
}

function fgExitGateIds(fg: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${fg}-EG${index + 1}`);
}

function governanceEvidenceForId(id: string) {
  if (id.startsWith("FG1-")) return "docs/verification/fg1-local-product-gate.md";
  if (id.startsWith("FG2-")) return "docs/verification/fg2-github-privacy-gate.md";
  if (id.startsWith("FG3-")) return "docs/verification/fg3-developer-review-gate.md";
  if (id.startsWith("FG4-")) return "docs/verification/fg4-organization-runner-gate.md";
  if (id.startsWith("FG5-")) return "docs/verification/fg5-control-plane-gate.md";
  if (id.startsWith("FG6-")) return "docs/verification/fg6-production-gate.md";
  return "docs/verification/fg0-contract-correction-gate.md";
}

async function writeFg1Evidence(root: string) {
  await write(root, "docs/verification/fg1-local-product-gate.md", "# FG1 Verification\n\n## Decision\n\nPASS for FG1-01 through FG1-18 plus FG1-EG1 through FG1-EG6.\n");
}

async function writeFg2Evidence(root: string) {
  await write(root, "docs/verification/fg2-github-privacy-gate.md", "# FG2 Verification\n\n## Decision\n\nPASS for all FG2 tasks and for FG2-EG1 through FG2-EG7.\n");
}

async function writeFg3Evidence(root: string) {
  await write(root, "docs/verification/fg3-developer-review-gate.md", "# FG3 Verification\n\n## Decision\n\nPASS for FG3-01 through FG3-24 and FG3-EG1 through FG3-EG8.\n");
}

async function writeFg4Evidence(root: string) {
  await write(root, "docs/verification/fg4-organization-runner-gate.md", "# FG4 Verification\n\n## Decision\n\nPASS for FG4-01 through FG4-21 and FG4-EG1 through FG4-EG8.\n");
}
