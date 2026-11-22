import { afterEach, expect, test } from "bun:test";
import { LOCAL_EGRESS_CHANNELS, localEgressAdmission, localEgressMode, withLocalEgress } from "../../egress-admission/src/index";
import { localEgressStatus } from "../src/egress";
import { Context7ExternalDocumentationAdapter } from "../../context7-adapter/src/index";
import { disableCodeGraphTelemetryByDefault } from "../../codegraph-adapter/src/index";
import { runCli } from "../../../surfaces/cli/src/main";

const previous = process.env.ARCHCONTEXT_EGRESS_MODE;
afterEach(() => { if (previous === undefined) delete process.env.ARCHCONTEXT_EGRESS_MODE; else process.env.ARCHCONTEXT_EGRESS_MODE = previous; });

test("all known channels use one deny authority; invalid mode/channel never executes callbacks", () => {
  for (const channel of LOCAL_EGRESS_CHANNELS) {
    let calls = 0;
    expect(withLocalEgress(channel, () => ++calls, {})).toBe(1);
    expect(withLocalEgress(channel, () => ++calls, { ARCHCONTEXT_EGRESS_MODE: "configured" })).toBe(2);
    for (const mode of ["local-only", "invalid", "", "LOCAL-ONLY"]) expect(() => withLocalEgress(channel, () => ++calls, { ARCHCONTEXT_EGRESS_MODE: mode })).toThrow();
    expect(calls).toBe(2);
    expect(localEgressAdmission(channel, { ARCHCONTEXT_EGRESS_MODE: "local-only" })).toMatchObject({ allowed: false, mode: "local-only", reason: "local-only-policy" });
  }
  expect(localEgressMode({})).toBe("configured");
  expect(() => withLocalEgress("unknown" as any, () => { throw new Error("executed"); }, {})).toThrow("egress-channel-invalid");
});

test("enabled Context7 adapters cannot override local-only or invoke injected transports", async () => {
  process.env.ARCHCONTEXT_EGRESS_MODE = "local-only"; let calls = 0;
  const adapter = new Context7ExternalDocumentationAdapter({ enabled: true, transport: { async search() { calls++; return { results: [], searchFilterApplied: false }; }, async getContext() { calls++; return []; } } });
  await expect(adapter.resolve({ provider: "context7", libraryName: "demo", query: "reference docs", fast: true })).rejects.toThrow("egress-denied");
  await expect(adapter.fetch({ provider: "context7", libraryId: "/demo/docs", version: "1.0.0", intent: "routing reference" })).rejects.toThrow("egress-denied");
  expect(calls).toBe(0);
});

test("CLI npm lookup denies explicit requests under local-only and invalid policy", async () => {
  const originalVersion = process.env.ARCHCONTEXT_LATEST_VERSION;
  delete process.env.ARCHCONTEXT_LATEST_VERSION;
  try {
    for (const mode of ["local-only", "invalid"]) {
      process.env.ARCHCONTEXT_EGRESS_MODE = mode;
      const result = await runCli("update", ["--check"]);
      expect(result).toMatchObject({ ok: false, error: { code: "AC_POLICY_VIOLATION" } });
      expect((result as any).error.message).toContain("egress-");
    }
  } finally { if (originalVersion === undefined) delete process.env.ARCHCONTEXT_LATEST_VERSION; else process.env.ARCHCONTEXT_LATEST_VERSION = originalVersion; }
});

test("report shows policy denial for enabled features, CLI npm intent and telemetry", () => {
  const env = { ARCHCONTEXT_EGRESS_MODE: "local-only", ARCHCONTEXT_CONTEXT7_ENABLED: "1", DO_NOT_TRACK: "0" };
  const live = { updateCheckRequested: true, projectionPublishRequested: true };
  const blocked = localEgressStatus(env, live);
  expect(blocked).toMatchObject({ policyMode: "local-only", enforcement: "application-admission", effectiveOutbound: "local-only" });
  expect(blocked.nonLocalEgress.map(c => c.channel).sort()).toEqual([...LOCAL_EGRESS_CHANNELS].sort());
  expect(blocked.nonLocalEgress.every(c => c.status === "blocked-by-policy")).toBe(true);
  const enabled = localEgressStatus({ ...env, ARCHCONTEXT_EGRESS_MODE: "configured" }, live);
  expect(enabled.effectiveOutbound).toBe("non-local");
  expect(enabled.nonLocalEgress.every(c => c.status === "enabled")).toBe(true);
  expect(localEgressStatus({ DO_NOT_TRACK: "0" }).effectiveOutbound).toBe("non-local");
  const deniedEnv = { ARCHCONTEXT_EGRESS_MODE: "local-only", DO_NOT_TRACK: "0" };
  expect(() => disableCodeGraphTelemetryByDefault(deniedEnv)).toThrow("egress-denied: codegraph-telemetry");
  expect(deniedEnv.DO_NOT_TRACK).toBe("0");
});
