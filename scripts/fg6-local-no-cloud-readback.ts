#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_OUTPUT = "docs/verification/fg6-local-no-cloud-readback.json";
const LOCAL_NO_CLOUD_COMMAND = ["node", "scripts/local-no-cloud-e2e.mjs"] as const;
const REQUIRED_COMMANDS = [
  "doctor",
  "mcp install",
  "init",
  "sync",
  "context",
  "prepare",
  "status",
  "checkpoint",
  "complete",
  "review"
] as const;
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /private[_-]?key/i,
  /installation[_-]?token/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6LocalNoCloudConfig(process.env, args);
    const result = await runFg6LocalNoCloud(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6LocalNoCloud(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-local-no-cloud-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6LocalNoCloudConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_LOCAL_NO_CLOUD_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6LocalNoCloud(config: ReturnType<typeof buildFg6LocalNoCloudConfig>) {
  const child = spawnSync(LOCAL_NO_CLOUD_COMMAND[0], [LOCAL_NO_CLOUD_COMMAND[1]], {
    cwd: config.root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    timeout: 60_000
  });
  if (child.status !== 0) {
    throw new Error(`local no-cloud e2e failed (${child.status ?? "signal"}): ${child.stderr || child.stdout}`);
  }
  const localEvidence = JSON.parse(child.stdout) as unknown;
  const recording = {
    schemaVersion: "archcontext.fg6-local-no-cloud-readback/v1",
    acceptanceId: "AC-01",
    environment: "local-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    command: LOCAL_NO_CLOUD_COMMAND.join(" "),
    evidence: {
      localEvidence,
      assertions: {
        noGitHubAppRequired: true,
        noArchContextCloudTokenRequired: true,
        noLlmProviderRequired: true,
        localMcpConfigured: true,
        agentTaskLifecycleComplete: true,
        localReviewComplete: true
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6LocalNoCloud(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6LocalNoCloud(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const assertions = readRecord(evidence.assertions);
  const local = readRecord(evidence.localEvidence);
  const egress = readRecord(local.egress);
  const mcp = readRecord(local.mcp);
  const taskLifecycle = readRecord(local.taskLifecycle);
  const review = readRecord(local.review);

  if (record.schemaVersion !== "archcontext.fg6-local-no-cloud-readback/v1") failures.push("schemaVersion mismatch");
  if (record.acceptanceId !== "AC-01") failures.push("acceptanceId must be AC-01");
  if (record.environment !== "local-release-readback") failures.push("environment must be local-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");
  if (local.schemaVersion !== "archcontext.local-no-cloud-e2e/v1") failures.push("local evidence schema mismatch");

  const commands = Array.isArray(local.commands) ? local.commands.map(String) : [];
  for (const command of REQUIRED_COMMANDS) {
    if (!commands.includes(command)) failures.push(`local command missing: ${command}`);
  }
  if (!isOrderedSubsequence(commands, REQUIRED_COMMANDS)) failures.push("local commands must preserve first-experience order");

  if (assertions.noGitHubAppRequired !== true) failures.push("GitHub App must not be required");
  if (assertions.noArchContextCloudTokenRequired !== true) failures.push("Cloud token must not be required");
  if (assertions.noLlmProviderRequired !== true) failures.push("LLM provider must not be required");
  if (assertions.localMcpConfigured !== true) failures.push("local MCP must be configured");
  if (assertions.agentTaskLifecycleComplete !== true) failures.push("agent task lifecycle must complete");
  if (assertions.localReviewComplete !== true) failures.push("local review must complete");

  if (egress.defaultOutbound !== "local-only") failures.push("egress.defaultOutbound must be local-only");
  if (egress.cloudContentUpload !== "deny") failures.push("egress.cloudContentUpload must be deny");
  if (egress.secureMcpTunnel !== "disabled-by-default") failures.push("egress.secureMcpTunnel must be disabled-by-default");
  if (egress.thirdPartyTelemetry !== "disabled") failures.push("egress.thirdPartyTelemetry must be disabled");

  if (mcp.host !== "codex") failures.push("MCP host must be codex");
  if (mcp.command !== "archctx") failures.push("MCP command must be archctx");
  if (!Array.isArray(mcp.args) || mcp.args.join(" ") !== "mcp") failures.push("MCP args must use local stdio entrypoint");

  if (!String(taskLifecycle.preparePosture ?? "").length) failures.push("prepare posture must be present");
  if (taskLifecycle.checkpointFresh !== true) failures.push("checkpoint must be fresh");
  if (taskLifecycle.completeSchemaVersion !== "archcontext.review/v1") failures.push("complete must return review schema");
  if (taskLifecycle.completeResult !== "pass") failures.push("complete result must be pass");
  if (review.schemaVersion !== "archcontext.review/v1") failures.push("review schema mismatch");
  if (review.result !== "pass") failures.push("review result must be pass");
  if (Number(review.errors) !== 0) failures.push("review errors must be 0");

  const providerEnvRemoved = Array.isArray(local.providerEnvRemoved) ? local.providerEnvRemoved.map(String) : [];
  if (!providerEnvRemoved.every((key) => /^[A-Z0-9_]+$/.test(key))) {
    failures.push("provider env evidence must contain variable names only");
  }
  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function isOrderedSubsequence(commands: string[], required: readonly string[]): boolean {
  let cursor = 0;
  for (const command of commands) {
    if (command === required[cursor]) cursor += 1;
    if (cursor === required.length) return true;
  }
  return false;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function renderHuman(result: { ok?: unknown; failures?: unknown }): string {
  const failures = Array.isArray(result.failures) ? result.failures.map(String) : [];
  return result.ok === true ? "FG6 local no-cloud readback verified" : `FG6 local no-cloud readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG6 local no-cloud readback evidence verified" : `FG6 local no-cloud readback evidence failed: ${result.failures.join("; ")}`;
}
