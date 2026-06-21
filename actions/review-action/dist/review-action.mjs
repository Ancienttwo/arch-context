#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACTION_NAME = "archcontext/review-action";
const DEFAULT_API_ENDPOINT = "https://archcontext.repoharness.com";
const DEFAULT_CHALLENGE = "auto";
const DEFAULT_FAIL_ON = "blocking";
const DEFAULT_FORK_PR_MODE = "unsupported";
const DEFAULT_TRUST_LEVEL = "organization";

const inputs = {
  apiEndpoint: readInput("api-endpoint", DEFAULT_API_ENDPOINT),
  challenge: readInput("challenge", DEFAULT_CHALLENGE),
  failOn: readInput("fail-on", DEFAULT_FAIL_ON),
  forkPrMode: readInput("fork-pr-mode", DEFAULT_FORK_PR_MODE),
  checkoutRoot: readInput("checkout-root", "."),
  expectedRepository: readInput("expected-repository", ""),
  expectedHeadSha: readInput("expected-head-sha", ""),
  expectedHeadTreeOid: readInput("expected-head-tree-oid", ""),
  runtimeArtifactDigest: readInput("runtime-artifact-digest", ""),
  runtimeArtifactUrl: readInput("runtime-artifact-url", ""),
  runtimeVersion: readInput("runtime-version", readPackageVersion()),
  trustLevel: readInput("trust-level", DEFAULT_TRUST_LEVEL)
};

const forkPolicy = evaluateForkPolicy({
  ...readForkPullRequestContext(),
  forkPullRequestMode: inputs.forkPrMode,
  signingSecretConfigured: hasSigningSecretConfigured()
});
writeOutput("fork-policy", JSON.stringify(forkPolicy));

if (!forkPolicy.run) {
  writeForkSummary(forkPolicy);
} else {
  const result = createPreflightPlan(inputs);
  if (!result.ok) {
    fail(result.reason);
  } else {
    const checkout = verifyCheckout({
      checkoutRoot: inputs.checkoutRoot,
      expectedRepository: inputs.expectedRepository,
      expectedHeadSha: inputs.expectedHeadSha,
      expectedHeadTreeOid: inputs.expectedHeadTreeOid,
      githubRepository: process.env.GITHUB_REPOSITORY ?? ""
    });
    if (!checkout.ok) {
      fail(checkout.reasonCode);
    } else {
      writeOutput("runtime-version", result.plan.runtimeVersion);
      writeOutput("runtime-artifact-digest", result.plan.runtimeArtifactDigest);
      writeOutput("checkout-verification", JSON.stringify(checkout));
      writeOutput("action-plan", JSON.stringify(result.plan));
      writeSummary(result.plan, checkout, forkPolicy);
    }
  }
}

function createPreflightPlan(input) {
  const expectedVersion = readPackageVersion();
  if (input.runtimeVersion !== expectedVersion) {
    return { ok: false, reason: "runtime-version-mismatch" };
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.runtimeArtifactDigest)) {
    return { ok: false, reason: "runtime-artifact-digest-invalid" };
  }
  if (!isHttpsUrl(input.runtimeArtifactUrl)) {
    return { ok: false, reason: "runtime-artifact-url-invalid" };
  }
  if (!isHttpUrl(input.apiEndpoint)) {
    return { ok: false, reason: "api-endpoint-invalid" };
  }
  if (input.trustLevel !== DEFAULT_TRUST_LEVEL) {
    return { ok: false, reason: "trust-level-mismatch" };
  }
  if (input.failOn !== "blocking" && input.failOn !== "non-blocking") {
    return { ok: false, reason: "fail-on-invalid" };
  }
  if (input.challenge.length === 0) {
    return { ok: false, reason: "challenge-invalid" };
  }
  return {
    ok: true,
    plan: {
      schemaVersion: "archcontext.review-action-plan/v1",
      actionName: ACTION_NAME,
      apiEndpoint: input.apiEndpoint,
      challenge: input.challenge,
      failOn: input.failOn,
      runtimeArtifactDigest: input.runtimeArtifactDigest,
      runtimeArtifactUrl: input.runtimeArtifactUrl,
      runtimeVersion: expectedVersion,
      trustLevel: DEFAULT_TRUST_LEVEL
    }
  };
}

function evaluateForkPolicy(input) {
  const repository = normalizeRepository(input.repository);
  const pullRequestHeadRepository = normalizeRepository(input.pullRequestHeadRepository);
  const fork = input.eventName === "pull_request" && (
    input.pullRequestHeadFork === true
    || (repository !== null && pullRequestHeadRepository !== null && repository !== pullRequestHeadRepository)
  );
  const signingSecretConfigured = input.signingSecretConfigured === true;

  if (!fork) {
    return {
      run: true,
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      mode: "trusted",
      fork: false,
      repository,
      pullRequestHeadRepository,
      requiresSigningSecret: true,
      signingSecretConfigured
    };
  }

  if (signingSecretConfigured) {
    return {
      run: false,
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      mode: "unsupported",
      fork: true,
      repository,
      pullRequestHeadRepository,
      outputConclusion: "neutral",
      reasonCode: "FORK_PR_SECRET_EXPOSURE_FORBIDDEN",
      requiresSigningSecret: false,
      signingSecretConfigured
    };
  }

  if (input.forkPullRequestMode === "safe-no-secret") {
    return {
      run: true,
      schemaVersion: "archcontext.review-action-fork-policy/v1",
      mode: "safe-no-secret",
      fork: true,
      repository,
      pullRequestHeadRepository,
      requiresSigningSecret: false,
      signingSecretConfigured: false
    };
  }

  return {
    run: false,
    schemaVersion: "archcontext.review-action-fork-policy/v1",
    mode: "unsupported",
    fork: true,
    repository,
    pullRequestHeadRepository,
    outputConclusion: "neutral",
    reasonCode: "FORK_PR_UNSUPPORTED",
    requiresSigningSecret: false,
    signingSecretConfigured: false
  };
}

function verifyCheckout(input) {
  const expected = {
    repository: input.expectedRepository,
    headSha: input.expectedHeadSha,
    headTreeOid: input.expectedHeadTreeOid
  };
  if (!expected.repository || !expected.headSha || !expected.headTreeOid) {
    return {
      ok: false,
      schemaVersion: "archcontext.review-action-checkout/v1",
      reasonCode: "CHECKOUT_EXPECTED_FIELD_MISSING",
      expected,
      observed: {
        githubRepository: input.githubRepository || null
      }
    };
  }

  let sourceRoot;
  try {
    sourceRoot = findRepositoryRoot(input.checkoutRoot);
  } catch {
    return {
      ok: false,
      schemaVersion: "archcontext.review-action-checkout/v1",
      reasonCode: "CHECKOUT_UNAVAILABLE",
      expected,
      observed: {
        githubRepository: input.githubRepository || null
      }
    };
  }

  const observedRepository = readGitHubOriginRepository(sourceRoot);
  const observedGitHubRepository = input.githubRepository || null;
  if (
    (observedGitHubRepository && observedGitHubRepository !== expected.repository)
    || (observedRepository && observedRepository !== expected.repository)
  ) {
    return {
      ok: false,
      schemaVersion: "archcontext.review-action-checkout/v1",
      reasonCode: "REPOSITORY_MISMATCH",
      expected,
      observed: {
        repository: observedRepository,
        githubRepository: observedGitHubRepository
      }
    };
  }

  const observed = readCheckoutObserved(sourceRoot);
  if (!observed.headSha || !observed.headTreeOid) return checkoutRejected("HEAD_UNAVAILABLE", expected, observedRepository, observedGitHubRepository, observed);
  if (observed.headSha !== expected.headSha) return checkoutRejected("HEAD_SHA_MISMATCH", expected, observedRepository, observedGitHubRepository, observed);
  if (observed.headTreeOid !== expected.headTreeOid) return checkoutRejected("TREE_OID_MISMATCH", expected, observedRepository, observedGitHubRepository, observed);
  if (observed.detached !== true) return checkoutRejected("WORKTREE_NOT_DETACHED", expected, observedRepository, observedGitHubRepository, observed);
  if (observed.clean !== true) return checkoutRejected("WORKTREE_NOT_CLEAN", expected, observedRepository, observedGitHubRepository, observed);

  return {
    ok: true,
    schemaVersion: "archcontext.review-action-checkout/v1",
    sourceRoot,
    expected,
    observed: {
      repository: observedRepository,
      githubRepository: observedGitHubRepository,
      headSha: observed.headSha,
      headTreeOid: observed.headTreeOid,
      detached: true,
      clean: true
    }
  };
}

function checkoutRejected(reasonCode, expected, repository, githubRepository, observed) {
  return {
    ok: false,
    schemaVersion: "archcontext.review-action-checkout/v1",
    reasonCode,
    expected,
    observed: {
      repository,
      githubRepository,
      ...observed
    }
  };
}

function readForkPullRequestContext() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  let repository = process.env.GITHUB_REPOSITORY ?? "";
  let pullRequestHeadRepository = "";
  let pullRequestHeadFork = false;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (eventName === "pull_request" && eventPath) {
    try {
      const payload = JSON.parse(readFileSync(eventPath, "utf8"));
      repository = readString(payload?.repository?.full_name) || repository;
      const headRepo = payload?.pull_request?.head?.repo;
      pullRequestHeadRepository = readString(headRepo?.full_name) || "";
      pullRequestHeadFork = headRepo?.fork === true;
    } catch {
      pullRequestHeadRepository = "";
      pullRequestHeadFork = false;
    }
  }

  return { eventName, repository, pullRequestHeadRepository, pullRequestHeadFork };
}

function hasSigningSecretConfigured() {
  return Boolean(
    process.env.ARCHCONTEXT_RUNNER_PRIVATE_KEY
    || process.env.ARCHCONTEXT_RUNNER_KEY
    || process.env.ARCHCONTEXT_ORG_RUNNER_PRIVATE_KEY
  );
}

function readInput(name, fallback) {
  const envName = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  const value = process.env[envName];
  return value === undefined || value === "" ? fallback : value;
}

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    console.log(`${name}=${value}`);
    return;
  }
  const delimiter = `archcontext_${name.replace(/[^A-Za-z0-9]/g, "_")}`;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function writeSummary(plan, checkout, forkPolicy) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## ArchContext Review Action",
      "",
      `Runtime version: ${plan.runtimeVersion}`,
      `Runtime artifact: ${plan.runtimeArtifactDigest}`,
      `Trust: ${plan.trustLevel}`,
      `Fail on: ${plan.failOn}`,
      `Fork policy: ${forkPolicy.mode}`,
      `Repository: ${checkout.expected.repository}`,
      `Head: ${checkout.expected.headSha}`,
      `Tree: ${checkout.expected.headTreeOid}`,
      ""
    ].join("\n")
  );
}

function writeForkSummary(forkPolicy) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## ArchContext Review Action",
      "",
      "Fork PR: unsupported",
      `Reason: ${forkPolicy.reasonCode}`,
      `Conclusion: ${forkPolicy.outputConclusion}`,
      "No signing secret is used for this run.",
      ""
    ].join("\n")
  );
}

function fail(reason) {
  console.error(`::error::${reason}`);
  process.exitCode = 1;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeRepository(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}

function readString(value) {
  return typeof value === "string" && value.length > 0 ? value : "";
}

function findRepositoryRoot(start) {
  return resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: start,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim());
}

function readCheckoutObserved(root) {
  try {
    return {
      headSha: gitOut(root, "rev-parse", "HEAD"),
      headTreeOid: gitOut(root, "rev-parse", "HEAD^{tree}"),
      detached: gitOut(root, "rev-parse", "--abbrev-ref", "HEAD") === "HEAD",
      clean: gitSucceeds(root, "diff", "--quiet", "--ignore-submodules=none", "--")
        && gitSucceeds(root, "diff", "--cached", "--quiet", "--ignore-submodules=none", "--")
    };
  } catch {
    return {};
  }
}

function readGitHubOriginRepository(root) {
  try {
    return parseGitHubRepository(gitOut(root, "config", "--get", "remote.origin.url"));
  } catch {
    return null;
  }
}

function parseGitHubRepository(remote) {
  const normalized = remote.replace(/\.git$/, "");
  const https = normalized.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)$/);
  if (https) return https[1];
  const ssh = normalized.match(/^git@github\.com:([^/\s]+\/[^/\s]+)$/);
  if (ssh) return ssh[1];
  return null;
}

function gitOut(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function gitSucceeds(root, ...args) {
  return spawnSync("git", args, {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"]
  }).status === 0;
}
