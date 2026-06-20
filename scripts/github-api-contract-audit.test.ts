import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditGitHubApiContract } from "./github-api-contract-audit.mjs";

describe("github-api-contract-audit", () => {
  test("accepts the typed GitHub governance port boundary", async () => {
    await withAuditFixture(async (root) => {
      await write(root, "packages/cloud/github-app/src/index.ts", `
        import type { GitHubGovernancePort } from "@archcontext/contracts";
        export class GovernanceService {
          constructor(private readonly port: GitHubGovernancePort) {}
          run() {
            return this.port;
          }
        }
      `);

      await expect(auditGitHubApiContract({ root })).resolves.toMatchObject({
        ok: true,
        findings: []
      });
    });
  });

  test("rejects generic Octokit imports in production sources", async () => {
    await withAuditFixture(async (root) => {
      await write(root, "packages/cloud/control-plane/src/index.ts", `
        import { Octokit } from "@octokit/rest";
        export function createClient(client: Octokit) {
          return client;
        }
      `);

      const result = await auditGitHubApiContract({ root });
      expect(result.ok).toBe(false);
      expect(result.findings.join("\n")).toContain("imports generic Octokit specifier @octokit/rest");
      expect(result.findings.join("\n")).toContain("references generic GitHub client identifier Octokit");
    });
  });

  test("rejects generic GitHub client injection without an Octokit import", async () => {
    await withAuditFixture(async (root) => {
      await write(root, "packages/cloud/github-app/src/index.ts", `
        export class GovernanceService {
          constructor(private readonly githubClient: unknown) {}
        }
      `);

      const result = await auditGitHubApiContract({ root });
      expect(result.ok).toBe(false);
      expect(result.findings).toContain("packages/cloud/github-app/src/index.ts references generic GitHub client identifier githubClient");
    });
  });
});

async function withAuditFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "archctx-github-api-contract-audit-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function write(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${content.trim()}\n`, "utf8");
}
