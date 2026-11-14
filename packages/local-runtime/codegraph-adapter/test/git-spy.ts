import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * The git commands ADR-0058 Decision 3 allows a code-facts read: archctx's Git-visible file list and
 * the provider's file enumeration. None reads content through a filter or writes the index.
 */
const CODE_FACTS_READ_GIT_VERBS: ReadonlySet<string> = new Set(["ls-files", "rev-parse", "check-ignore"]);
const CODE_FACTS_READ_GIT_CONFIG = "config --get core.excludesFile";

/** The logged subcommands outside Decision 3, and outside `verbs` the command itself runs (such as `cat-file`). */
export function gitCommandsOutsideCodeFactsRead(subcommands: readonly string[], verbs: readonly string[] = []): string[] {
  return subcommands.filter((command) => command !== CODE_FACTS_READ_GIT_CONFIG
    && !CODE_FACTS_READ_GIT_VERBS.has(command.split(" ")[0]!) && !verbs.includes(command.split(" ")[0]!));
}

/**
 * A `git` first on `PATH` that logs each invocation and runs the real one. POSIX only. Pass `env` to
 * a child process; `subcommands()` drops global options (`-C <dir>`, `-c <key=value>`, `--no-pager`).
 */
export function gitSpy(): { env: NodeJS.ProcessEnv; subcommands(): string[]; restore(): void } {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-git-spy-")));
  const log = join(dir, "git.log");
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(log, "");
  writeFileSync(join(dir, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  return {
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ""}` },
    subcommands: () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => {
      const words = line.split(" ");
      let index = 0;
      while (index < words.length && words[index]!.startsWith("-")) index += ["-C", "-c"].includes(words[index]!) ? 2 : 1;
      return words.slice(index).join(" ");
    }),
    restore: () => rmSync(dir, { recursive: true, force: true })
  };
}
