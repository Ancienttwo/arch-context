import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REQUIRED_CODEGRAPH_VERSION } from "@archcontext/local-runtime/codegraph-adapter";

const CLI_ENTRY = resolve(import.meta.dir, "../src/main.ts");

function doctorJson(root: string, stateDir: string, ...extra: string[]): any {
  const result = spawnSync(process.execPath, [CLI_ENTRY, "doctor", "--json", ...extra], {
    cwd: root,
    env: { ...process.env, ARCHCONTEXT_STATE_DIR: stateDir },
    encoding: "utf8",
    timeout: 120_000
  });
  if (result.status !== 0) throw new Error(`doctor failed (${result.status}): ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function expectedOk(data: any): boolean {
  return Boolean(data.hardening.supportedNode && data.permissions.workspace.readable && data.permissions.workspace.writable && data.egress.ok
    && data.daemon.writable !== false);
}

describe("archctx doctor code facts", () => {
  test("doctor --json reports codeFacts without changing ok", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-doctor-code-facts-")));
    const stateDir = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-doctor-code-facts-state-")));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });

      const withoutIndex = doctorJson(root, stateDir).data;
      expect(withoutIndex.codeFacts).toMatchObject({
        schemaVersion: "archcontext.repository-code-facts/v1",
        state: "index-missing",
        indexPresent: false,
        requiredVersion: REQUIRED_CODEGRAPH_VERSION,
        codeGraphVersion: REQUIRED_CODEGRAPH_VERSION,
        issues: []
      });
      expect(withoutIndex.ok).toBe(expectedOk(withoutIndex));

      // An index directory that CodeGraph cannot report on makes code facts not ready or
      // unavailable. It is informational: doctor's own `ok` must not move.
      mkdirSync(join(root, ".codegraph"));
      const brokenIndex = doctorJson(root, stateDir).data;
      expect(["unavailable", "not-ready"]).toContain(brokenIndex.codeFacts.state);
      if (brokenIndex.codeFacts.state === "unavailable") {
        expect(brokenIndex.codeFacts.reasonCode).toBe("codegraph-unavailable");
        expect(typeof brokenIndex.codeFacts.message).toBe("string");
        expect("indexPresent" in brokenIndex.codeFacts).toBe(false);
      } else {
        expect(brokenIndex.codeFacts.indexPresent).toBe(true);
        expect(brokenIndex.codeFacts.issues.length).toBeGreaterThan(0);
      }
      expect(brokenIndex.ok).toBe(withoutIndex.ok);
      expect(brokenIndex.ok).toBe(expectedOk(brokenIndex));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  }, 240_000);
});
