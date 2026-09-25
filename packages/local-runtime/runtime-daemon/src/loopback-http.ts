import { type ServerResponse } from "node:http";

export function isLoopbackRemote(remoteAddress = ""): boolean {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
}

export function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}
