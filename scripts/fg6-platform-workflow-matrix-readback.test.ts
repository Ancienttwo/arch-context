import { describe, expect, test } from "bun:test";
import { inspectFg6PlatformWorkflowMatrix, summarizeHostedRun } from "./fg6-platform-workflow-matrix-readback";

describe("fg6 platform workflow matrix readback evidence", () => {
  test("accepts cross-platform Local Runtime and GitHub workflow matrix evidence", () => {
    expect(inspectFg6PlatformWorkflowMatrix(verifiedRecording())).toEqual({ ok: true, failures: [] });
  });

  test("rejects a failed matrix job even when the recorded aggregate says PASS", () => {
    const recording: any = verifiedRecording();
    recording.evidence.hostedCi.matrixJobs = [{ name: "windows-latest / Node 24.x", status: "completed", conclusion: "failure" }];
    expect(inspectFg6PlatformWorkflowMatrix(recording).ok).toBe(false);
  });

  test("records failed workflow independently of successful matrix jobs from GitHub REST", () => {
    const source = githubSources();
    const hosted = summarizeHostedRun(source.run, source.jobs);
    expect(hosted.workflowConclusion).toBe("failure");
    expect(hosted.matrixConclusion).toBe("success");
    const recording = verifiedRecording();
    Object.assign(recording.evidence.hostedCi, hosted);
    expect(inspectFg6PlatformWorkflowMatrix(recording)).toEqual({ ok: true, failures: [] });
  });

  test.each(["failure", "cancelled", "timed_out", "skipped"])("rejects matrix job conclusion %s even with workflow success", conclusion => {
    const source = githubSources();
    source.run.conclusion = "success";
    source.jobs.jobs[0]!.conclusion = conclusion;
    const hosted = summarizeHostedRun(source.run, source.jobs);
    expect(hosted.matrixConclusion).toBe("failure");
    const recording = verifiedRecording();
    Object.assign(recording.evidence.hostedCi, hosted);
    expect(inspectFg6PlatformWorkflowMatrix(recording).ok).toBe(false);
  });

  test("rejects missing, duplicate, incomplete, cross-run and stale-attempt jobs", () => {
    const mutations: Array<(record: any) => void> = [
      r => r.evidence.hostedCi.matrixJobs.pop(),
      r => r.evidence.hostedCi.matrixJobs[0] = r.evidence.hostedCi.matrixJobs[1],
      r => r.evidence.hostedCi.jobsComplete = false,
      r => r.evidence.hostedCi.matrixJobs[0].runId++,
      r => r.evidence.hostedCi.matrixJobs[0].runAttempt++,
      r => r.evidence.hostedCi.matrixJobs[0].headSha = "b".repeat(40),
      r => r.evidence.hostedCi.matrixJobs[0].status = "in_progress",
      r => r.evidence.hostedCi.workflowConclusion = "PASS",
      r => r.evidence.hostedCi.workflowStatus = "in_progress",
      r => r.evidence.hostedCi.workflowPath = ".github/workflows/other.yml",
      r => r.evidence.currentHeadSha = "b".repeat(40),
      r => r.schemaVersion = "archcontext.fg6-platform-workflow-matrix-readback/v1",
      r => r.evidence.hostedCi.runConclusion = "PASS"
    ];
    for (const mutate of mutations) {
      const recording = verifiedRecording();
      mutate(recording);
      expect(inspectFg6PlatformWorkflowMatrix(recording).ok).toBe(false);
    }
    const source = githubSources();
    source.jobs.total_count++;
    expect(summarizeHostedRun(source.run, source.jobs).jobsComplete).toBe(false);
    source.jobs.jobs.pop();
    expect(summarizeHostedRun(source.run, source.jobs).matrixConclusion).toBe("failure");
  });

  test("rejects historical Windows labels without measured ACL evidence", () => {
    const recording: any = verifiedRecording();
    const artifact = recording.evidence.hostedCi.artifacts.find((entry: any) => entry.platform === "win32");
    delete artifact.windowsAcl;
    const result = inspectFg6PlatformWorkflowMatrix(recording);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain(`hostedCi artifact ${artifact.name} Windows ACL evidence missing or invalid`);
  });

  test("rejects missing matrix targets, weak IPC contract, invalid artifacts, and failed runner workflows", () => {
    const recording: any = verifiedRecording();
    recording.evidence.workflowMatrix.os = ["ubuntu-latest", "macos-15"];
    recording.evidence.workflowMatrix.targetCount = 4;
    recording.evidence.platformIpcContract.usesInstalledBin = false;
    recording.evidence.hostedCi.artifactNames.pop();
    recording.evidence.hostedCi.artifactCount = 8;
    recording.evidence.hostedCi.artifacts[0].platform = "darwin";
    recording.evidence.githubWorkflowRuns.githubHosted.workflow.conclusion = "failure";
    recording.evidence.sourceInspections.selfHosted.ok = false;
    recording.evidence.assertions.localRuntimeMatrixNineTargets = false;

    const result = inspectFg6PlatformWorkflowMatrix(recording);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain("workflow matrix missing OS windows-latest");
    expect(result.failures).toContain("workflow matrix targetCount must be 9");
    expect(result.failures).toContain("platformIpcContract.usesInstalledBin must be true");
    expect(result.failures).toContain("hostedCi artifactCount must be 9");
    expect(result.failures).toContain("hostedCi artifact platform-ipc-permission-ubuntu-latest-node-22.22.x platform mismatch");
    expect(result.failures).toContain("hostedCi missing artifact platform-ipc-permission-windows-latest-node-25.x");
    expect(result.failures).toContain("githubHosted workflow conclusion must be success");
    expect(result.failures).toContain("selfHosted source inspection must pass");
    expect(result.failures).toContain("assertion localRuntimeMatrixNineTargets must be true");
  });
});

function verifiedRecording() {
  return {
    schemaVersion: "archcontext.fg6-platform-workflow-matrix-readback/v2",
    taskId: "FG6-08",
    environment: "staging-release-readback",
    status: "verified",
    ok: true,
    generatedAt: "2026-06-22T10:00:00.000Z",
    sources: {
      workflowPath: ".github/workflows/verify.yml",
      platformReadbackScript: "scripts/platform-ipc-permission-readback.mjs",
      hostedRunSource: "github-run.json",
      hostedJobsSource: "github-jobs.json",
      githubHostedRunnerSource: "docs/verification/fg4-github-hosted-runner-readback.json",
      selfHostedRunnerSource: "docs/verification/fg4-self-hosted-runner-execution-readback.json"
    },
    evidence: {
      workflowMatrix: {
        os: ["ubuntu-latest", "macos-15", "windows-latest"],
        nodeVersions: ["22.22.x", "24.x", "25.x"],
        targetCount: 9,
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
        checksWindowsAcl: true,
        checksLifecycle: true
      },
      hostedCi: {
        runId: 27871833633,
        headSha: "596366329a709be48d52fc58b5b2542cdc8ae1aa",
        runUrl: "https://github.com/Ancienttwo/arch-context/actions/runs/27871833633",
        workflowName: "Verify",
        workflowPath: ".github/workflows/verify.yml",
        event: "pull_request",
        runAttempt: 1,
        workflowStatus: "completed",
        workflowConclusion: "failure",
        matrixConclusion: "success",
        jobsComplete: true,
        matrixJobs: matrixJobs(),
        downloadedArtifactsVerified: true,
        artifactNames: hostedArtifactNames(),
        artifactCount: 9,
        artifacts: hostedArtifactNames().map((name) => ({
          name,
          sha256: `sha256:${"a".repeat(64)}`,
          platform: name.includes("ubuntu-latest") ? "linux" : name.includes("macos-") ? "darwin" : "win32",
          node: name.includes("22.22.x") ? "v22.22.3" : name.includes("24.x") ? "v24.19.0" : "v25.9.0",
          bun: "1.4.0",
          connectionMode: name.includes("windows-latest") ? "win32-acl" : "600",
          lockMode: name.includes("windows-latest") ? "win32-acl" : "600",
          windowsAcl: name.includes("windows-latest") ? {
            connection: { ownerMatchesCurrentUser: true, inheritanceDisabled: true, explicitOwnerFullControlOnly: true, accessRuleCount: 1 },
            lock: { ownerMatchesCurrentUser: true, inheritanceDisabled: true, explicitOwnerFullControlOnly: true, accessRuleCount: 1 },
            broadReadRejected: true
          } : null
        })),
        artifactFailures: [],
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
        localRuntimeMatrixNineTargets: true,
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

function hostedArtifactNames(): string[] {
  return [
    "platform-ipc-permission-ubuntu-latest-node-22.22.x",
    "platform-ipc-permission-ubuntu-latest-node-24.x",
    "platform-ipc-permission-ubuntu-latest-node-25.x",
    "platform-ipc-permission-macos-15-node-22.22.x",
    "platform-ipc-permission-macos-15-node-24.x",
    "platform-ipc-permission-macos-15-node-25.x",
    "platform-ipc-permission-windows-latest-node-22.22.x",
    "platform-ipc-permission-windows-latest-node-24.x",
    "platform-ipc-permission-windows-latest-node-25.x"
  ];
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

function matrixJobs() {
  return ["ubuntu-latest", "macos-15", "windows-latest"].flatMap((os, osIndex) =>
    ["22.22.x", "24.x", "25.x"].map((node, nodeIndex) => ({
      id: 100 + osIndex * 3 + nodeIndex, runId: 27871833633, runAttempt: 1,
      headSha: "596366329a709be48d52fc58b5b2542cdc8ae1aa",
      name: `${os} / Node ${node}`, status: "completed", conclusion: "success"
    })));
}

function githubSources() {
  return {
    run: { id: 27871833633, head_sha: "596366329a709be48d52fc58b5b2542cdc8ae1aa",
      html_url: "https://github.com/Ancienttwo/arch-context/actions/runs/27871833633",
      name: "Verify", path: ".github/workflows/verify.yml", event: "pull_request",
      run_attempt: 1, status: "completed", conclusion: "failure" },
    jobs: { total_count: 9, jobs: matrixJobs().map(job => ({
      id: job.id, run_id: job.runId, run_attempt: job.runAttempt, head_sha: job.headSha,
      name: job.name, status: job.status, conclusion: job.conclusion
    })) }
  };
}
