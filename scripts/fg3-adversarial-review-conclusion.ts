#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CALLER_PROVIDED_ATTESTATION_FIELDS,
  assertNoCallerProvidedAttestationFields,
  digestJson,
  findCallerProvidedAttestationFields
} from "@archcontext/contracts";
import { completeTaskGate } from "@archcontext/core/review-engine";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { ArchctxDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";
import { McpLocalServer } from "../packages/surfaces/mcp-local/src/index";
import { runCli } from "../packages/surfaces/cli/src/main";

const DEFAULT_OUTPUT = "docs/verification/fg3-adversarial-review-conclusion.json";
const SHA = `sha256:${"a".repeat(64)}`;
const FORGED_MARKER = "forged-adversarial-review-conclusion";
const DENIED_FIELDS = [...CALLER_PROVIDED_ATTESTATION_FIELDS];
const REVIEW_ENGINE_DENIED_FIELDS = DENIED_FIELDS.filter((field) => field !== "modelDigest" && field !== "practiceEnforcement");

type DenialCase = {
  field: string;
  denied: boolean;
  reasonCode?: string;
  messageIncludesField: boolean;
};

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run") {
    console.error("[fg3-adversarial-review-conclusion] usage: run [--out path] [--json]");
    process.exit(2);
  }
  const config = buildFg3AdversarialReviewConclusionConfig(args);
  const result = await runFg3AdversarialReviewConclusion(config);
  process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export function buildFg3AdversarialReviewConclusionConfig(args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? process.cwd(),
    outputPath: readFlag(args, "--out") ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    now: () => new Date().toISOString()
  };
}

export async function runFg3AdversarialReviewConclusion(config: ReturnType<typeof buildFg3AdversarialReviewConclusionConfig>) {
  const failures: string[] = [];
  const generatedAt = config.now();
  const workspace = mkdtempSync(join(tmpdir(), "archctx-fg3-adversarial-conclusion-"));
  const repo = join(workspace, "repo");
  const provider = new MockCodeGraphProvider();
  const store = new TestLocalStore();
  const daemon = new ArchctxDaemon({
    codeFacts: new CodeGraphAdapter(provider),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: store,
    clock: () => "2026-06-20T09:03:00.000Z"
  });
  try {
    createInitializedGitRepo(repo);
    await daemon.start();
    const headSha = gitOut(repo, "rev-parse", "HEAD");
    const baseInput = {
      taskSessionId: "task_fg3_adversarial_conclusion",
      posture: "normal" as const,
      headSha,
      currentHeadSha: headSha,
      worktreeDigest: digestJson({ root: repo, headSha }),
      modelDigest: SHA,
      codeFactsDigest: SHA
    };

    const contractForged = Object.fromEntries(DENIED_FIELDS.map((field) => [field, forgedValueForField(field)]));
    const contractDeniedFields = findCallerProvidedAttestationFields(contractForged);
    let contractDenied = false;
    let contractMessage = "";
    try {
      assertNoCallerProvidedAttestationFields(contractForged, "agent");
    } catch (error) {
      contractDenied = true;
      contractMessage = error instanceof Error ? error.message : String(error);
    }

    const legalReview = completeTaskGate(baseInput);
    const reviewEngineDeniedCases = REVIEW_ENGINE_DENIED_FIELDS.map((field) => {
      const value = field === "signature" ? { algorithm: "ed25519", value: FORGED_MARKER } : "pass";
      try {
        completeTaskGate({ ...baseInput, [field]: value } as any);
        return { field, denied: false, messageIncludesField: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { field, denied: message.includes("review-conclusion-field-forbidden"), messageIncludesField: message.includes(field) };
      }
    });

    const legalRuntime = await daemon.completeTask(repo, {
      taskSessionId: "task_fg3_adversarial_runtime",
      headSha
    });
    const runtimeDeniedCases: DenialCase[] = [];
    for (const field of DENIED_FIELDS) {
      try {
        await daemon.completeTask(repo, {
          taskSessionId: `task_fg3_adversarial_runtime_${field}`,
          headSha,
          [field]: forgedValueForField(field)
        } as any);
        runtimeDeniedCases.push({ field, denied: false, messageIncludesField: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeDeniedCases.push({
          field,
          denied: message.includes("complete-task-caller-provided-attestation-field-forbidden"),
          messageIncludesField: message.includes(field)
        });
      }
    }

    const cliDeniedCases: DenialCase[] = [];
    for (const field of DENIED_FIELDS) {
      const flag = flagForField(field);
      const result = await runCli("review", [
        "--task-session-id", `task_fg3_adversarial_cli_${field}`,
        "--head-sha", headSha,
        flag,
        String(field === "signature" ? FORGED_MARKER : "pass")
      ], repo, {
        codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
        codeGraphProviderFactory: () => new MockCodeGraphProvider(),
        localStore: new TestLocalStore()
      });
      const message = result.ok ? "" : String((result as any).error?.message ?? "");
      cliDeniedCases.push({
        field,
        denied: result.ok === false,
        reasonCode: result.ok ? undefined : String((result as any).error?.code ?? ""),
        messageIncludesField: message.includes(flag)
      });
    }

    const mcp = new McpLocalServer(daemon);
    const legalMcp = await mcp.callTool("archcontext_complete_task", {
      root: repo,
      taskSessionId: "task_fg3_adversarial_mcp",
      posture: "normal",
      headSha
    });
    const mcpDeniedCases: DenialCase[] = [];
    for (const field of DENIED_FIELDS) {
      const result = await mcp.callTool("archcontext_complete_task", {
        root: repo,
        taskSessionId: `task_fg3_adversarial_mcp_${field}`,
        posture: "normal",
        headSha,
        [field]: forgedValueForField(field)
      });
      const content = result.content as any;
      const message = String(content.error?.message ?? "");
      mcpDeniedCases.push({
        field,
        denied: content.ok === false,
        reasonCode: String(content.error?.code ?? ""),
        messageIncludesField: message.includes(field)
      });
    }

    const developerAttestationDeniedCases: DenialCase[] = [];
    for (const field of DENIED_FIELDS) {
      try {
        await daemon.runSignedDeveloperReviewAttestation({
          challenge: {
            schemaVersion: "archcontext.review-challenge/v2",
            challengeId: "chal_fg3_adversarial_conclusion",
            installationId: 10001,
            repositoryId: 20002,
            pullRequestNumber: 42,
            headSha,
            baseSha: headSha,
            nonce: "nonce_fg3_adversarial_conclusion_secret",
            requiredTrust: "developer",
            policyProfileId: "policy.default",
            createdAt: "2026-06-20T09:00:00Z",
            expiresAt: "2026-06-20T09:15:00Z",
            status: "LEASED"
          },
          worktree: {
            schemaVersion: "archcontext.detached-review-worktree/v1",
            sourceRoot: repo,
            worktreeRoot: repo,
            temporaryRoot: workspace,
            headSha,
            headTreeOid: "not-used-before-guard",
            detached: true,
            clean: true
          },
          keyRef: "credential-ref",
          principalId: "agent-forge",
          publicKeyId: "key_agent_forge",
          [field]: forgedValueForField(field)
        } as any);
        developerAttestationDeniedCases.push({ field, denied: false, messageIncludesField: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        developerAttestationDeniedCases.push({
          field,
          denied: message.includes("developer-review-attestation-caller-provided-attestation-field-forbidden"),
          messageIncludesField: message.includes(field)
        });
      }
    }

    const evidence = {
      processLevelFixture: true,
      deniedFields: DENIED_FIELDS,
      contract: {
        denied: contractDenied,
        deniedFields: contractDeniedFields,
        messageIncludesAllFields: DENIED_FIELDS.every((field) => contractMessage.includes(field))
      },
      reviewEngine: {
        legalResult: legalReview.result,
        deniedCases: reviewEngineDeniedCases
      },
      runtimeCompleteTask: {
        legalResult: (legalRuntime.data as any)?.result ?? "",
        persistedLegalResult: (store.reviews.get((legalRuntime.data as any)?.reviewId) as any)?.result ?? "",
        deniedCases: runtimeDeniedCases
      },
      cli: {
        deniedCases: cliDeniedCases
      },
      mcp: {
        legalResult: (legalMcp.content as any)?.data?.result ?? "",
        deniedCases: mcpDeniedCases
      },
      developerReviewAttestation: {
        deniedCases: developerAttestationDeniedCases
      }
    };
    const serializedEvidence = JSON.stringify(evidence);
    const leakCounters = {
      forgedMarkerLeaks: serializedEvidence.includes(FORGED_MARKER) ? 1 : 0,
      privateKeyLeaks: /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serializedEvidence) ? 1 : 0,
      keyRefLeaks: /keychain:\/\//i.test(serializedEvidence) ? 1 : 0,
      nonceSecretLeaks: /nonce_[A-Za-z0-9_-]*secret/i.test(serializedEvidence) ? 1 : 0
    };
    const result = {
      schemaVersion: "archcontext.fg3-adversarial-review-conclusion/v1",
      environment: "process-fixture",
      status: "verified",
      ok: true,
      generatedAt,
      evidence: {
        ...evidence,
        allAdversarialInputsDenied: allDenied([
          reviewEngineDeniedCases,
          runtimeDeniedCases,
          cliDeniedCases,
          mcpDeniedCases,
          developerAttestationDeniedCases
        ]) && contractDenied && sameSet(contractDeniedFields, DENIED_FIELDS),
        leakCounters
      },
      failures
    };
    inspectFg3AdversarialReviewConclusion(result).failures.forEach((failure) => failures.push(failure));
    result.status = failures.length === 0 ? "verified" : "failed";
    result.ok = failures.length === 0;
    result.failures = failures;
    await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
    await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return result;
  } finally {
    await daemon.stop().catch(() => undefined);
    rmSync(workspace, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0, retryDelay: 100 });
  }
}

export function inspectFg3AdversarialReviewConclusion(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const root = readRecord(recording);
  const evidence = readRecord(root.evidence);
  if (root.schemaVersion !== "archcontext.fg3-adversarial-review-conclusion/v1") failures.push("schemaVersion mismatch");
  if (root.environment !== "process-fixture") failures.push("environment must be process-fixture");
  if (root.status !== "verified" || root.ok !== true) failures.push("status must be verified ok");
  if (evidence.processLevelFixture !== true) failures.push("evidence.processLevelFixture must be true");
  if (!sameSet(readStringArray(evidence.deniedFields), DENIED_FIELDS)) failures.push("deniedFields must match contract denylist");

  const contract = readRecord(evidence.contract);
  if (contract.denied !== true) failures.push("contract must deny forged Agent fields");
  if (!sameSet(readStringArray(contract.deniedFields), DENIED_FIELDS)) failures.push("contract deniedFields must include all forbidden fields");
  if (contract.messageIncludesAllFields !== true) failures.push("contract error must include all forbidden fields");

  const reviewEngine = readRecord(evidence.reviewEngine);
  if (reviewEngine.legalResult !== "pass") failures.push("reviewEngine legal result must be pass");
  assertCases(failures, "reviewEngine", reviewEngine.deniedCases, REVIEW_ENGINE_DENIED_FIELDS);

  const runtime = readRecord(evidence.runtimeCompleteTask);
  if (runtime.legalResult !== "pass") failures.push("runtimeCompleteTask legal result must be pass");
  if (runtime.persistedLegalResult !== "pass") failures.push("runtimeCompleteTask must persist daemon-owned legal result");
  assertCases(failures, "runtimeCompleteTask", runtime.deniedCases, DENIED_FIELDS);

  const cli = readRecord(evidence.cli);
  assertCases(failures, "cli", cli.deniedCases, DENIED_FIELDS, "AC_SCHEMA_INVALID");

  const mcp = readRecord(evidence.mcp);
  if (mcp.legalResult !== "pass") failures.push("mcp legal result must be pass");
  assertCases(failures, "mcp", mcp.deniedCases, DENIED_FIELDS, "AC_SCHEMA_INVALID");

  const attestation = readRecord(evidence.developerReviewAttestation);
  assertCases(failures, "developerReviewAttestation", attestation.deniedCases, DENIED_FIELDS);

  if (evidence.allAdversarialInputsDenied !== true) failures.push("allAdversarialInputsDenied must be true");
  const leakCounters = readRecord(evidence.leakCounters);
  for (const key of ["forgedMarkerLeaks", "privateKeyLeaks", "keyRefLeaks", "nonceSecretLeaks"]) {
    if (Number(leakCounters[key] ?? 0) !== 0) failures.push(`${key} must be 0`);
  }
  const serialized = JSON.stringify(recording);
  if (serialized.includes(FORGED_MARKER)) failures.push("recording contains forged marker");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(serialized)) failures.push("recording contains private key material");
  if (/keychain:\/\//i.test(serialized)) failures.push("recording contains keychain ref");
  if (/nonce_[A-Za-z0-9_-]*secret/i.test(serialized)) failures.push("recording contains forbidden nonce marker");
  return { ok: failures.length === 0, failures };
}

function createInitializedGitRepo(repo: string): void {
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), "# FG3 adversarial review conclusion\n", "utf8");
  initializeArchContextModel(repo, "FG3 Adversarial Review Conclusion");
  git(repo, "init");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-m", "fixture");
}

function forgedValueForField(field: string): unknown {
  return field === "signature" ? { algorithm: "ed25519", value: FORGED_MARKER } : "pass";
}

function flagForField(field: string): string {
  return `--${field.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

function allDenied(groups: DenialCase[][]): boolean {
  return groups.every((group) => group.every((entry) => entry.denied && entry.messageIncludesField));
}

function assertCases(failures: string[], label: string, cases: unknown, expectedFields: readonly string[], expectedReasonCode?: string): void {
  const entries = Array.isArray(cases) ? cases.map(readRecord) : [];
  const byField = new Map(entries.map((entry) => [String(entry.field), entry]));
  for (const field of expectedFields) {
    const entry = byField.get(field);
    if (!entry) {
      failures.push(`${label} missing denied case: ${field}`);
      continue;
    }
    if (entry.denied !== true) failures.push(`${label} must deny ${field}`);
    if (entry.messageIncludesField !== true) failures.push(`${label} denial must name ${field}`);
    if (expectedReasonCode && entry.reasonCode !== expectedReasonCode) failures.push(`${label} ${field} must return ${expectedReasonCode}`);
  }
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function git(repo: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function renderHuman(result: { ok: boolean; evidence?: { allAdversarialInputsDenied?: boolean }; failures?: string[] }) {
  return result.ok
    ? `[fg3-adversarial-review-conclusion] verified allDenied=${result.evidence?.allAdversarialInputsDenied === true}`
    : `[fg3-adversarial-review-conclusion] failed\n${(result.failures ?? []).map((failure) => `- ${failure}`).join("\n")}`;
}
