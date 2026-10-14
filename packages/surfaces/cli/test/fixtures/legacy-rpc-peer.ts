// Frozen transport guard from the v1 daemon at 5e144af0. This peer has no domain writer.
// It exercises socket/process discovery and SIGTERM upgrade without shipping a v1 alias.
import { createServer } from "node:http";
import { appendFileSync, rmSync } from "node:fs";
import { createPrivateControlFile } from "@archcontext/local-runtime/control-file-security";

const [root, connectionPath, lockPath, requestsPath] = process.argv.slice(2) as [string, string, string, string];
const V1 = "archcontext.runtime-rpc/v1";
const token = "frozen-v1-peer-token";
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const header = request.headers["x-archcontext-rpc-version"];
  appendFileSync(requestsPath, `${JSON.stringify({ route: request.url, header, body })}\n`);
  response.setHeader("Content-Type", "application/json");
  if (header !== undefined && header !== V1) {
    response.writeHead(426);
    response.end(JSON.stringify({ schemaVersion: V1, ok: false, error: "runtime RPC version mismatch", expected: V1, received: header }));
    return;
  }
  if (request.url === "/rpc" && body.schemaVersion !== V1) {
    response.writeHead(400);
    response.end(JSON.stringify({ schemaVersion: V1, ok: false, error: "runtime RPC version mismatch" }));
    return;
  }
  response.writeHead(500);
  response.end(JSON.stringify({ schemaVersion: V1, ok: false, error: "fixture-unexpected-dispatch" }));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
createPrivateControlFile(lockPath, JSON.stringify({ root, pid: process.pid }));
createPrivateControlFile(connectionPath, JSON.stringify({
  schemaVersion: V1, protocol: "http-loopback", version: 1, root,
  url: `http://127.0.0.1:${port}/`, token, pid: process.pid, connectionPath, lockPath,
  startedAt: new Date().toISOString()
}));
process.stdout.write("ready\n");
process.on("SIGTERM", () => {
  rmSync(connectionPath, { force: true });
  rmSync(lockPath, { force: true });
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
