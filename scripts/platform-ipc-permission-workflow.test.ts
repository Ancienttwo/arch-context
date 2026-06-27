import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const WORKFLOW = readFileSync(".github/workflows/verify.yml", "utf8");
const READBACK_SCRIPT = readFileSync("scripts/platform-ipc-permission-readback.mjs", "utf8");

describe("platform IPC permission workflow", () => {
  test("runs verify and uploads IPC permission readback for all supported OS targets", () => {
    for (const os of ["ubuntu-latest", "macos-15", "windows-latest"]) {
      expect(WORKFLOW).toContain(os);
    }
    for (const nodeVersion of ["24.x", "25.x"]) {
      expect(WORKFLOW).toContain(nodeVersion);
    }

    expect(WORKFLOW).toContain("bun run verify");
    expect(WORKFLOW).toContain("node scripts/platform-ipc-permission-readback.mjs > platform-ipc-permission-readback.json");
    expect(WORKFLOW).toContain("actions/upload-artifact@v6");
    expect(WORKFLOW).toContain("platform-ipc-permission-${{ matrix.os }}-node-${{ matrix.node-version }}");
  });

  test("IPC readback uses the installed archctx bin instead of the source entrypoint", () => {
    expect(READBACK_SCRIPT).toContain("resolveInstalledArchctxCommand");
    expect(READBACK_SCRIPT).toContain("node_modules");
    expect(READBACK_SCRIPT).toContain(".bin");
    expect(READBACK_SCRIPT).toContain("helpOk");
    expect(READBACK_SCRIPT).not.toContain("packages/surfaces/cli/src/main.ts");
  });
});
