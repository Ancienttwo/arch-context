import assert from "node:assert/strict";
import test from "node:test";

test("fixture page", async () => {
  const mod = await import("../src/page.ts");
  assert.equal(mod.renderPage("archcontext"), "<h1>ARCHCONTEXT</h1>");
});
