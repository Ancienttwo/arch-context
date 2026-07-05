import { describe, expect, test } from "bun:test";
import type { CommandInvestigationRunnerTransportInput } from "@archcontext/core/agent-orchestrator";
import { createNodeInvestigationTransport } from "../src/investigation-transport";

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
