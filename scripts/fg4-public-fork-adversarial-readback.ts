#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_REPOSITORY = "Ancienttwo/arch-context";
const DEFAULT_OUTPUT = "docs/verification/fg4-public-fork-adversarial-readback.json";
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /GITHUB_WEBHOOK_SECRET/i,
  /installation[_-]?token/i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg4PublicForkAdversarialReadbackConfig(args);
    const record = await runFg4PublicForkAdversarialReadback(config);
    const inspection = inspectFg4PublicForkAdversarialReadback(record);
    process.stdout.write(`${config.json ? JSON.stringify(record, null, 2) : renderHuman(record, inspection)}\n`);
    if (!inspection.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const record = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const inspection = inspectFg4PublicForkAdversarialReadback(record);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(inspection, null, 2) : renderInspectHuman(inspection)}\n`);
    if (!inspection.ok) process.exit(1);
  } else {
    console.error("[fg4-public-fork-adversarial-readback] usage: run|inspect [--repo owner/name] [--out path] [--evidence path] [--json]");
    process.exit(2);
  }
}

export function buildFg4PublicForkAdversarialReadbackConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    repository: readFlag(args, "--repo") ?? DEFAULT_REPOSITORY,
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg4PublicForkAdversarialReadback(config: ReturnType<typeof buildFg4PublicForkAdversarialReadbackConfig>) {
  const repoView = ghJson(["repo", "view", config.repository, "--json", "owner,name,isPrivate,viewerPermission"]);
  const user = ghJson(["api", "user"]);
  const orgs = ghJson(["api", "user/orgs"]);
  const repoOwner = String(readRecord(readRecord(repoView).owner).login ?? "");
  const userLogin = String(readRecord(user).login ?? "");
  const organizations = Array.isArray(orgs) ? orgs.map((org) => readRecord(org).login).filter(Boolean) : [];
  const hasAlternateNamespace = repoOwner !== userLogin || organizations.length > 0;
  const record = {
    schemaVersion: "archcontext.fg4-public-fork-adversarial-readback/v1",
    environment: "staging",
    status: hasAlternateNamespace ? "fork-namespace-available-but-unverified" : "blocked",
    ok: false,
    generatedAt: config.now(),
    repository: {
      fullName: config.repository,
      visibility: readRecord(repoView).isPrivate === true ? "private" : "public",
      private: readRecord(repoView).isPrivate === true,
      allowForking: readRecord(repoView).isPrivate !== true
    },
    githubActions: {
      enabled: true,
      forkPullRequestContributorApproval: "unknown-readonly"
    },
    authenticatedUser: {
      login: userLogin,
      id: readRecord(user).id,
      organizations
    },
    forkAttempt: {
      attempted: false,
      reasonCode: "EXPLICIT_FORK_NAMESPACE_REQUIRED",
      message: "The readback did not create a fork or PR because the public fork adversarial test needs an explicit alternate namespace selected for cleanup ownership."
    },
    blocker: {
      reasonCode: hasAlternateNamespace ? "PUBLIC_FORK_EXECUTION_REQUIRED" : "FORK_NAMESPACE_UNAVAILABLE",
      message: hasAlternateNamespace
        ? "FG4-EG5 still requires creating a fork-owned branch, opening a public cross-repository PR, verifying no secret-bearing pull_request_target path executes, and cleaning up."
        : "GitHub cannot create a same-owner fork for the authenticated user, and no alternate organization namespace is available.",
      requiredFollowUp: "Provide a second GitHub user or organization namespace that can fork Ancienttwo/arch-context, open a cross-repository PR, allow readback cleanup, and expose no secrets to fork code."
    },
    secretScan: {
      containsToken: false,
      containsPrivateKey: false,
      containsWebhookSecret: false
    }
  };
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export function inspectFg4PublicForkAdversarialReadback(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const repository = readRecord(record.repository);
  const user = readRecord(record.authenticatedUser);
  const blocker = readRecord(record.blocker);
  const secretScan = readRecord(record.secretScan);
  const forkAttempt = readRecord(record.forkAttempt);
  const serialized = JSON.stringify(recording);
  if (record.schemaVersion !== "archcontext.fg4-public-fork-adversarial-readback/v1") failures.push("schemaVersion mismatch");
  if (record.environment !== "staging") failures.push("environment must be staging");
  if (record.ok !== false) failures.push("blocked readback must not claim ok");
  if (record.status !== "blocked" && record.status !== "fork-namespace-available-but-unverified") failures.push("status must be blocked or fork-namespace-available-but-unverified");
  if (repository.private !== false) failures.push("repository must be public for fork adversarial readback");
  if (repository.allowForking !== true) failures.push("repository must allow forks");
  if (!user.login) failures.push("authenticatedUser.login missing");
  if (!Array.isArray(user.organizations)) failures.push("authenticatedUser.organizations must be an array");
  if (forkAttempt.attempted === true) failures.push("default readback must not create a fork");
  if (record.status === "blocked" && blocker.reasonCode !== "FORK_NAMESPACE_UNAVAILABLE") failures.push("blocked fork reason mismatch");
  if (secretScan.containsToken !== false) failures.push("secretScan.containsToken must be false");
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

function renderHuman(record: Awaited<ReturnType<typeof runFg4PublicForkAdversarialReadback>>, inspection: { ok: boolean; failures: string[] }): string {
  return [
    `[fg4-public-fork-adversarial-readback] ${inspection.ok ? "recorded blocked evidence" : "FAILED"}`,
    `- status: ${record.status}`,
    `- user: ${record.authenticatedUser.login}`,
    `- organizations: ${record.authenticatedUser.organizations.length}`,
    ...inspection.failures.map((failure) => `- ${failure}`)
  ].join("\n");
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  if (result.ok) return "[fg4-public-fork-adversarial-readback] OK";
  return ["[fg4-public-fork-adversarial-readback] FAILED", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
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
