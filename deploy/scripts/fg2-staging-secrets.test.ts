import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("staging secret installer validates separation before an installation and never prints values", () => {
  const root = mkdtempSync(join(tmpdir(), "archctx-staging-secrets-"));
  const envFile = join(root, "fixture.env");
  const webhook = "fixture-webhook-secret";
  const readback = "fixture-readback-secret";
  const base = `GITHUB_APP_ID=123\nGITHUB_APP_PRIVATE_KEY_PEM_PATH=unused-fixture.pem\nGITHUB_WEBHOOK_SECRET=${webhook}\n`;
  const run = () => execFileSync("node", [fileURLToPath(new URL("./fg2-staging-secrets.mjs", import.meta.url)), "install", "--env-file", envFile, "--dry-run"], { encoding: "utf8", stdio: "pipe" });
  try {
    writeFileSync(envFile, base);
    expect(run).toThrow("missing required env key: ARCHCONTEXT_READBACK_SECRET");
    writeFileSync(envFile, `${base}ARCHCONTEXT_READBACK_SECRET=${webhook}\n`);
    expect(run).toThrow("readback key must be independent");
    writeFileSync(envFile, `${base}ARCHCONTEXT_READBACK_SECRET=${readback}\n`);
    const output = run();
    expect(output).toContain("would install ARCHCONTEXT_READBACK_SECRET");
    expect(output).not.toContain(webhook);
    expect(output).not.toContain(readback);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
