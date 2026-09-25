import { expect, test } from "bun:test";
import { ExplorerServerService } from "../src/explorer-server";

test("Explorer accepts only bearer credentials and exposes a data-free browser bootstrap", async () => {
  let now = Date.now();
  const service = new ExplorerServerService({
    assertRunning() {},
    clock: () => new Date(now).toISOString(),
    async explorerProjectionV2() { throw new Error("unexpected projection read"); },
    async explorerProjectionDelta() { throw new Error("unexpected delta read"); }
  });
  try {
    const started = await service.startExplorer("/unused");
    const data = started.data as any;
    const headers = { Authorization: `Bearer ${data.token}` };
    expect((await fetch(`${data.url}health?token=${data.token}`)).status).toBe(401);
    expect((await fetch(`${data.url}health?token=${data.token}`, { headers })).status).toBe(401);
    expect((await fetch(`${data.url}events?token=${data.token}`)).status).toBe(401);
    expect((await fetch(`${data.url}health`, { headers: { Cookie: `token=${data.token}` } })).status).toBe(401);
    expect((await fetch(`${data.url}health`, { headers })).status).toBe(200);
    expect((await fetch(`${data.url}health`, { headers: { ...headers, Origin: "http://evil.test" } })).status).toBe(403);
    expect((await fetch(`${data.url}session`, { method: "POST", headers })).status).toBe(405);
    expect((await fetch(`${data.url}session`, { headers })).status).toBe(404);
    const stream = await fetch(`${data.url}events`, { headers });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    const connect = await fetch(`${data.url}connect`);
    expect(connect.status).toBe(200);
    expect(connect.headers.get("referrer-policy")).toBe("no-referrer");
    expect(connect.headers.get("set-cookie")).toBeNull();
    expect(await connect.text()).not.toContain(data.token);
    expect(new URL(data.browserUrl).search).toBe("");
    expect(new URL(data.browserUrl).hash).toBe(`#token=${data.token}`);
    now += 901_000;
    expect((await fetch(`${data.url}health`, { headers })).status).toBe(401);
    now -= 901_000;
    await service.revokeExplorerToken();
    expect((await reader.read()).done).toBe(true);
    expect((await fetch(`${data.url}health`, { headers })).status).toBe(401);
  } finally {
    await service.closeExplorer();
  }
});
