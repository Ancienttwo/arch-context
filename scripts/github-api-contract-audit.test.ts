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

  test("allows the explicit GitHub privacy denylist declarations", async () => {
    await withAuditFixture(async (root) => {
      await write(root, "packages/cloud/github-app/src/index.ts", `
        export const GITHUB_FORBIDDEN_ACCEPT_MEDIA_TYPES = [
          "application/vnd.github.diff",
          "application/vnd.github.patch"
        ] as const;
        export const GITHUB_FORBIDDEN_API_ENDPOINTS = [
          {
            name: "github.contents",
            method: "GET",
            pathPattern: /^\\/repos\\/[^/]+\\/[^/]+\\/contents(?:\\/[^?#]*)?(?:\\?.*)?$/
          }
        ] as const;
      `);

      await expect(auditGitHubApiContract({ root })).resolves.toMatchObject({
        ok: true,
        findings: []
      });
    });
  });

  test("rejects forbidden GitHub API endpoint literals in production sources", async () => {
    await withAuditFixture(async (root) => {
      await write(root, "packages/cloud/github-app/src/index.ts", `
        export function forbidden(owner: string, repo: string, pullNumber: number) {
          return \`/repos/\${owner}/\${repo}/pulls/\${pullNumber}/files\`;
        }
      `);

      const result = await auditGitHubApiContract({ root });
      expect(result.ok).toBe(false);
      expect(result.findings).toContain("packages/cloud/github-app/src/index.ts references forbidden GitHub API endpoint github.pr-files");
    });
  });

  test("rejects non-allowlisted GitHub API method and endpoint literals", async () => {
    await withAuditFixture(async (root) => {
      await write(root, "packages/cloud/github-app/src/index.ts", `
        export const request = {
          method: "DELETE",
          pathTemplate: "/repositories/{repository_id}/issues"
        };
      `);

      const result = await auditGitHubApiContract({ root });
      expect(result.ok).toBe(false);
      expect(result.findings).toContain("packages/cloud/github-app/src/index.ts references forbidden GitHub API method DELETE");
      expect(result.findings).toContain("packages/cloud/github-app/src/index.ts references non-allowlisted GitHub API endpoint /repositories/{repository_id}/issues");
    });
  });

  test("rejects forbidden GitHub diff and patch media types in production sources", async () => {
    await withAuditFixture(async (root) => {
      await write(root, "packages/cloud/github-app/src/index.ts", `
        export const request = {
          accept: "application/vnd.github+json, application/vnd.github.v3.patch; q=1"
        };
      `);

      const result = await auditGitHubApiContract({ root });
      expect(result.ok).toBe(false);
      expect(result.findings).toContain("packages/cloud/github-app/src/index.ts references forbidden GitHub API media type application/vnd.github.v3.patch");
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
