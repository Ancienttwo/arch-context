import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { okEnvelope, type ExplorerProjectionV2 } from "@archcontext/contracts";
import { ExplorerServerService } from "../packages/local-runtime/runtime-daemon/src/explorer-server";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Required: ${name}`);
  return process.argv[index + 1]!;
}
const puppeteer = (await import(pathToFileURL(resolve(argument("--puppeteer-module"))).href)).default;
const executablePath = resolve(argument("--browser"));
const fixture = JSON.parse(readFileSync(new URL("../packages/contracts/fixtures/valid/explorer-projection-v2.json", import.meta.url), "utf8")) as ExplorerProjectionV2;
let now = Date.now();
let projectionReads = 0;
const service = new ExplorerServerService({
  assertRunning() {},
  clock: () => new Date(now).toISOString(),
  async explorerProjectionV2(_root, query) {
    projectionReads++;
    return okEnvelope("explorer.projection.v2", { ...fixture, semanticLevel: query.semanticLevel ?? fixture.semanticLevel } as any);
  },
  async explorerProjectionDelta() { throw new Error("unexpected delta read"); }
});
const siblingRequests: Array<{ cookie?: string; authorization?: string; referer?: string }> = [];
const sibling = createServer((request, response) => {
  siblingRequests.push({ cookie: request.headers.cookie, authorization: request.headers.authorization, referer: request.headers.referer });
  response.end("unrelated loopback service");
});
await new Promise<void>((done) => sibling.listen(0, "127.0.0.1", done));
const siblingUrl = `http://127.0.0.1:${(sibling.address() as AddressInfo).port}/`;
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  const first = (await service.startExplorer("/fixture")).data as any;
  const requestUrls: string[] = [];
  page.on("request", (request: any) => requestUrls.push(request.url()));
  const ready = () => page.waitForFunction(() => document.querySelector("#live-status")?.textContent === "live updates connected");
  await page.goto(first.browserUrl);
  await ready();
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(new URL(page.url()).pathname, "/connect");
  assert.equal((await page.cookies()).length, 0);
  assert.equal(requestUrls.some((url) => { const requestUrl = new URL(url); return (requestUrl.pathname + requestUrl.search).includes(first.token); }), false);
  assert.equal(await page.evaluate(() => localStorage.length), 0);

  await Promise.all([page.waitForNavigation(), page.click('[data-level="detail"]')]);
  await ready();
  assert.equal(new URL(page.url()).searchParams.get("level"), "detail");
  await page.reload();
  await ready();
  assert.equal(new URL(page.url()).searchParams.get("level"), "detail");

  const beforeInvalidation = projectionReads;
  service.notifyExplorerInvalidation({ ...fixture, projectionDigest: `sha256:${"f".repeat(64)}` }, []);
  await page.waitForNavigation();
  await ready();
  assert.ok(projectionReads > beforeInvalidation);

  await page.goto(siblingUrl);
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  assert.equal(siblingRequests.some((request) => Boolean(request.cookie || request.authorization || request.referer?.includes(first.token))), false);
  // Return in the same tab: port-scoped session survives reload/navigation without URL credentials.
  await page.goto(`${first.url}connect`);
  await ready();
  await service.revokeExplorerToken();
  await page.waitForFunction(() => document.querySelector("#live-status")?.textContent === "live updates disconnected");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("expired"));
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);

  const second = (await service.startExplorer("/fixture")).data as any;
  await page.goto(second.browserUrl);
  await ready();
  now += 901_000;
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("expired"));
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);
  assert.deepEqual(errors, []);
  const paths = [
    "packages/local-runtime/runtime-daemon/src/explorer-server.ts",
    "packages/local-runtime/runtime-daemon/src/loopback-auth.ts",
    "packages/local-runtime/explorer-html/src/index.ts",
    "scripts/explorer-browser-auth-smoke.ts"
  ];
  const sourceSha256 = createHash("sha256");
  for (const path of paths) sourceSha256.update(path).update("\0").update(readFileSync(new URL(`../${path}`, import.meta.url))).update("\0");
  console.log(JSON.stringify({ status: "PASS", browser: await browser.version(), sourceSha256: sourceSha256.digest("hex"), checks: ["fragment-cleared", "no-cookie", "credential-free-request-urls", "navigation", "reload", "SSE-invalidation", "sibling-port-isolation", "revoke", "expiry"], projectionReads }, null, 2));
} finally {
  await browser.close();
  await service.closeExplorer();
  await new Promise<void>((done) => sibling.close(() => done()));
}
