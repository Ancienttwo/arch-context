import { createInterface } from "node:readline";
import { runStdioMcpLoop } from "../../src/index";
import type { RuntimeDaemonClient } from "@archcontext/local-runtime/runtime-daemon";

await runStdioMcpLoop(createInterface({ input: process.stdin }), (line) => process.stdout.write(`${line}\n`), undefined, {
  runtime: {
    applyUpdate: async () => ({ ok: false, requestId: "apply_update", error: { code: "AC_USER_CONFIRMATION_REQUIRED", message: "Not approved" } }),
    practices: async () => ({ ok: true, requestId: "practices", data: { practices: [] } })
  } as unknown as RuntimeDaemonClient
});
