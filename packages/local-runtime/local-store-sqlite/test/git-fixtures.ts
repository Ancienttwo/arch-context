import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createCommittedGitRepo(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  git(root, "init");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
}

export function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}
