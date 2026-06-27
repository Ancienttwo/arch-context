# Architecture Ledger Operations Runbooks

> Status: AL10 operational runbooks for local-first beta rollback and recovery
> Sprint: `plans/sprints/archctx-architecture-ledger-sprint-checklist.md`

These runbooks cover architecture-ledger incidents, SQLite corruption recovery,
ledger/YAML drift recovery, provider disable, and full rollback to YAML
authority. They operate inside Local Core. They do not authorize SQL-only
recovery, direct SQLite edits, raw source or diff capture, or subagent writes to
architecture authority.

## Shared Rules

- Treat `.archcontext/` Git projections as the collaboration and rebuild
  boundary until an explicit promotion decision changes that.
- Treat `runtime.sqlite` as operational state. Do not commit SQLite files, WAL
  files, daemon locks, logs, or local `_ops/` output to Git.
- Use daemon-owned commands for all ledger-affecting writes.
- Capture incident notes with IDs, counts, digests, reason codes, timestamps,
  command names, and sanitized paths only.
- Do not paste source bodies, raw diffs, prompt/completion bodies, provider
  tokens, private keys, or full CodeGraph output into runbooks, tickets, logs,
  or evidence packets.
- Stop at `yaml` mode whenever corruption, replay mismatch, projection drift, or
  provider uncertainty could affect user work.

Common read-only triage:

```bash
archctx status --json
archctx doctor --json
archctx paths --json
archctx ledger state
archctx ledger drift --json
archctx docs drift
archctx agents budget --format json
archctx jobs stats --format json
```

## incident

Signal: An architecture-ledger operation reports `AC_CONTEXT_STALE`,
`AC_PRECONDITION_FAILED`, replay/materialized digest mismatch, repeated hook
fail-open, daemon startup failure, or unexpected ledger drift after a migration,
projection, checkpoint, or complete task.

Triage:

```bash
archctx status --json
archctx doctor --json
archctx paths --json
archctx ledger state
archctx ledger drift --json
archctx docs drift
archctx jobs list --status queued,running,failed,expired --format json
```

Containment:

1. Do not run `ledger-authoritative` promotion or new enforcement promotion.
2. Set the local session to YAML-safe mode:

   ```bash
   ARCHCONTEXT_LEDGER_MODE=yaml
   ARCHCONTEXT_LEDGER_READ_MODE=yaml
   ARCHCONTEXT_LEDGER_WRITE_MODE=yaml
   ```

3. Leave hooks fail-open. Do not convert hook failures into user-work blockers.
4. Preserve current Git state and collect only metadata: HEAD, worktree digest,
   request IDs, graph digests, reason codes, and command outputs.

Remediation:

```bash
archctx sync
archctx validate
archctx ledger drift --json
archctx docs drift
bun run readback:al10:hardening
bun run readback:al10:chaos-security
```

If drift or replay mismatch remains, choose the drift or corruption runbook
below. If privacy markers appear in output, stop release promotion and run:

```bash
archctx privacy-audit
bun run verify
```

Verification:

- `archctx ledger drift --json` reports no unresolved drift or a documented
  reconciliation command.
- `archctx docs drift` is clean before `archctx complete`.
- Hook output remains fail-open with `egress: none` and `network: forbidden`.
- Incident record contains no source bodies, raw diffs, prompts, completions, or
  secrets.

## corruption-recovery

Signal: SQLite integrity check fails, `runtime.sqlite` cannot be opened, local
store schema migrations are incomplete, WAL/SHM files are inconsistent, or the
daemon reports local-store corruption.

If the target `runtime.sqlite` is an older ArchContext local-store schema and no
repo-local legacy source exists, current runtimes upgrade it in place through the
normal SQLite migration path. Unrelated SQLite files, malformed files, and
untrusted repo-local legacy sources still require operator repair or isolation;
the daemon must not silently adopt them.

Triage:

```bash
archctx paths --json
archctx doctor --json
archctx ledger state
ARCHCONTEXT_LEDGER_MODE=yaml archctx validate
```

Containment:

1. Stop `archctxd` if it is running.
2. Do not edit SQLite with `sqlite3`.
3. Copy or move the reported `runtime.sqlite`, `runtime.sqlite-wal`, and
   `runtime.sqlite-shm` files outside active state for later local inspection.
4. Keep Git `.archcontext/` files unchanged until drift is understood.

Remediation:

```bash
ARCHCONTEXT_LEDGER_MODE=yaml archctx sync
ARCHCONTEXT_LEDGER_MODE=yaml archctx validate
archctx status --json
archctx ledger rebuild --from-git --expected-worktree-digest <current>
archctx ledger drift --json
bun run readback:al10:release-packaging
```

If rebuild proposes external projection acceptance, review the reported reason
codes and only then run:

```bash
archctx ledger rebuild --from-git --accept-external-projection --expected-worktree-digest <current>
```

Verification:

- Rebuilt local store passes `archctx doctor --json`.
- `archctx ledger state` returns a graph digest and current schema.
- `archctx ledger drift --json` is clean or has a single explicit reconcile
  command.
- AL10 release-packaging readback still verifies migration compatibility.

## drift-recovery

Signal: `archctx ledger drift --json`, `archctx docs drift`, `complete_task`, or
AL10 replay evidence reports nonzero drift between ledger state, Git
`.archcontext/` projections, and generated architecture docs.

Triage:

```bash
archctx status --json
archctx ledger drift --json
archctx docs drift
git status --short
```

Decision:

- If Git `.archcontext/` is the reviewed source, rebuild ledger from Git.
- If ledger state is the reviewed source and Git projections are stale, project
  ledger to Git through ChangeSet.
- If neither side is clearly reviewed, stay in YAML mode and create a manual
  architecture review task before any write.

Remediation from reviewed Git:

```bash
archctx status --json
archctx ledger rebuild --from-git --expected-worktree-digest <current>
archctx ledger drift --json
```

Remediation from reviewed ledger:

```bash
archctx ledger project --to-git --dry-run
archctx status --json
archctx ledger project --to-git --write --expected-worktree-digest <current>
archctx ledger drift --json
archctx docs drift
```

Documentation projection recovery:

```bash
archctx docs plan --id changeset.docs-drift-recovery
archctx docs apply --approved --id changeset.docs-drift-recovery --expected-worktree-digest <current>
archctx docs drift
```

Verification:

- `archctx ledger drift --json` reports clean drift after the chosen path.
- `archctx docs drift` reports clean projection drift.
- `archctx complete` is not run until both drift checks are clean.
- The PR includes reviewed Git projection changes when Git was updated.

## provider-disable

Signal: Context7, model provider, or subagent runner is failing, slow,
misconfigured, rate-limited, returning malformed output, or suspected of
injecting untrusted content.

Triage:

```bash
archctx docs status
archctx agents budget --format json
archctx jobs list --status queued,running,failed --format json
```

Containment:

```bash
unset OPENAI_API_KEY
unset ANTHROPIC_API_KEY
ARCHCONTEXT_CONTEXT7_ENABLED=0
ARCHCONTEXT_CONTEXT7_MODE=manual
archctx docs purge --all
```

Keep Local Core deterministic:

```bash
ARCHCONTEXT_CONTEXT7_ENABLED=0 archctx prepare --task "<task>"
ARCHCONTEXT_CONTEXT7_ENABLED=0 archctx checkpoint --task-session-id <session>
ARCHCONTEXT_CONTEXT7_ENABLED=0 archctx complete --task-session-id <session>
```

Subagent output remains proposal-only:

```bash
archctx investigate --runner-port fake-provider --event manual --risk high --uncertainty high
archctx agents status --status queued,running,failed --format json
```

Remediation:

1. Leave Context7 disabled unless a library/version pin has been reviewed.
2. Leave real model provider credentials unset until a deterministic run passes.
3. Reject malformed or tool-escape investigation output; do not copy it into
   docs, projections, policies, waivers, or ledger authority.
4. Use `fake-provider` for local readback when provider behavior itself is not
   under test.

Verification:

- `archctx docs status` shows Context7 disabled or manual-only.
- `archctx docs purge --all` reports the cache purge count.
- `prepare`, `checkpoint`, and `complete` still run without provider keys.
- Agent findings remain advisory-only and require deterministic validation.

## full-rollback

Signal: Ledger-authoritative mode blocks user work, migration verification
fails, drift cannot be reconciled quickly, SQLite corruption is suspected, or a
release decision requires reverting to YAML authority.

Triage:

```bash
archctx status --json
archctx ledger state
archctx ledger drift --json
git status --short
```

Rollback:

```bash
ARCHCONTEXT_LEDGER_MODE=yaml
ARCHCONTEXT_LEDGER_READ_MODE=yaml
ARCHCONTEXT_LEDGER_WRITE_MODE=yaml
archctx status --json
archctx ledger rollback --to-yaml --write --expected-worktree-digest <current>
ARCHCONTEXT_LEDGER_MODE=yaml ARCHCONTEXT_LEDGER_READ_MODE=yaml ARCHCONTEXT_LEDGER_WRITE_MODE=yaml archctx validate
```

The rollback command writes Git-visible YAML projections from the current ledger
state and records a backup manifest under
`.archcontext/backups/ledger-rollback/`. Review that backup before deleting it.

Post-rollback rebuild:

```bash
ARCHCONTEXT_LEDGER_MODE=yaml archctx sync
ARCHCONTEXT_LEDGER_MODE=yaml archctx ledger drift --json
ARCHCONTEXT_LEDGER_MODE=yaml archctx docs drift
bun run readback:al10:rollout-workflow
bun run readback:al10:hardening
bun run verify
```

Verification:

- `archctx status --json` reports YAML read and write authority.
- `.archcontext/backups/ledger-rollback/` contains the rollback backup manifest
  when Git-visible files were overwritten or removed.
- `archctx validate`, `archctx ledger drift --json`, and `archctx docs drift`
  are clean before normal development resumes.
- Any release note says rollback returned to YAML authority rather than claiming
  ledger GA readiness.
