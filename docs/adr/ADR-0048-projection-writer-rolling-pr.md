---
schemaVersion: archcontext.adr/v1
id: adr.0048.projection-writer-rolling-pr
title: Projection Writer Mode and the Rolling Generated-Only Pull Request
status: proposed
decidedAt: 2026-10-20
appliesTo:
  - module.architecture-context.contracts
  - component.architecture-context.local-runtime.egress-admission
  - component.architecture-context.local-runtime.projection-service
  - component.architecture-context.local-runtime.runtime-daemon
  - component.architecture-context.surfaces.cli
supersedes: []
---

# ADR-0048: Projection Writer Mode and the Rolling Generated-Only Pull Request

## Context

The committed architecture projection (`docs/architecture/**` and the agent-context contract
files the model designates) goes stale whenever a declared source footprint moves. Today the only
writer is whoever runs `projection run` in `apply` mode in their own checkout, so the refresh
lands inside unrelated feature branches, or not at all. Teams want the refresh to arrive on its
own: one pull request that carries only generated output, that CI can check mechanically for
being exactly the projection's render, and that never races a human branch.

`archctxd` is a per-worktree, request-driven RPC server. ADR-0005 makes it the single writer of
*its own* worktree. It has no periodic loop and no outbound push authority, and adding either
would turn a local query/write service into a scheduler with network side effects.

## Decision

### 1. The writer is a client, not a daemon mode

`archctx projection publish` is a client of the existing projection protocol. It owns a detached
worktree under the repository's runtime state directory
(`<repositoryStateDir>/projection-writer/<sha256(remote \0 base)[:16]>/worktree`), shared by
every checkout of the repository because the repository state directory is keyed by the Git
common dir. Each run resets that worktree to the fetched base tip (`git reset --hard`,
`git clean -ffd` without `-x`, so a gitignored CodeGraph index survives) and sends one
`ProjectionRequestV1` in `apply` mode to that worktree's own `archctxd`. There is no second write
path: the ChangeSet the daemon applies is exactly what `projection run` would apply.

`--follow` is a foreground loop in the CLI process (one run per interval, one JSON line per run,
SIGINT/SIGTERM stop it). It exists so launchd or systemd `KeepAlive` can own its lifetime; the
daemon gains no scheduler.

### 2. One rolling branch, base tip plus exactly one commit

- The writer pushes only to `refs/heads/archctx/*`; `--branch` must start with `archctx/` and
  differ from `--base`, checked before any fetch.
- Every changed path in the worktree must be a file the apply reported writing **and** a
  projection-owned output (`projectionOwnedPaths(model)`); otherwise the run fails with
  `AC_POLICY_VIOLATION` and nothing is committed or pushed.
- The commit is `chore(projection): refresh generated architecture outputs for <base>@<sha12>`
  with an `Archctx-Projection-Source: <baseSha>` trailer, pushed with
  `--force-with-lease=refs/heads/<branch>:<observed tip>`.
- Latest wins: after committing, the remote base tip is re-read; if it moved, the stale commit is
  dropped and the run re-evaluates the new tip (at most three times).
- Same SHA is a no-op once the run for that base ended `published` or `up-to-date`. A run whose
  push succeeded but whose publisher failed records the pushed commit, so the rerun retries only
  the publisher while the remote branch still carries that commit.
- One run per (remote, base) at a time: an `O_EXCL` private lock file holding `{pid, startedAt}`.
  A live owner gives `busy`; a dead owner's lock is removed and retried once.

### 3. Publishers hold no credentials

`ProjectionPublisherPort.ensurePullRequest` opens or updates the pull request:

- `gh` (default) runs the operator's own `gh` (ambient `gh auth`) in the owned worktree with no
  shell and `GH_PROMPT_DISABLED=1`: `gh pr list`, then `gh pr edit` or `gh pr create`.
- `command` runs an operator-supplied executable with no shell or arguments and an environment of
  `PATH`, `HOME` and the `ARCHCTX_PUBLISH_*` inputs only, plus, on Windows, the process-start
  variables `SystemRoot`, `windir`, `ComSpec`, `PATHEXT`, `TEMP`, `TMP` and `USERPROFILE` when set.
  On Windows a `#!` command runs through its shebang interpreter resolved on `PATH` (a missing
  interpreter fails closed), and `.cmd`/`.bat` commands are rejected because they need `cmd.exe`.
- `none` pushes only.

The pull request body lists paths only, never file contents, and is written to a private temp
file outside the repository that is removed after the call.

### 4. Egress

All outbound steps (`git fetch`, `git ls-remote`, `git push`, `gh`, the publisher command) are
admitted on a new `projection-publishing` channel. Like `npm-update-check` it is an explicit
operator action, not configured state, so it is not part of `doctor`'s effective channels.
`ARCHCONTEXT_EGRESS_MODE=local-only` refuses the command with `AC_POLICY_VIOLATION` before the
first fetch.

### 5. Downstream verification without trusting the author

`archctx projection verify-pr --base <ref>` diffs the merge base against the checked-out `HEAD`
(clean tracked worktree, no rename detection). It is deliberately narrower than
`projectionOwnedPaths`, the writer's commit filter, which globs all of `docs/architecture/**`
where hand-written documents the renderer never touches also live:

- A changed path is generated only when it is the projection manifest, a manifest
  `targets[*].path`, or an agent-context target path, at HEAD or at the merge base. Anything else
  is non-generated.
- A mixed-ownership target (manifest `ownership: "mixed"`, and every agent-context target) must
  keep its text outside the generated regions byte-identical, delimited with the projection's own
  region parsers. A difference, unparseable or unbalanced markers, or a mixed target that is added
  or deleted makes it a human edit (`humanEditedPaths`, also in `nonGeneratedPaths`).
- Any non-generated path gives `touches-non-generated` from the diff alone, without rendering.
- Otherwise the in-process `check` runs, and each changed agent-context file is compared with the
  agent-context render (which `check` does not cover). `generated-only-render-equivalent` means the
  generated files and generated regions at HEAD equal a fresh render there and no text outside the
  regions changed. It proves provenance, not desirability, of the rendered content.

This is conservative: a writer pull request that creates or deletes a mixed document is reported
`touches-non-generated` and gets full CI. The verdict carries the decision; the envelope has no new
exit-code semantics.

### 6. Contracts

`ProjectionPublishRunV1`, `ProjectionPublishStatusV1` and `ProjectionPrVerificationV1` are
published under `schemas/runtime/`, advertised by the `projection-publish-v1` and
`projection-verify-pr-v1` features.

## Invariants

- The writer never pushes to any ref outside `archctx/`, and never to the base.
- The pushed rolling branch is always the base tip plus one commit that touches projection-owned
  outputs only.
- The writer's apply goes through the owned worktree's daemon; the writer never writes generated
  files itself.
- archctx stores no credential for publishing.

## Non-goals

- No GitHub App and no credential storage.
- No push to anything but `archctx/*`.
- No automatic close of stale pull requests: an up-to-date base leaves an open rolling pull request
  in place for a human to close.
- No automatic `codegraph init`: when code facts are required and the owned worktree has no index,
  the run fails with `AC_CODE_FACTS_UNAVAILABLE` and names the one-time `codegraph init <worktree>`.
- No automatic acceptance of an observed major change; that requires
  `--accept-observed-major-change`, and the default stops at `human-action-required`.

## Consequences

- A single always-on host can keep the projection current for a repository with one rolling pull
  request, and a downstream CI job can establish mechanically (`generated-only-render-equivalent`)
  that the pull request carries only the projection's render and no human text change.
- The writer's worktree and its daemon live under the operator's runtime state directory; deleting
  `<repositoryStateDir>/projection-writer/<key>` resets the writer completely.
- Reusing the protocol means the writer inherits its preconditions: a manifest that needs an
  upgrade, an adoption or a human decision stops the writer the same way it stops an agent.
- Residual risk, accepted: the lock is a private `O_EXCL` file, and a stale lock is taken over by
  renaming it aside and re-reading it. If three runs race within milliseconds during that takeover,
  two of them can each believe they hold the lock. The impact is bounded: every push uses
  `--force-with-lease` against the tip the run observed, so a racing push fails instead of
  overwriting, and every commit is limited to projection-owned outputs the apply wrote. An advisory
  `flock` on the lock file is the future fix.

See `docs/runbooks/projection-writer.md` for operation.
