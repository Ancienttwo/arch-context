import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEX_SEED_SCHEMA_VERSION } from "@archcontext/contracts";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { runCli } from "../src/main";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("archctx index seed CLI contract (#641)", () => {
  test("index seed --help succeeds without creating .codegraph and invalid arguments fail with AC_SCHEMA_INVALID", async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-cli-index-seed-")));
    roots.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "app.ts"), "export const answer = 42;\n", "utf8");
    initializeArchContextModel(root, "CLI Index Seed Fixture");
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@archcontext.dev", "commit", "-m", "init"], { cwd: root, stdio: "ignore" });

    const help = await runCli("index", ["seed", "--help"], root);
    expect(help.ok).toBe(true);
    expect((help.data as { capability?: string; usage?: string })).toMatchObject({
      capability: "index-seed-v1",
      usage: "archctx index seed [--timeout-ms <ms>] [--json]"
    });
    expect(existsSync(join(root, ".codegraph"))).toBe(false);

    const bogusSubcommand = await runCli("index", ["bogus"], root);
    expect(bogusSubcommand.ok).toBe(false);
    expect((bogusSubcommand as { error?: { code?: string } }).error?.code).toBe("AC_SCHEMA_INVALID");

    const zeroTimeout = await runCli("index", ["seed", "--timeout-ms", "0"], root);
    expect(zeroTimeout.ok).toBe(false);
    expect((zeroTimeout as { error?: { code?: string } }).error?.code).toBe("AC_SCHEMA_INVALID");

    const seeded = await runCli("index", ["seed", "--json"], root);
    expect(seeded.ok, JSON.stringify(seeded)).toBe(true);
    expect(seeded.data).toMatchObject({
      schemaVersion: INDEX_SEED_SCHEMA_VERSION,
      mode: "primary-refresh",
      worktreeRole: "primary",
      seededFromBase: false
    });
  }, 60_000);
});
