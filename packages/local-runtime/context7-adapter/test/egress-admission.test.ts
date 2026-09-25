import { expect, test } from "bun:test";
import { HttpContext7Transport } from "../src/index";

test("local-only policy refuses Context7 before opening any socket", async () => {
  const previous = process.env.ARCHCONTEXT_EGRESS_MODE;
  process.env.ARCHCONTEXT_EGRESS_MODE = "local-only";
  let calls = 0;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { calls++; return Response.json({ results: [], searchFilterApplied: false }); } });
  try {
    const transport = new HttpContext7Transport(`http://127.0.0.1:${server.port}`);
    await expect(transport.search({ libraryName: "demo", query: "public documentation", fast: true, timeoutMs: 1000 })).rejects.toThrow("egress-denied");
    expect(calls).toBe(0);
  } finally { server.stop(true); if (previous === undefined) delete process.env.ARCHCONTEXT_EGRESS_MODE; else process.env.ARCHCONTEXT_EGRESS_MODE = previous; }
});

test("configured Context7 requests reject redirects before following another destination", async () => {
  const previous = process.env.ARCHCONTEXT_EGRESS_MODE;
  process.env.ARCHCONTEXT_EGRESS_MODE = "configured";
  let redirectedCalls = 0;
  const destination = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { redirectedCalls++; return Response.json({ results: [] }); } });
  const source = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return Response.redirect(`http://127.0.0.1:${destination.port}/unexpected`); } });
  try {
    const transport = new HttpContext7Transport(`http://127.0.0.1:${source.port}`);
    await expect(transport.search({ libraryName: "demo", query: "reference", fast: true, timeoutMs: 1000 })).rejects.toThrow();
    expect(redirectedCalls).toBe(0);
  } finally {
    source.stop(true); destination.stop(true);
    if (previous === undefined) delete process.env.ARCHCONTEXT_EGRESS_MODE;
    else process.env.ARCHCONTEXT_EGRESS_MODE = previous;
  }
});
