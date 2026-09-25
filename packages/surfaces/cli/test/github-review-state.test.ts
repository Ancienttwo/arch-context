import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestJson, type Json } from "@archcontext/contracts";
import { defaultGithubDeveloperReviewStatePath, readGithubDeveloperReviewState, writeGithubDeveloperReviewState, type GitHubDeveloperReviewState } from "../src/github-review-state";
import { runCli } from "../src/main";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "archctx-review-state-"));
  const previous = process.env.ARCHCONTEXT_STATE_DIR;
  process.env.ARCHCONTEXT_STATE_DIR = join(root, "state");
  const state: GitHubDeveloperReviewState = {
    schemaVersion: "archcontext.github-developer-review-state/v2",
    status: "submitted",
    challenge: {
      schemaVersion: "archcontext.review-challenge/v2", challengeId: "challenge.fixture",
      installationId: 1, repositoryId: 2, pullRequestNumber: 42,
      headSha: "a".repeat(40), baseSha: "b".repeat(40), requiredTrust: "developer",
      policyProfileId: "policy.default", status: "LEASED", createdAt: "2026-09-25T00:00:00Z", expiresAt: "2026-09-25T00:15:00Z"
    },
    challengeDigest: digestJson({ challenge: "fixture" }),
    updatedAt: "2026-09-25T00:01:00Z"
  };
  return { root, state, cleanup() {
    if (previous === undefined) delete process.env.ARCHCONTEXT_STATE_DIR;
    else process.env.ARCHCONTEXT_STATE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  } };
}

test("review state persists submission digest and returns only transient response metadata", async () => {
  const { root, state, cleanup } = fixture();
  try {
    const submission = { accepted: true, delivery: "metadata-only", providerReceipt: "receipt-42" };
    const written = await writeGithubDeveloperReviewState(root, { ...state, submission });
    expect(written.state.submission).toEqual(submission);
    const body = readFileSync(written.path, "utf8");
    expect(body).not.toContain("receipt-42");
    const restored = readGithubDeveloperReviewState(written.path)!;
    expect(restored).not.toHaveProperty("submission");
    expect(restored.submissionDigest).toBe(digestJson(submission));
    const status = await runCli("github", ["review", "status", "--pr", "42"], root);
    expect((status.data as any).submissionDigest).toBe(digestJson(submission));
    expect(status.data).not.toHaveProperty("submission");
  } finally { cleanup(); }
});

test("review state rejects secret-bearing adapter payloads before replacing a valid file", async () => {
  const { root, state, cleanup } = fixture();
  const nonce = 'nonce-"\\-fixture';
  const signature = "signed-fixture-material";
  try {
    const written = await writeGithubDeveloperReviewState(root, state);
    const original = readFileSync(written.path, "utf8");
    const submissions: Json[] = [
      { echo: nonce }, { echo: `prefix ${signature} suffix` },
      { nested: [{ nonce: "different-value" }] }, { signature: { value: "different-value" } },
      { attestation: {} }
    ];
    for (const submission of submissions) {
      await expect(writeGithubDeveloperReviewState(root, { ...state, submission }, [nonce, signature])).rejects.toThrow("github-review-secret-material-forbidden");
      expect(readFileSync(written.path, "utf8")).toBe(original);
    }
    await expect(writeGithubDeveloperReviewState(root, { ...state, reasonCode: `adapter error: ${nonce}` }, [nonce])).rejects.toThrow("github-review-secret-material-forbidden");
    expect(readFileSync(written.path, "utf8")).toBe(original);
  } finally { cleanup(); }
});

test("legacy review state requires explicit discard and never becomes review authority", async () => {
  const { root, state, cleanup } = fixture();
  try {
    const path = defaultGithubDeveloperReviewStatePath(root, 42);
    mkdirSync(dirname(path), { recursive: true });
    const legacy = { ...state, schemaVersion: "archcontext.github-developer-review-state/v1", challenge: { ...state.challenge, nonce: "legacy-nonce" }, attestation: { signature: { value: "legacy-signature" } } };
    writeFileSync(path, JSON.stringify(legacy));
    await expect(runCli("github", ["review", "status", "--pr", "42"], root)).rejects.toThrow("github-review-legacy-state-requires-discard");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(legacy);
    const discarded = await runCli("github", ["review", "discard-legacy-state", "--pr", "42"], root);
    expect(discarded.data).toMatchObject({ discarded: true, statePath: path });
    expect(existsSync(path)).toBe(false);
    await writeGithubDeveloperReviewState(root, state);
    await expect(runCli("github", ["review", "discard-legacy-state", "--pr", "42"], root)).rejects.toThrow("github-review-discard-requires-legacy-v1-state");
    expect(readGithubDeveloperReviewState(path)?.schemaVersion).toBe("archcontext.github-developer-review-state/v2");
  } finally { cleanup(); }
});

test("review state refuses unknown or secret-bearing persisted fields instead of echoing them", async () => {
  const { root, state, cleanup } = fixture();
  try {
    const path = defaultGithubDeveloperReviewStatePath(root, 42);
    mkdirSync(dirname(path), { recursive: true });
    for (const invalid of [
      { ...state, challenge: { ...state.challenge, nonce: "nonce" } },
      { ...state, attestation: { signature: { value: "signature" } } },
      { ...state, submission: { arbitrary: "response-body" } },
      { ...state, lease: { challengeId: "challenge.fixture", ownerId: "owner", leasedAt: "now", expiresAt: "later", nonce: "nonce" } },
      { ...state, challengeDigest: "not-a-digest" }
    ]) {
      writeFileSync(path, JSON.stringify(invalid));
      expect(() => readGithubDeveloperReviewState(path)).toThrow("github-review-state-metadata-invalid");
    }
  } finally { cleanup(); }
});
