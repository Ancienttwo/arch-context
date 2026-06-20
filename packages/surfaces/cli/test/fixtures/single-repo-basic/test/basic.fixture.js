import assert from "node:assert/strict";
import test from "node:test";

test("fixture greeting", async () => {
  const mod = await import("../src/index.ts");
  assert.equal(mod.greeting({ name: "archcontext" }), "hello archcontext");
});
