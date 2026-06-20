import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectFg2StagingEvidence } from "./fg2-staging-evidence-readback.mjs";

describe("fg2-staging-evidence-readback", () => {
  test("allows pending FG2 staging evidence only when explicitly requested", async () => {
    const packet = {
      schemaVersion: "archcontext.fg2-staging-evidence/v1",
      environment: "staging",
      status: "pending",
      blockers: ["Awaiting staging installation."]
    };

    await expect(inspectFg2StagingEvidence(packet)).resolves.toMatchObject({
      ok: false,
      pending: true,
      blockers: ["Awaiting staging installation."]
    });
    await expect(inspectFg2StagingEvidence(packet, { allowPending: true })).resolves.toMatchObject({
      ok: true,
      pending: true
    });
  });

  test("accepts verified staging evidence when all FG2 staging gates have proof", async () => {
    const root = await writeVerifiedEgressRecording();

    await expect(inspectFg2StagingEvidence(verifiedPacket(), { root, packetDir: "." })).resolves.toMatchObject({
      ok: true,
      pending: false,
      failures: []
    });
  });

  test("rejects incomplete staging proof", async () => {
    const root = await writeVerifiedEgressRecording();
    const packet = verifiedPacket({
      evidence: {
        ...verifiedPacket().evidence,
        githubApp: {
          ...verifiedPacket().evidence.githubApp,
          checkUpdated: false
        },
        installRevoke: {
          ...verifiedPacket().evidence.installRevoke,
          checkUpdateStopped: false
        }
      }
    });

    await expect(inspectFg2StagingEvidence(packet, { root, packetDir: "." })).resolves.toMatchObject({
      ok: false,
      failures: [
        "githubApp.checkUpdated must be true",
        "installRevoke.checkUpdateStopped must be true"
      ]
    });
  });

  test("requires manifest ADR and install disclosure commits when Commit Statuses become required", async () => {
    const root = await writeVerifiedEgressRecording();
    const packet = verifiedPacket({
      evidence: {
        ...verifiedPacket().evidence,
        rulesetExpectedSource: {
          ...verifiedPacket().evidence.rulesetExpectedSource,
          commitStatusesPermission: "required-and-implemented"
        }
      }
    });

    await expect(inspectFg2StagingEvidence(packet, { root, packetDir: "." })).resolves.toMatchObject({
      ok: false,
      failures: [
        "rulesetExpectedSource.permissionManifestCommit must be a non-empty string",
        "rulesetExpectedSource.adrCommit must be a non-empty string",
        "rulesetExpectedSource.installDisclosureCommit must be a non-empty string"
      ]
    });
  });

  test("rejects private content shaped keys in the staging evidence packet", async () => {
    const root = await writeVerifiedEgressRecording();
    const packet = verifiedPacket({
      evidence: {
        ...verifiedPacket().evidence,
        githubApp: {
          ...verifiedPacket().evidence.githubApp,
          rawBody: "{}"
        }
      }
    });

    await expect(inspectFg2StagingEvidence(packet, { root, packetDir: "." })).resolves.toMatchObject({
      ok: false,
      failures: ["forbidden private-content key at $.evidence.githubApp.rawBody"]
    });
  });
});

async function writeVerifiedEgressRecording() {
  const root = await mkdtemp(join(tmpdir(), "archctx-fg2-staging-"));
  await writeFile(join(root, "fg2-egress-recording.json"), JSON.stringify({
    schemaVersion: "archcontext.github-egress-recording/v1",
    environment: "staging",
    status: "verified",
    recording: {
      githubEgress: {
        totalRequests: 3,
        categories: {
          "github.pull-head": 1,
          "github.check-create": 1,
          "github.check-update": 1
        }
      },
      forbiddenEndpointCounts: { prFiles: 0, contents: 0, blob: 0, tree: 0 },
      forbiddenMediaTypeCounts: { diff: 0, patch: 0 },
      baitHits: { log: 0, trace: 0, queue: 0 }
    }
  }));
  return root;
}

function verifiedPacket(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "archcontext.fg2-staging-evidence/v1",
    environment: "staging",
    status: "verified",
    gates: {
      "FG2-02": "verified",
      "FG2-17": "verified",
      "FG2-EG1": "verified",
      "FG2-EG4": "verified",
      "FG2-EG5": "verified",
      "FG2-EG6": "verified",
      "FG2-EG7": "verified"
    },
    evidence: {
      githubApp: {
        webhookReceived: true,
        checkCreated: true,
        checkUpdated: true,
        deliveryIdsRedacted: true
      },
      egressAndDlp: {
        recordingPath: "fg2-egress-recording.json"
      },
      rulesetExpectedSource: {
        commitStatusesPermission: "not-required",
        decisionRecord: "docs/verification/fg2-ruleset-expected-source.md",
        rulesetVerified: true
      },
      installRevoke: {
        installationRevoked: true,
        tokenRejectedAfterRevoke: true,
        challengeCreationStopped: true,
        checkUpdateStopped: true
      }
    },
    ...overrides
  };
}
