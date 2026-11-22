import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPathHiddenBySparseCheckout,
  listSkippedWorktreePaths,
  readGitCoChangeHistory,
  readSkippedWorktreeBlobs
} from "../src/index";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function initRepo(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-cochange-")));
  git(root, "init", "-q");
  git(root, "config", "user.name", "CoChange Test");
  git(root, "config", "user.email", "cochange@example.test");
  return root;
}

describe("git co-change & sparse decision reader", () => {
  test("reads bounded co-change window and filters bulk commits", () => {
    const root = initRepo();
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      for (let i = 1; i <= 5; i += 1) {
        writeFileSync(join(root, "src/a.ts"), `export const a = ${i};\n`);
        writeFileSync(join(root, "src/b.ts"), `export const b = ${i};\n`);
        git(root, "add", "src/a.ts", "src/b.ts");
        git(root, "commit", "-qm", `pair-${i}`);
      }
      for (let i = 1; i <= 4; i += 1) {
        writeFileSync(join(root, `src/bulk-${i}.ts`), `export const x${i} = ${i};\n`);
      }
      git(root, "add", ".");
      git(root, "commit", "-qm", "bulk-4");

      const history = readGitCoChangeHistory(root, {
        windowLimit: 50,
        maxFilesPerCommit: 3,
        minHistoryCommits: 5
      });
      expect(history.coverageStatus).toBe("complete");
      expect(history.observedCommitCount).toBe(6);
      expect(history.skippedBulkCommitCount).toBe(1);
      expect(history.commits).toHaveLength(5);
      expect(history.commits[0]?.paths).toEqual(["src/a.ts", "src/b.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("marks sparse/insufficient commit counts and shallow clones safely without remote fetches", () => {
    const origin = initRepo();
    const shallow = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-shallow-")));
    try {
      mkdirSync(join(origin, "src"), { recursive: true });
      for (let i = 1; i <= 3; i += 1) {
        writeFileSync(join(origin, "src/a.ts"), `export const a = ${i};\n`);
        git(origin, "add", "src/a.ts");
        git(origin, "commit", "-qm", `c-${i}`);
      }

      const insufficient = readGitCoChangeHistory(origin, { minHistoryCommits: 5 });
      expect(insufficient.coverageStatus).toBe("insufficient-history");
      expect(insufficient.observedCommitCount).toBe(3);

      execFileSync("git", ["clone", "--depth=1", `file://${origin}`, shallow], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      const shallowHistory = readGitCoChangeHistory(shallow);
      expect(shallowHistory.coverageStatus).toBe("shallow");
      expect(shallowHistory.commits).toEqual([]);
    } finally {
      rmSync(origin, { recursive: true, force: true });
      rmSync(shallow, { recursive: true, force: true });
    }
  });

  test("reads skip-worktree blobs under sparse checkout without touching the worktree", () => {
    const root = initRepo();
    try {
      mkdirSync(join(root, ".archcontext/refactor-decisions"), { recursive: true });
      mkdirSync(join(root, "packages/app/src"), { recursive: true });
      const decisionPath = ".archcontext/refactor-decisions/recommendation.0123456789abcdef.json";
      const decisionBody = '{"recommendationId":"recommendation.0123456789abcdef"}\n';
      writeFileSync(join(root, decisionPath), decisionBody);
      writeFileSync(join(root, "packages/app/src/index.ts"), "export const ok = true;\n");
      git(root, "add", ".");
      git(root, "commit", "-qm", "init sparse fixture");

      git(root, "sparse-checkout", "init", "--cone");
      git(root, "sparse-checkout", "set", "packages/app");

      expect(listSkippedWorktreePaths(root, ".archcontext/refactor-decisions")).toEqual([decisionPath]);
      expect(isPathHiddenBySparseCheckout(root, decisionPath)).toBe(true);
      expect(isPathHiddenBySparseCheckout(root, ".archcontext/refactor-decisions/recommendation.fedcba9876543210.json")).toBe(true);
      expect(isPathHiddenBySparseCheckout(root, "packages/app/src/index.ts")).toBe(false);

      const blobs = readSkippedWorktreeBlobs(root, ".archcontext/refactor-decisions");
      expect(blobs.get(decisionPath)).toBe(decisionBody);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
