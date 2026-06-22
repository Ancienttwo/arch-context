import { describe, expect, test } from "bun:test";
import { inspectFg6PlatformWorkflowMatrix } from "./fg6-platform-workflow-matrix-readback";

describe("fg6 platform workflow matrix readback evidence", () => {
  test("accepts cross-platform Local Runtime and GitHub workflow matrix evidence", () => {
    expect(inspectFg6PlatformWorkflowMatrix(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects missing matrix targets, weak IPC contract, missing artifacts, and failed runner workflows", () => {
    const recording: any = verifiedRecording();
    recording.evidence.workflowMatrix.os = ["ubuntu-latest", "macos-latest"];
    recording.evidence.workflowMatrix.targetCount = 4;
    recording.evidence.platformIpcContract.usesInstalledBin = false;
    recording.evidence.hostedCi.artifactNames.pop();
    recording.evidence.hostedCi.artifactCount = 5;
    recording.evidence.githubWorkflowRuns.githubHosted.workflow.conclusion = "failure";
    recording.evidence.sourceInspections.selfHosted.ok = false;
    recording.evidence.assertions.localRuntimeMatrixSixTargets = false;

    const result = inspectFg6PlatformWorkflowMatrix(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("workflow matrix missing OS windows-latest");
    expect(result.failures).toContain("workflow matrix targetCount must be 6");
    expect(result.failures).toContain("platformIpcContract.usesInstalledBin must be true");
    expect(result.failures).toContain("hostedCi artifactCount must be 6");
    expect(result.failures).toContain("hostedCi missing artifact platform-ipc-permission-windows-latest-node-25.x");
    expect(result.failures).toContain("githubHosted workflow conclusion must be success");
    expect(result.failures).toContain("selfHosted source inspection must pass");
    expect(result.failures).toContain("assertion localRuntimeMatrixSixTargets must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-platform-workflow-matrix-readback/v1",
    taskId: "FG6-08",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T10:00:00.000Z",
    sources: {
      workflowPath: ".github/workflows/verify.yml",
      platformReadbackScript: "scripts/platform-ipc-permission-readback.mjs",
      fg1Gate: "docs/verification/fg1-local-product-gate.md",
      githubHostedRunnerSource: "docs/verification/fg4-github-hosted-runner-readback.json",
      selfHostedRunnerSource: "docs/verification/fg4-self-hosted-runner-execution-readback.json"
    },
    evidence: {
      workflowMatrix: {
        os: ["ubuntu-latest", "macos-latest", "windows-latest"],
        nodeVersions: ["24.x", "25.x"],
        targetCount: 6,
        failFastFalse: true,
        verifyCommand: true,
        platformReadbackCommand: true,
        uploadArtifact: true,
        artifactNamePattern: true,
        governanceVerifySeparateJob: true
      },
      platformIpcContract: {
        schemaVersion: true,
        usesInstalledBin: true,
        avoidsSourceEntrypoint: true,
        checksHelp: true,
        checksLoopback: true,
        checksTokenRedaction: true,
        checksPosixPermissions: true,
        checksLifecycle: true
      },
      hostedCi: {
        runId: 27871833633,
        headSha: "596366329a709be48d52fc58b5b2542cdc8ae1aa",
        runUrl: "https://github.com/Ancienttwo/arch-context/actions/runs/27871833633",
        runConclusion: "PASS",
        downloadedArtifactsVerified: true,
        artifactNames: [
          "platform-ipc-permission-ubuntu-latest-node-24.x",
          "platform-ipc-permission-ubuntu-latest-node-25.x",
          "platform-ipc-permission-macos-latest-node-24.x",
          "platform-ipc-permission-macos-latest-node-25.x",
          "platform-ipc-permission-windows-latest-node-24.x",
          "platform-ipc-permission-windows-latest-node-25.x"
        ],
        artifactCount: 6,
        posixModeVerified: true,
        windowsAclVerified: true
      },
      currentHeadSha: "596366329a709be48d52fc58b5b2542cdc8ae1aa",
      githubWorkflowRuns: {
        githubHosted: runnerSummary({ runnerOs: "Linux", kind: "github-hosted", runId: 27894392126 }),
        selfHosted: runnerSummary({ runnerOs: "macOS", kind: "self-hosted", runId: 27905483126 })
      },
      sourceInspections: {
        githubHosted: { ok: true, failures: [] },
        selfHosted: { ok: true, failures: [] }
      },
      assertions: {
        localRuntimeMatrixSixTargets: true,
        installedBinIpcReadbackUploaded: true,
        hostedCiArtifactsVerified: true,
        hostedCiMatchesCurrentHead: true,
        githubHostedRunnerWorkflowPass: true,
        selfHostedRunnerWorkflowPass: true,
        runnerArtifactsNoLlmProvider: true
      }
    },
    failures: []
  };
}

function runnerSummary(input: { runnerOs: string; kind: string; runId: number }) {
  return {
    workflow: {
      name: input.kind === "self-hosted" ? "FG4 EG2 Self-hosted Organization Runner" : "FG4 EG1 GitHub-hosted Organization Runner",
      kind: input.kind,
      runnerLabels: input.kind === "self-hosted" ? ["self-hosted", "macOS", "ARM64", "archcontext-fg4-eg2"] : [],
      runId: input.runId,
      runUrl: `https://github.com/Ancienttwo/arch-context/actions/runs/${input.runId}`,
      event: "pull_request",
      status: "completed",
      conclusion: "success"
    },
    artifact: {
      environment: "github-actions",
      runnerOs: input.runnerOs,
      runnerNamePresent: input.kind === "self-hosted",
      llmProviderConfigured: false,
      attestationTrustLevel: "organization",
      attestationResult: "pass",
      privacyAuditOk: true,
      verificationAccepted: true
    },
    organizationRunner: {
      checkName: "ArchContext / Organization Runner",
      conclusion: "success",
      outputTitle: "Organization-attested"
    }
  };
}
