#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectFg4GithubHostedRunnerReadback } from "./fg4-github-hosted-runner-readback";

const DEFAULT_WORKFLOW = ".github/workflows/verify.yml";
const DEFAULT_PLATFORM_READBACK_SCRIPT = "scripts/platform-ipc-permission-readback.mjs";
const DEFAULT_FG1_GATE = "docs/verification/fg1-local-product-gate.md";
const DEFAULT_GITHUB_HOSTED_RUNNER_SOURCE = "docs/verification/fg4-github-hosted-runner-readback.json";
const DEFAULT_SELF_HOSTED_RUNNER_SOURCE = "docs/verification/fg4-self-hosted-runner-execution-readback.json";
const DEFAULT_OUTPUT = "docs/verification/fg6-platform-workflow-matrix-readback.json";
const REQUIRED_OS = ["ubuntu-latest", "macos-latest", "windows-latest"] as const;
const REQUIRED_NODE = ["24.x", "25.x"] as const;
const REQUIRED_ARTIFACTS = REQUIRED_OS.flatMap((os) => REQUIRED_NODE.map((nodeVersion) => `platform-ipc-permission-${os}-node-${nodeVersion}`));
const SECRET_PATTERNS = [
  /gh[opsu]_[A-Za-z0-9_]+/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /installation[_-]?token/i,
  /keychain:\/\//i
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (command === "run") {
    const config = buildFg6PlatformWorkflowMatrixConfig(process.env, args);
    const result = await runFg6PlatformWorkflowMatrix(config);
    process.stdout.write(`${config.json ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else if (command === "inspect") {
    const evidencePath = readFlag(args, "--evidence") ?? DEFAULT_OUTPUT;
    const recording = JSON.parse(await readFile(resolve(process.cwd(), evidencePath), "utf8")) as unknown;
    const result = inspectFg6PlatformWorkflowMatrix(recording);
    process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderInspectHuman(result)}\n`);
    if (!result.ok) process.exit(1);
  } else {
    console.error("[fg6-platform-workflow-matrix-readback] usage: run|inspect [--out path] [--json]");
    process.exit(2);
  }
}

export function buildFg6PlatformWorkflowMatrixConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  return {
    root: readFlag(args, "--root") ?? env.ARCHCONTEXT_READBACK_ROOT ?? process.cwd(),
    workflowPath: readFlag(args, "--workflow") ?? env.ARCHCONTEXT_FG6_WORKFLOW ?? DEFAULT_WORKFLOW,
    platformReadbackScript: readFlag(args, "--platform-readback-script") ?? env.ARCHCONTEXT_FG6_PLATFORM_READBACK_SCRIPT ?? DEFAULT_PLATFORM_READBACK_SCRIPT,
    fg1Gate: readFlag(args, "--fg1-gate") ?? env.ARCHCONTEXT_FG6_FG1_GATE ?? DEFAULT_FG1_GATE,
    githubHostedRunnerSource: readFlag(args, "--github-hosted-runner-source") ?? env.ARCHCONTEXT_FG6_GITHUB_HOSTED_RUNNER_SOURCE ?? DEFAULT_GITHUB_HOSTED_RUNNER_SOURCE,
    selfHostedRunnerSource: readFlag(args, "--self-hosted-runner-source") ?? env.ARCHCONTEXT_FG6_SELF_HOSTED_RUNNER_SOURCE ?? DEFAULT_SELF_HOSTED_RUNNER_SOURCE,
    outputPath: readFlag(args, "--out") ?? env.ARCHCONTEXT_FG6_PLATFORM_WORKFLOW_MATRIX_OUTPUT ?? DEFAULT_OUTPUT,
    json: args.includes("--json"),
    generatedAt: () => new Date().toISOString()
  };
}

export async function runFg6PlatformWorkflowMatrix(config: ReturnType<typeof buildFg6PlatformWorkflowMatrixConfig>) {
  const [workflowText, platformReadbackScript, fg1Gate, githubHostedRunnerSource, selfHostedRunnerSource] = await Promise.all([
    readFile(resolve(config.root, config.workflowPath), "utf8"),
    readFile(resolve(config.root, config.platformReadbackScript), "utf8"),
    readFile(resolve(config.root, config.fg1Gate), "utf8"),
    readJson(resolve(config.root, config.githubHostedRunnerSource)),
    readJson(resolve(config.root, config.selfHostedRunnerSource))
  ]);
  const hostedInspection = inspectFg4GithubHostedRunnerReadback(githubHostedRunnerSource);
  const selfHostedInspection = inspectFg4GithubHostedRunnerReadback(selfHostedRunnerSource);
  const hostedCi = extractHostedCiEvidence(fg1Gate);
  const currentHeadSha = currentGitHead(config.root);
  const workflowMatrix = inspectWorkflowText(workflowText);
  const platformIpcContract = inspectPlatformReadbackScript(platformReadbackScript);
  const recording = {
    schemaVersion: "archcontext.fg6-platform-workflow-matrix-readback/v1",
    taskId: "FG6-08",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: config.generatedAt(),
    sources: {
      workflowPath: config.workflowPath,
      platformReadbackScript: config.platformReadbackScript,
      fg1Gate: config.fg1Gate,
      githubHostedRunnerSource: config.githubHostedRunnerSource,
      selfHostedRunnerSource: config.selfHostedRunnerSource
    },
    evidence: {
      workflowMatrix,
      platformIpcContract,
      hostedCi,
      currentHeadSha,
      githubWorkflowRuns: {
        githubHosted: summarizeRunner(githubHostedRunnerSource),
        selfHosted: summarizeRunner(selfHostedRunnerSource)
      },
      sourceInspections: {
        githubHosted: hostedInspection,
        selfHosted: selfHostedInspection
      },
      assertions: {
        localRuntimeMatrixSixTargets: workflowMatrix.targetCount === 6 && hostedCi.artifactNames.length === 6,
        installedBinIpcReadbackUploaded: workflowMatrix.uploadArtifact === true && platformIpcContract.usesInstalledBin === true,
        hostedCiArtifactsVerified: hostedCi.runConclusion === "PASS" && hostedCi.downloadedArtifactsVerified === true,
        hostedCiMatchesCurrentHead: hostedCi.headSha === currentHeadSha,
        githubHostedRunnerWorkflowPass: hostedInspection.ok === true,
        selfHostedRunnerWorkflowPass: selfHostedInspection.ok === true,
        runnerArtifactsNoLlmProvider: summarizeRunner(githubHostedRunnerSource).artifact.llmProviderConfigured === false
          && summarizeRunner(selfHostedRunnerSource).artifact.llmProviderConfigured === false
      }
    },
    failures: [] as string[]
  };
  const inspection = inspectFg6PlatformWorkflowMatrix(recording);
  recording.status = inspection.ok ? "verified" : "failed";
  recording.ok = inspection.ok;
  recording.failures = inspection.failures;
  await mkdir(dirname(resolve(config.root, config.outputPath)), { recursive: true });
  await writeFile(resolve(config.root, config.outputPath), `${JSON.stringify(recording, null, 2)}\n`, "utf8");
  return recording;
}

export function inspectFg6PlatformWorkflowMatrix(recording: unknown): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const record = readRecord(recording);
  const evidence = readRecord(record.evidence);
  const workflowMatrix = readRecord(evidence.workflowMatrix);
  const platformIpcContract = readRecord(evidence.platformIpcContract);
  const hostedCi = readRecord(evidence.hostedCi);
  const currentHeadSha = String(evidence.currentHeadSha ?? "");
  const githubWorkflowRuns = readRecord(evidence.githubWorkflowRuns);
  const sourceInspections = readRecord(evidence.sourceInspections);
  const assertions = readRecord(evidence.assertions);

  if (record.schemaVersion !== "archcontext.fg6-platform-workflow-matrix-readback/v1") failures.push("schemaVersion mismatch");
  if (record.taskId !== "FG6-08") failures.push("taskId must be FG6-08");
  if (record.environment !== "staging-release-readback") failures.push("environment must be staging-release-readback");
  if (record.status !== "verified" || record.ok !== true) failures.push("status must be verified ok");

  inspectWorkflowMatrix(workflowMatrix, failures);
  inspectPlatformIpcContract(platformIpcContract, failures);
  if (!/^[a-f0-9]{40}$/.test(currentHeadSha)) failures.push("currentHeadSha must be a commit SHA");
  inspectHostedCi(hostedCi, currentHeadSha, failures);
  inspectRunnerSummary("githubHosted", readRecord(githubWorkflowRuns.githubHosted), failures);
  inspectRunnerSummary("selfHosted", readRecord(githubWorkflowRuns.selfHosted), failures);
  for (const [name, inspection] of Object.entries(sourceInspections)) {
    if (readRecord(inspection).ok !== true) failures.push(`${name} source inspection must pass`);
  }
  for (const key of [
    "localRuntimeMatrixSixTargets",
    "installedBinIpcReadbackUploaded",
    "hostedCiArtifactsVerified",
    "hostedCiMatchesCurrentHead",
    "githubHostedRunnerWorkflowPass",
    "selfHostedRunnerWorkflowPass",
    "runnerArtifactsNoLlmProvider"
  ]) {
    if (assertions[key] !== true) failures.push(`assertion ${key} must be true`);
  }
  const serialized = JSON.stringify(recording);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) failures.push(`recording contains forbidden secret marker: ${pattern}`);
  }
  return { ok: failures.length === 0, failures };
}

function inspectWorkflowText(text: string) {
  const os = REQUIRED_OS.filter((value) => text.includes(value));
  const nodeVersions = REQUIRED_NODE.filter((value) => text.includes(value));
  return {
    os,
    nodeVersions,
    targetCount: os.length * nodeVersions.length,
    failFastFalse: /fail-fast:\s*false/.test(text),
    verifyCommand: text.includes("run: bun run verify"),
    platformReadbackCommand: text.includes("node scripts/platform-ipc-permission-readback.mjs > platform-ipc-permission-readback.json"),
    uploadArtifact: text.includes("actions/upload-artifact@v4"),
    artifactNamePattern: text.includes("platform-ipc-permission-${{ matrix.os }}-node-${{ matrix.node-version }}"),
    governanceVerifySeparateJob: text.includes("governance-verify:") && text.includes("run: bun run verify:governance")
  };
}

function inspectPlatformReadbackScript(text: string) {
  return {
    schemaVersion: text.includes("archcontext.platform-ipc-permission-readback/v1"),
    usesInstalledBin: text.includes("resolveInstalledArchctxCommand") && text.includes("node_modules") && text.includes(".bin"),
    avoidsSourceEntrypoint: !text.includes("packages/surfaces/cli/src/main.ts"),
    checksHelp: text.includes("helpOk") && text.includes("hasDaemonCommand") && text.includes("hasMcpCommand") && text.includes("hasDoctorCommand"),
    checksLoopback: text.includes("http-loopback") && text.includes("127.0.0.1") && text.includes("loopbackOnly"),
    checksTokenRedaction: text.includes("tokenRedactedFromStatus"),
    checksPosixPermissions: text.includes("connectionMode === \"600\"") && text.includes("lockMode === \"600\""),
    checksLifecycle: text.includes("daemon\", \"start") && text.includes("daemon\", \"status") && text.includes("daemon\", \"stop")
  };
}

function extractHostedCiEvidence(text: string) {
  const runMatch = text.match(/Verify run `(\d+)`, head `([a-f0-9]{40})`/);
  const artifactNames = REQUIRED_ARTIFACTS.filter((name) => text.includes(`\`${name}\``));
  return {
    runId: runMatch ? Number(runMatch[1]) : 0,
    headSha: runMatch?.[2] ?? "",
    runUrl: runMatch ? `https://github.com/Ancienttwo/arch-context/actions/runs/${runMatch[1]}` : "",
    runConclusion: runMatch && text.includes(`GitHub Actions Verify run \`${runMatch[1]}\`: PASS`) ? "PASS" : "unknown",
    downloadedArtifactsVerified: text.includes("Downloaded hosted IPC artifacts: PASS"),
    artifactNames,
    artifactCount: artifactNames.length,
    posixModeVerified: text.includes("Linux/macOS connection and lock modes are `600`"),
    windowsAclVerified: text.includes("Windows connection and lock modes are `win32-acl`")
  };
}

function summarizeRunner(recording: unknown) {
  const evidence = readRecord(readRecord(recording).evidence);
  const workflow = readRecord(evidence.workflow);
  const artifact = readRecord(evidence.artifact);
  const organizationRunner = readRecord(evidence.organizationRunner);
  return {
    workflow: {
      name: workflow.name,
      kind: workflow.kind ?? "github-hosted",
      runnerLabels: Array.isArray(workflow.runnerLabels) ? workflow.runnerLabels : [],
      runId: Number(workflow.runId ?? 0),
      runUrl: workflow.runUrl,
      event: workflow.event,
      status: workflow.status,
      conclusion: workflow.conclusion
    },
    artifact: {
      environment: artifact.environment,
      runnerOs: artifact.runnerOs,
      runnerNamePresent: typeof artifact.runnerName === "string" && artifact.runnerName.length > 0,
      llmProviderConfigured: artifact.llmProviderConfigured,
      attestationTrustLevel: artifact.attestationTrustLevel,
      attestationResult: artifact.attestationResult,
      privacyAuditOk: artifact.privacyAuditOk,
      verificationAccepted: artifact.verificationAccepted
    },
    organizationRunner: {
      checkName: organizationRunner.checkName,
      conclusion: organizationRunner.conclusion,
      outputTitle: organizationRunner.outputTitle
    }
  };
}

function inspectWorkflowMatrix(workflowMatrix: Record<string, unknown>, failures: string[]): void {
  const os = Array.isArray(workflowMatrix.os) ? workflowMatrix.os.map(String) : [];
  const nodeVersions = Array.isArray(workflowMatrix.nodeVersions) ? workflowMatrix.nodeVersions.map(String) : [];
  for (const value of REQUIRED_OS) if (!os.includes(value)) failures.push(`workflow matrix missing OS ${value}`);
  for (const value of REQUIRED_NODE) if (!nodeVersions.includes(value)) failures.push(`workflow matrix missing Node ${value}`);
  if (Number(workflowMatrix.targetCount ?? 0) !== 6) failures.push("workflow matrix targetCount must be 6");
  for (const key of ["failFastFalse", "verifyCommand", "platformReadbackCommand", "uploadArtifact", "artifactNamePattern", "governanceVerifySeparateJob"]) {
    if (workflowMatrix[key] !== true) failures.push(`workflowMatrix.${key} must be true`);
  }
}

function inspectPlatformIpcContract(platformIpcContract: Record<string, unknown>, failures: string[]): void {
  for (const key of [
    "schemaVersion",
    "usesInstalledBin",
    "avoidsSourceEntrypoint",
    "checksHelp",
    "checksLoopback",
    "checksTokenRedaction",
    "checksPosixPermissions",
    "checksLifecycle"
  ]) {
    if (platformIpcContract[key] !== true) failures.push(`platformIpcContract.${key} must be true`);
  }
}

function inspectHostedCi(hostedCi: Record<string, unknown>, currentHeadSha: string, failures: string[]): void {
  if (!Number.isInteger(Number(hostedCi.runId)) || Number(hostedCi.runId) <= 0) failures.push("hostedCi.runId must be positive");
  if (!/^[a-f0-9]{40}$/.test(String(hostedCi.headSha ?? ""))) failures.push("hostedCi.headSha must be a commit SHA");
  if (String(hostedCi.headSha ?? "") !== currentHeadSha) failures.push("hostedCi.headSha must match currentHeadSha");
  if (!String(hostedCi.runUrl ?? "").startsWith("https://github.com/")) failures.push("hostedCi.runUrl must be GitHub");
  if (hostedCi.runConclusion !== "PASS") failures.push("hostedCi.runConclusion must be PASS");
  if (hostedCi.downloadedArtifactsVerified !== true) failures.push("hostedCi downloaded artifacts must be verified");
  if (Number(hostedCi.artifactCount ?? 0) !== 6) failures.push("hostedCi artifactCount must be 6");
  const artifactNames = Array.isArray(hostedCi.artifactNames) ? hostedCi.artifactNames.map(String) : [];
  for (const name of REQUIRED_ARTIFACTS) {
    if (!artifactNames.includes(name)) failures.push(`hostedCi missing artifact ${name}`);
  }
  if (hostedCi.posixModeVerified !== true) failures.push("hostedCi POSIX mode proof missing");
  if (hostedCi.windowsAclVerified !== true) failures.push("hostedCi Windows ACL proof missing");
}

function currentGitHead(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function inspectRunnerSummary(name: string, summary: Record<string, unknown>, failures: string[]): void {
  const workflow = readRecord(summary.workflow);
  const artifact = readRecord(summary.artifact);
  const organizationRunner = readRecord(summary.organizationRunner);
  if (!Number.isInteger(Number(workflow.runId)) || Number(workflow.runId) <= 0) failures.push(`${name} workflow.runId must be positive`);
  if (!String(workflow.runUrl ?? "").startsWith("https://github.com/")) failures.push(`${name} workflow.runUrl must be GitHub`);
  if (workflow.event !== "pull_request") failures.push(`${name} workflow event must be pull_request`);
  if (workflow.status !== "completed") failures.push(`${name} workflow status must be completed`);
  if (workflow.conclusion !== "success") failures.push(`${name} workflow conclusion must be success`);
  if (artifact.environment !== "github-actions") failures.push(`${name} artifact environment must be github-actions`);
  if (artifact.llmProviderConfigured !== false) failures.push(`${name} artifact llmProviderConfigured must be false`);
  if (artifact.attestationTrustLevel !== "organization") failures.push(`${name} artifact trust must be organization`);
  if (artifact.attestationResult !== "pass") failures.push(`${name} artifact result must be pass`);
  if (artifact.privacyAuditOk !== true) failures.push(`${name} privacy audit must pass`);
  if (artifact.verificationAccepted !== true) failures.push(`${name} attestation verification must be accepted`);
  if (organizationRunner.checkName !== "ArchContext / Organization Runner") failures.push(`${name} checkName mismatch`);
  if (organizationRunner.conclusion !== "success") failures.push(`${name} check conclusion must be success`);
  if (organizationRunner.outputTitle !== "Organization-attested") failures.push(`${name} check title must be Organization-attested`);
  if (name === "selfHosted" && artifact.runnerOs !== "macOS") failures.push("selfHosted artifact runnerOs must be macOS");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
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
  return result.ok === true ? "FG6 platform workflow matrix readback verified" : `FG6 platform workflow matrix readback failed: ${failures.join("; ")}`;
}

function renderInspectHuman(result: { ok: boolean; failures: string[] }): string {
  return result.ok ? "FG6 platform workflow matrix evidence verified" : `FG6 platform workflow matrix evidence failed: ${result.failures.join("; ")}`;
}
