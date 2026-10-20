# Projection writer: a rolling generated-only pull request

`archctx projection publish` keeps one rolling branch (default `archctx/projection`) equal to the
remote base tip plus exactly one commit that refreshes the generated architecture outputs, and
opens or updates its pull request. `archctx projection verify-pr` tells downstream CI whether a pull
request changes generated output only and whether that output is exactly what the projection
renders; see "Downstream CI" for what that does and does not prove. Design: `docs/adr/ADR-0048-projection-writer-rolling-pr.md`.

## What one run does

1. Validates `--base`, `--remote` and `--branch` (`archctx/...`, different from the base) before any
   Git operation that leaves the machine.
2. Takes the writer lock for this remote and base. A live holder gives `result: "busy"`.
3. Fetches `refs/heads/<base>` and resolves the base tip. If that tip was already published or found
   up to date, the result is `already-processed` and nothing else happens.
4. Resets the writer-owned worktree to the tip and asks that worktree's own `archctxd` to apply the
   projection (`projection run`, mode `apply`).
5. Checks that every changed path is a file the apply wrote and a projection-owned output, commits
   them, re-reads the remote base tip (a moved tip is re-evaluated, the stale commit is dropped),
   pushes with `--force-with-lease`, and calls the publisher.

| `result` | Meaning | Envelope |
|---|---|---|
| `published` | The rolling branch carries this base tip's projection; `pushed` says whether this run moved it. | ok |
| `up-to-date` | The base tip's committed projection is already current. Nothing is pushed; an open rolling PR stays open. | ok |
| `already-processed` | This base tip was already published or up to date. | ok |
| `human-action-required` | The apply needs a human decision (`humanActions[]`). Nothing is pushed. | ok |
| `busy` | Another writer holds the lock (`holderPid`). | ok |
| `failed` | `error.code` / `error.reasonCode` say why. | `ok: false`, exit 1 |

## Set up an always-on host

1. Clone the repository once and configure a Git identity for it (`git config user.name`,
   `git config user.email`). Push credentials are whatever `git push` already uses on this host.
2. With the default `gh` publisher, run `gh auth login` as the same user. archctx stores no
   credential. If `gh` cannot tell which repository to target from the remotes, run
   `gh repo set-default`, or use `--publisher command`.
3. Run one publish by hand:

   ```sh
   archctx projection publish --json
   ```

4. If the repository requires code facts (`codeFacts.required: true`), the first run fails with
   `AC_CODE_FACTS_UNAVAILABLE`, and the message names the owned worktree. Index it once:

   ```sh
   codegraph init "$(archctx projection publish-status --json | jq -r .data.worktreePath)"
   ```

   The writer never runs `codegraph init` itself. The index is gitignored, so `git clean -ffd`
   (no `-x`) keeps it across runs. `.codegraph/` must be gitignored in the repository; an
   untracked index would be a non-owned change and fail the run.

5. Keep it running. With launchd (`KeepAlive`) or systemd (`Restart=always`), run the foreground
   loop; it writes one JSON envelope line per run and exits 0 on SIGINT or SIGTERM:

   ```sh
   archctx projection publish --follow --interval 300
   ```

   Or run a one-shot from cron. Concurrent runs are safe: a second run gets `busy`.

Options: `--base` (default `main`), `--remote` (default `origin`), `--branch` (default
`archctx/projection`), `--publisher gh|command|none`, `--publisher-command <executable>`,
`--accept-observed-major-change`, `--follow`, `--interval <seconds>` (default 300, minimum 30).
`archctx projection publish --help` prints them.

### Command publisher

`--publisher command --publisher-command /path/to/publish` runs that executable with no shell and
no arguments in the owned worktree. Its environment is only `PATH`, `HOME` and:
`ARCHCTX_PUBLISH_REMOTE`, `ARCHCTX_PUBLISH_BASE`, `ARCHCTX_PUBLISH_BRANCH`,
`ARCHCTX_PUBLISH_BASE_SHA`, `ARCHCTX_PUBLISH_COMMIT`, `ARCHCTX_PUBLISH_TITLE`,
`ARCHCTX_PUBLISH_BODY_FILE`. It may print a JSON object `{"url": "...", "number": 12}`; other
output is ignored. A non-zero exit is a publisher failure: the pushed commit is recorded and the
next run retries only the publisher.

On Windows the environment also carries, when they are set, the variables a Windows process needs
to start: `SystemRoot`, `windir`, `ComSpec`, `PATHEXT`, `TEMP`, `TMP` and `USERPROFILE` (matched
case-insensitively; only the first spelling is forwarded). Windows cannot run a `#!` script
directly, so a command whose first line is a shebang runs as `<interpreter> [args] <command>`: the
interpreter is the basename of the shebang's first token without `.exe` (`#!/bin/sh` runs `sh`), or
the next token after `env` (`#!/usr/bin/env node` runs `node`). The interpreter must be on `PATH`;
if it is not, the publisher fails and names it, with no search of other locations. A command
without a shebang runs directly. `.cmd` and `.bat` commands are rejected on Windows because they
only run through `cmd.exe`, which is a shell.

### Major changes

By default a major architecture change stops at `human-action-required` and nothing is pushed.
`--accept-observed-major-change` sends `acceptObservedMajorChange` with the apply, exactly as an
agent could. Use it only on a host whose operator accepts every change merged into the base.

## Read the state

```sh
archctx projection publish-status --json
```

It reports `worktreePath`, a `running` writer's pid, `lastProcessedSha` (the last base tip a run
evaluated), `lastSuccessfulSha` (the last base tip published or found up to date) and `lastRun`.
It is read-only and starts nothing.

## Downstream CI: what `verify-pr` proves

On the pull request's head commit, with the base fetched:

```sh
archctx projection verify-pr --base origin/main --json
```

A changed path counts as generated only when it is the projection manifest
(`docs/architecture/.projection-manifest.json`), a `targets[*].path` of that manifest, or an
agent-context target path of the model, at HEAD or at the merge base. Everything else is
non-generated, including hand-written documents under `docs/architecture/` that no target renders.
For a mixed-ownership target (manifest `ownership: "mixed"`, and every agent-context contract file)
the text outside the generated regions must also be byte-identical between the merge base and
HEAD; otherwise the path is a human edit (`humanEditedPaths`, also listed in `nonGeneratedPaths`).

| `verdict` | Meaning |
|---|---|
| `touches-non-generated` | Some changed path is not generated output, or a mixed target's text outside its generated regions changed (`nonGeneratedPaths`, `humanEditedPaths`). Answered from the diff alone; nothing is rendered. |
| `generated-only-render-equivalent` | Every changed path is generated output, the generated files and generated regions at HEAD equal a fresh render there (`projection check` is `noop`, and each changed agent-context file equals the agent-context render), and no text outside the generated regions changed. |
| `generated-only-not-render-equivalent` | Generated output only, but it differs from a fresh render (`differingPaths`), for example a hand edit inside a generated region. |
| `no-changes` | The diff against the merge base is empty. |

`generated-only-render-equivalent` proves that the pull request carries the projection's own render
of HEAD and nothing else. It does not judge the rendered content: a change to the model or the
source that the projection faithfully renders is still a change someone may want to review on the
base branch. Gate automation on `data.verdict`; the envelope is ok for every valid evaluation.

Conservative cases, by design, report `touches-non-generated` and fall back to full review or CI:

- a mixed target (module document, index, changelog, agent-context file) that the pull request
  adds or deletes, including a writer pull request that creates or removes a module document;
- a mixed target whose generated-region markers are unbalanced or cannot be parsed on either side;
- any hand-written file under `docs/architecture/`.

A dirty tracked worktree fails with `AC_PRECONDITION_FAILED`. The fast path
(`touches-non-generated`) needs no code facts; a generated-only diff renders like
`projection check` and needs code facts when the manifest requires them.

## Egress

Every outbound step uses the `projection-publishing` channel
(`docs/runbooks/local-egress-policy.md`). `ARCHCONTEXT_EGRESS_MODE=local-only` makes `publish` fail
with `AC_POLICY_VIOLATION` before the first fetch. `publish-status` and `verify-pr` are local.

## Recovery

- Known residual race: when a dead writer's lock is taken over, three runs starting within the same
  few milliseconds can leave two of them believing they hold the lock. A racing push then fails its
  `--force-with-lease` instead of overwriting, and no run can commit anything but projection-owned
  outputs; rerun to converge. A single `--follow` loop or a cron job with a sane interval does not
  hit it. ADR-0048 records it; an advisory `flock` is the planned fix.
- `busy` with no writer running: the lock names a live pid. If that process is not an archctx
  writer, stop it or remove the lock in the writer directory. A dead pid's lock is recovered
  automatically.
- `projection-writer-state-invalid` or a worktree you no longer trust: stop the owned worktree's
  daemon (`archctx daemon stop` run inside `worktreePath`, or `archctx daemon list` then
  `archctx daemon stop --workspace-id <id>`), delete the writer directory (the parent of
  `worktreePath` in `publish-status`), then run `git worktree prune` in the repository. The next
  run recreates both; the remote branch and pull request are untouched.
- `projection-publisher-failed`: fix `gh` or the publisher command and run again; only the
  publisher is retried.
- `projection-writer-commit-failed`: configure a Git identity for the repository.
- `projection-writer-non-owned-change`: the apply changed a path outside the projection-owned
  outputs. Nothing was pushed; investigate the listed paths (for example an untracked, unignored
  index or cache in the worktree).
