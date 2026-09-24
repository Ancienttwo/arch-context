import { describe, expect, test } from "bun:test";
import type { CommandInvestigationRunnerTransportInput } from "@archcontext/core/agent-orchestrator";
import { createNodeInvestigationTransport, investigationChildEnv } from "../src/investigation-transport";

/**
 * `createNodeInvestigationTransport` spawns a real child process (no shell), so these tests spawn
 * the current runtime (`process.execPath -e "<script>"`) as a deterministic stand-in for `claude
 * --print --output-format json` instead of mocking `node:child_process` — the same approach the
 * transport itself takes with the real CLI, just with a script we control instead of a live model.
 */
function baseInput(overrides: Partial<CommandInvestigationRunnerTransportInput> = {}): CommandInvestigationRunnerTransportInput {
  return {
    runnerPort: "claude-code",
    runnerId: "runner.claude-code",
    command: process.execPath,
    args: [],
    stdin: "{}",
    ...overrides
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error & { reasonCode?: string; shape?: unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { reasonCode?: string; shape?: unknown };
  }
  throw new Error("expected the promise to reject");
}

describe("createNodeInvestigationTransport / unwrapClaudeCodeEnvelope classification", () => {
  test("classifies a process exit that never printed valid JSON as transport-envelope-not-json", async () => {
    const transport = createNodeInvestigationTransport();
    const result = await transport(baseInput({
      args: ["-e", "process.stdout.write('not json at all'); process.exit(0);"]
    }));
    expect(result.exitCode).toBe(1);
    expect(result.reasonCode).toBe("transport-envelope-not-json");
    expect(result.shape).toMatchObject({
      schemaVersion: "archcontext.investigation-failure-shape/v1",
      stdoutLength: Buffer.byteLength("not json at all", "utf8")
    });
    expect(JSON.stringify(result)).not.toContain("diff --git");
  });

  test("classifies valid JSON that is not an envelope object (e.g. an array) as transport-envelope-not-json", async () => {
    const transport = createNodeInvestigationTransport();
    const result = await transport(baseInput({
      args: ["-e", "process.stdout.write(JSON.stringify([1,2,3])); process.exit(0);"]
    }));
    expect(result.exitCode).toBe(1);
    expect(result.reasonCode).toBe("transport-envelope-not-json");
  });

  test("classifies an is_error envelope as transport-envelope-is-error and records result shape, not content", async () => {
    const transport = createNodeInvestigationTransport();
    const result = await transport(baseInput({
      args: ["-e", "process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'refused' })); process.exit(0);"]
    }));
    expect(result.exitCode).toBe(1);
    expect(result.reasonCode).toBe("transport-envelope-is-error");
    expect(result.shape).toMatchObject({
      resultLength: Buffer.byteLength("refused", "utf8"),
      resultHeadChar: "r",
      resultTailChar: "d",
      resultFenced: false
    });
    expect(result.stdout).toBe("refused");
  });

  test("classifies a non-string envelope.result as transport-result-not-string", async () => {
    const transport = createNodeInvestigationTransport();
    const result = await transport(baseInput({
      args: ["-e", "process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 42 })); process.exit(0);"]
    }));
    expect(result.exitCode).toBe(1);
    expect(result.reasonCode).toBe("transport-result-not-string");
    expect(result.shape).toMatchObject({ stdoutLength: expect.any(Number) });
    expect(result.shape?.resultLength).toBeUndefined();
  });

  test("classifies a markdown-fenced non-JSON result as transport-result-not-json with the fence heuristic set", async () => {
    const transport = createNodeInvestigationTransport();
    const fenced = "```json\n{not really json\n```";
    const script = `process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: ${JSON.stringify(fenced)} })); process.exit(0);`;
    const result = await transport(baseInput({ args: ["-e", script] }));
    expect(result.exitCode).toBe(1);
    expect(result.reasonCode).toBe("transport-result-not-json");
    expect(result.shape).toMatchObject({
      resultLength: Buffer.byteLength(fenced, "utf8"),
      resultHeadChar: "`",
      resultFenced: true
    });
  });

  test("classifies a non-fenced non-JSON result with resultFenced: false (distinguishing truncation from fencing)", async () => {
    const transport = createNodeInvestigationTransport();
    const truncated = '{"schemaVersion":"archcontext.investigation-report/v1","reportId":"invest';
    const script = `process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: ${JSON.stringify(truncated)} })); process.exit(0);`;
    const result = await transport(baseInput({ args: ["-e", script] }));
    expect(result.exitCode).toBe(1);
    expect(result.reasonCode).toBe("transport-result-not-json");
    expect(result.shape).toMatchObject({
      resultLength: Buffer.byteLength(truncated, "utf8"),
      resultHeadChar: "{",
      resultTailChar: "t",
      resultFenced: false
    });
  });

  test("classifies a non-zero process exit as transport-process-exit-nonzero", async () => {
    const transport = createNodeInvestigationTransport();
    const result = await transport(baseInput({
      args: ["-e", "process.stdout.write('partial output'); process.exit(3);"]
    }));
    expect(result.exitCode).toBe(3);
    expect(result.reasonCode).toBe("transport-process-exit-nonzero");
    expect(result.shape).toMatchObject({ stdoutLength: Buffer.byteLength("partial output", "utf8") });
  });

  test("rejects with a classified failure (not a generic Error) when the streamed envelope exceeds maxOutputBytes", async () => {
    const transport = createNodeInvestigationTransport();
    const big = "x".repeat(64);
    const error = await rejectionOf(transport(baseInput({
      args: ["-e", `process.stdout.write(${JSON.stringify(big)}); setTimeout(() => process.exit(0), 200);`],
      maxOutputBytes: 8
    })));
    expect(error.message).toBe("agent-investigation-output-too-large");
    expect(error.reasonCode).toBe("transport-output-too-large");
    expect(error.shape).toMatchObject({ stdoutLength: expect.any(Number) });
  });

  test("resolves successfully (no reasonCode/shape) when the envelope wraps a valid report", async () => {
    const transport = createNodeInvestigationTransport();
    const report = { schemaVersion: "archcontext.investigation-report/v1", ok: true };
    const script = `process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(${JSON.stringify(report)}) })); process.exit(0);`;
    const result = await transport(baseInput({ args: ["-e", script] }));
    expect(result.exitCode).toBe(0);
    expect(result.reasonCode).toBeUndefined();
    expect(result.shape).toBeUndefined();
    expect(JSON.parse(result.stdout)).toEqual({ report });
  });
});

/**
 * Issue #161: the investigation child is the process an audited repository can prompt-inject, so
 * it must not inherit the daemon's GitHub publish PAT or any other unrelated credential.
 */
describe("createNodeInvestigationTransport child environment allowlist", () => {
  const injected: Record<string, string> = {
    ARCHCONTEXT_GH_ISSUES_TOKEN: "github_pat_should_never_reach_the_investigator",
    GH_TOKEN: "ghp_should_never_reach_the_investigator",
    GITHUB_TOKEN: "ghs_should_never_reach_the_investigator",
    ARCHCONTEXT_DAEMON_CONTROL_TOKEN: "daemon-control-token",
    SOME_SERVICE_SECRET: "unrelated-secret",
    AWS_SECRET_ACCESS_KEY: "aws-secret-without-bedrock",
    ANTHROPIC_API_KEY: "sk-ant-model-provider-auth",
    CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-model-provider-auth",
    CLAUDE_CONFIG_DIR: "/tmp/claude-config"
  };

  async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]] as const));
    Object.assign(process.env, values);
    try {
      return await fn();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  test("the spawned investigation process does not see ARCHCONTEXT_GH_ISSUES_TOKEN or GH_TOKEN", async () => {
    // The child reports its own environment through the normal envelope path.
    const script =
      "process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ env: process.env }) })); process.exit(0);";
    const result = await withEnv(injected, () => createNodeInvestigationTransport()(baseInput({ args: ["-e", script] })));
    expect(result.exitCode).toBe(0);
    const childEnv = JSON.parse(result.stdout).report.env as Record<string, string>;
    expect(childEnv.ARCHCONTEXT_GH_ISSUES_TOKEN).toBeUndefined();
    expect(childEnv.GH_TOKEN).toBeUndefined();
    expect(childEnv.GITHUB_TOKEN).toBeUndefined();
    expect(childEnv.ARCHCONTEXT_DAEMON_CONTROL_TOKEN).toBeUndefined();
    expect(childEnv.SOME_SERVICE_SECRET).toBeUndefined();
    expect(childEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    // Model-provider auth for the `claude` runner is still forwarded.
    expect(childEnv.ANTHROPIC_API_KEY).toBe(injected.ANTHROPIC_API_KEY);
    expect(childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe(injected.CLAUDE_CODE_OAUTH_TOKEN);
    expect(childEnv.CLAUDE_CONFIG_DIR).toBe(injected.CLAUDE_CONFIG_DIR);
    expect(childEnv.PATH).toBe(process.env.PATH ?? "");
  });

  test("forwards no *TOKEN*/*SECRET* variable except model-provider auth", () => {
    const env = investigationChildEnv({ ...injected, PATH: "/usr/bin", HOME: "/home/u", NPM_TOKEN: "npm", DATABASE_URL: "postgres://x" });
    const credentialShaped = Object.keys(env).filter((key) => /TOKEN|SECRET|KEY/.test(key)).sort();
    expect(credentialShaped).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
  });

  test("forwards cloud credentials only when the runner is configured for that model provider", () => {
    const aws = { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "secret", AWS_REGION: "us-east-1" };
    expect(investigationChildEnv(aws).AWS_SECRET_ACCESS_KEY).toBeUndefined();
    const bedrock = investigationChildEnv({ ...aws, CLAUDE_CODE_USE_BEDROCK: "1" });
    expect(bedrock).toMatchObject({ ...aws, CLAUDE_CODE_USE_BEDROCK: "1" });
    expect(investigationChildEnv({ ...aws, CLAUDE_CODE_USE_BEDROCK: "0" }).AWS_SECRET_ACCESS_KEY).toBeUndefined();
    const vertex = investigationChildEnv({ GOOGLE_APPLICATION_CREDENTIALS: "/k.json", CLAUDE_CODE_USE_VERTEX: "1" });
    expect(vertex.GOOGLE_APPLICATION_CREDENTIALS).toBe("/k.json");
    expect(investigationChildEnv({ GOOGLE_APPLICATION_CREDENTIALS: "/k.json" }).GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  });
});
