import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withNpmPublishCredentials } from "./npm-publish-credentials-lib.mjs";

const FAKE_TOKEN = "npm_fakeTokenValue1234567890abcdef";

type NpmEnv = Record<string, string | undefined>;

describe("withNpmPublishCredentials", () => {
  test("writes a 0600 npmrc from an env-file token and removes it after the callback resolves", async () => {
    await withEnvFile({ NPM_TOKEN: FAKE_TOKEN }, async (envFilePath) => {
      let npmrcDir = "";
      const result = await withNpmPublishCredentials(
        envFilePath,
        (env: NpmEnv) => {
          expect(env.NPM_CONFIG_USERCONFIG).toBeTruthy();
          const npmrcPath = env.NPM_CONFIG_USERCONFIG as string;
          npmrcDir = dirname(npmrcPath);
          expect(existsSync(npmrcPath)).toBe(true);
          const mode = statSync(npmrcPath).mode & 0o777;
          expect(mode).toBe(0o600);
          const contents = readFileSync(npmrcPath, "utf8");
          expect(contents).toContain(`_authToken=${FAKE_TOKEN}`);
          expect(contents).toContain("registry=https://registry.example.test/");
          return "callback-ok";
        },
        { registry: "https://registry.example.test/", baseEnv: {} }
      );
      expect(result).toBe("callback-ok");
      expect(npmrcDir).not.toBe("");
      expect(existsSync(npmrcDir)).toBe(false);
    });
  });

  test("removes the npmrc temp dir even when the callback throws", async () => {
    await withEnvFile({ NPM_TOKEN: FAKE_TOKEN }, async (envFilePath) => {
      let npmrcDir = "";
      await expect(
        withNpmPublishCredentials(
          envFilePath,
          (env: NpmEnv) => {
            npmrcDir = dirname(env.NPM_CONFIG_USERCONFIG as string);
            expect(existsSync(npmrcDir)).toBe(true);
            throw new Error("callback exploded");
          },
          { baseEnv: {} }
        )
      ).rejects.toThrow("callback exploded");
      expect(npmrcDir).not.toBe("");
      expect(existsSync(npmrcDir)).toBe(false);
    });
  });

  test("masks the raw token value in a rethrown error's message and stack", async () => {
    await withEnvFile({ NPM_TOKEN: FAKE_TOKEN }, async (envFilePath) => {
      try {
        await withNpmPublishCredentials(
          envFilePath,
          () => {
            throw new Error(`npm publish failed: //registry.npmjs.org/:_authToken=${FAKE_TOKEN}`);
          },
          { baseEnv: {} }
        );
        throw new Error("expected withNpmPublishCredentials to reject");
      } catch (error) {
        const err = error as Error;
        expect(err.message).not.toContain(FAKE_TOKEN);
        expect(err.message).toContain("[REDACTED]");
        if (typeof err.stack === "string") {
          expect(err.stack).not.toContain(FAKE_TOKEN);
        }
      }
    });
  });

  test("creates no npmrc temp dir and passes the plain env through when no token is available", async () => {
    await withEnvFile({ NPM_TOKEN: "", CI_TOKEN: "" }, async (envFilePath) => {
      const before = listNpmrcTempDirs();
      const result = await withNpmPublishCredentials(
        envFilePath,
        (env: NpmEnv) => {
          expect(env.NPM_CONFIG_USERCONFIG).toBeUndefined();
          return "no-token-ok";
        },
        { baseEnv: {} }
      );
      expect(result).toBe("no-token-ok");
      expect(listNpmrcTempDirs()).toEqual(before);
    });
  });

  test("respects a pre-existing NPM_CONFIG_USERCONFIG and skips creating a new npmrc", async () => {
    await withEnvFile({ NPM_TOKEN: FAKE_TOKEN }, async (envFilePath) => {
      const before = listNpmrcTempDirs();
      const result = await withNpmPublishCredentials(
        envFilePath,
        (env: NpmEnv) => {
          expect(env.NPM_CONFIG_USERCONFIG).toBe("/already/configured/npmrc");
          return "passthrough-ok";
        },
        { baseEnv: { NPM_CONFIG_USERCONFIG: "/already/configured/npmrc" } }
      );
      expect(result).toBe("passthrough-ok");
      expect(listNpmrcTempDirs()).toEqual(before);
    });
  });

  test("falls back to baseEnv NODE_AUTH_TOKEN/NPM_TOKEN when no envFilePath is given", async () => {
    let npmrcDir = "";
    const result = await withNpmPublishCredentials(
      null,
      (env: NpmEnv) => {
        npmrcDir = dirname(env.NPM_CONFIG_USERCONFIG as string);
        const contents = readFileSync(env.NPM_CONFIG_USERCONFIG as string, "utf8");
        expect(contents).toContain(`_authToken=${FAKE_TOKEN}`);
        return "env-fallback-ok";
      },
      { baseEnv: { NPM_TOKEN: FAKE_TOKEN } }
    );
    expect(result).toBe("env-fallback-ok");
    expect(existsSync(npmrcDir)).toBe(false);
  });

  test("baseEnv token takes priority over an env-file token", async () => {
    await withEnvFile({ NPM_TOKEN: "file-token-should-not-be-used" }, async (envFilePath) => {
      await withNpmPublishCredentials(
        envFilePath,
        (env: NpmEnv) => {
          const contents = readFileSync(env.NPM_CONFIG_USERCONFIG as string, "utf8");
          expect(contents).toContain(`_authToken=${FAKE_TOKEN}`);
          expect(contents).not.toContain("file-token-should-not-be-used");
        },
        { baseEnv: { NPM_TOKEN: FAKE_TOKEN } }
      );
    });
  });
});

async function withEnvFile(vars: Record<string, string>, run: (envFilePath: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "archctx-npm-publish-lib-test."));
  try {
    const envFilePath = join(root, "npm.env");
    const lines = Object.entries(vars).map(([key, value]) => `${key}=${value}`);
    writeFileSync(envFilePath, `${lines.join("\n")}\n`, "utf8");
    await run(envFilePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function listNpmrcTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("archctx-npm-publish-npmrc."));
}
