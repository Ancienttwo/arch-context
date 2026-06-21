#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_REPOSITORY = "Ancienttwo/arch-context";
const DEFAULT_OUTPUT = "docs/verification/fg4-self-hosted-runner-readback.json";
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /registration[_-]?token\s*[:=]\s*[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg4SelfHostedRunnerReadbackConfig(args);
    const record = await runFg4SelfHostedRunnerReadback(config);
    const inspection = inspectFg4SelfHostedRunnerReadback(record);
    process.stdout.write(`${config.json ? JSON.stringify(record, null, 2) : renderHuman(record, inspection)}\n`);
    if (!inspection.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const record = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const inspection = inspectFg4SelfHostedRunnerReadback(record);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(inspection, null, 2) : renderInspectHuman(inspection)}\n`);
    if (!inspection.ok) process.exit(1);
  } else {
    console.error("[fg4-self-hosted-runner-readback] usage: run|inspect [--repo owner/name] [--out path] [--evidence path] [--json]");
    process.exit(2);
  }
}

export function buildFg4SelfHostedRunnerReadbackConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    repository: readFlag(args, "--repo") ?? DEFAULT_REPOSITORY,
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg4SelfHostedRunnerReadback(config: ReturnType<typeof buildFg4SelfHostedRunnerReadbackConfig>) {
  const [owner, repo] = config.repository.split("/");
  if (!owner || !repo) throw new Error(`invalid repository: ${config.repository}`);
  const repoView = ghJson(["repo", "view", config.repository, "--json", "owner,name,isPrivate,viewerPermission"]);
  const user = ghJson(["api", "user"]);
  const orgs = ghJson(["api", "user/orgs"]);
  const runners = ghJson(["api", `repos/${owner}/${repo}/actions/runners`]);
  const runnerItems = Array.isArray(readRecord(runners).runners) ? readRecord(runners).runners as unknown[] : [];
  const totalCount = Number(readRecord(runners).total_count ?? runnerItems.length);
  const record = {
    schemaVersion: "archcontext.fg4-self-hosted-runner-readback/v1",
    environment: "staging",
    status: totalCount === 0 ? "blocked" : "runner-available-but-unverified",
    ok: false,
    generatedAt: config.now(),
    repository: {
      fullName: config.repository,
      visibility: readRecord(repoView).isPrivate === true ? "private" : "public",
      private: readRecord(repoView).isPrivate === true,
      viewerPermission: readRecord(repoView).viewerPermission
    },
    authenticatedUser: {
      login: readRecord(user).login,
      organizations: Array.isArray(orgs) ? orgs.map((org) => readRecord(org).login).filter(Boolean) : []
    },
    selfHostedRunners: {
      scope: "repository",
      query: `gh api repos/${config.repository}/actions/runners`,
      totalCount,
      runners: runnerItems.map((runner) => {
        const item = readRecord(runner);
        return {
          id: item.id,
          name: item.name,
          status: item.status,
          busy: item.busy,
          labels: Array.isArray(item.labels) ? item.labels.map((label) => readRecord(label).name).filter(Boolean) : []
        };
      })
    },
    registration: {
      attempted: false,
      reasonCode: "USER_AUTHORIZATION_REQUIRED",
      message: "The readback did not register this workstation as a self-hosted runner because local runner registration changes the repository's Actions trust boundary and requires explicit user authorization."
    },
    blocker: {
      reasonCode: totalCount === 0 ? "SELF_HOSTED_RUNNER_UNAVAILABLE" : "SELF_HOSTED_RUNNER_EXECUTION_REQUIRED",
      message: totalCount === 0
        ? "FG4-EG2 requires a real self-hosted runner execution of the Organization Runner no-LLM gate, but the repository currently has zero self-hosted runners and no registration was authorized."
        : "FG4-EG2 still requires running the Organization Runner no-LLM workflow on a self-hosted runner and collecting artifact/log/CheckRun evidence.",
      requiredFollowUp: "Authorize an ephemeral repository self-hosted runner registration, run the Organization Runner workflow with the dedicated label, collect artifact/log/CheckRun evidence, then unregister the runner."
    },
    secretScan: {
      containsToken: false,
      containsRegistrationToken: false,
      containsPrivateKey: false,
      containsWebhookSecret: false
    }
  };
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export function inspectFg4SelfHostedRunnerReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const runners = readRecord(record.selfHostedRunners);
  const registration = readRecord(record.registration);
  const blocker = readRecord(record.blocker);
  const secretScan = readRecord(record.secretScan);
  const totalCount = Number(runners.totalCount);
  const serialized = JSON.stringify(recording);
  if (record.schemaVersion !== "archcontext.fg4-self-hosted-runner-readback/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.ok !== false) failures.push("blocked readback must not claim ok");
  if (record.status !== "blocked" && record.status !== "runner-available-but-unverified") failures.push("status must be blocked or runner-available-but-unverified");
  if (!readRecord(record.repository).fullName) failures.push("repository.fullName missing");
  if (!readRecord(record.authenticatedUser).login) failures.push("authenticatedUser.login missing");
  if (runners.scope !== "repository") failures.push("runner scope must be repository");
  if (!Number.isInteger(totalCount) || totalCount < 0) failures.push("selfHostedRunners.totalCount must be a non-negative integer");
  if (!Array.isArray(runners.runners)) failures.push("selfHostedRunners.runners must be an array");
  if (record.status === "blocked" && totalCount !== 0) failures.push("blocked evidence must have zero self-hosted runners");
  if (registration.attempted !== false) failures.push("registration must not be attempted in blocked readback");
  if (registration.reasonCode !== "USER_AUTHORIZATION_REQUIRED") failures.push("registration reason must require user authorization");
  if (totalCount === 0 && blocker.reasonCode !== "SELF_HOSTED_RUNNER_UNAVAILABLE") failures.push("zero-runner blocker reason mismatch");
  if (secretScan.containsToken !== false) failures.push("secretScan.containsToken must be false");
  if (secretScan.containsRegistrationToken !== false) failures.push("secretScan.containsRegistrationToken must be false");
  if (secretScan.containsPrivateKey !== false) failures.push("secretScan.containsPrivateKey must be false");
  if (secretScan.containsWebhookSecret !== false) failures.push("secretScan.containsWebhookSecret must be false");
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function ghJson(args: string[]): unknown {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

function renderHuman(record: Awaited<ReturnType<typeof runFg4SelfHostedRunnerReadback>>, inspection: { ok: boolean; failures: string[] }): string {
  return [
    `[fg4-self-hosted-runner-readback] ${inspection.ok ? "recorded blocked evidence" : "FAILED"}`,
    `- status: ${record.status}`,
    `- repository runners: ${record.selfHostedRunners.totalCount}`,
    `- registration attempted: ${record.registration.attempted}`,
    ...inspection.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  if (result.ok) return "[fg4-self-hosted-runner-readback] OK";
  return ["[fg4-self-hosted-runner-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}
