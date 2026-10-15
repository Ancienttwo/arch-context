import { appendFileSync } from "node:fs";
import { productVersionManifest } from "@archcontext/contracts";
import { ArchctxRuntimeRpcServer } from "@archcontext/local-runtime/runtime-daemon";

const [root, mode, signalsPath] = process.argv.slice(2) as [string, string, string];
let running = false;
process.on("SIGTERM", () => {
  appendFileSync(signalsPath, "SIGTERM\n");
  process.exit(0);
});
if (mode === "unrelated") {
  setInterval(() => {}, 1_000);
  process.stdout.write("ready\n");
} else {
  let connection: Awaited<ReturnType<ArchctxRuntimeRpcServer["start"]>>;
  const target = {
    start: async () => { running = true; }, stop: async () => { running = false; },
    status: () => ({ running }), hasActiveBackgroundWork: async () => false,
    compositionReport: () => ({}), egressReport: async () => ({})
  };
  const server = new ArchctxRuntimeRpcServer(target as unknown as ConstructorParameters<typeof ArchctxRuntimeRpcServer>[0], {
    root, idleTimeoutMs: 0, onStop: () => process.exit(0),
    productManifest: () => {
      if (mode === "change-after-health") queueMicrotask(() => { connection.token = "another-instance-token"; });
      const manifest = productVersionManifest();
      return { ...manifest, product: { ...manifest.product, version: "0.0.0" as typeof manifest.product.version } };
    }
  });
  connection = await server.start();
  process.stdout.write("ready\n");
}
