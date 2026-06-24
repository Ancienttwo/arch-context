# Practice Assets v1 Operations

This runbook owns Practice Assets v1 authoring, promotion, waiver, Hook,
Context7, source update, license incident, false-positive rollback, review, and
rollout operations.

## Authority Boundary

Practice Assets v1 has two inputs with different trust levels:

- Static Practice Assets are built-in YAML assets under
  `packages/core/practice-catalog/assets/` plus explicit repo overlays under
  `.archcontext/practices/`. They are deterministic, provenance checked, and
  shipped in the `archctx` package.
- Dynamic Documentation References are optional Context7 resources. They are
  external, unverified, advisory-only data in `resources`; they never become
  built-in practices, complete-stage checks, or repo policy by themselves.

Local Core remains usable with no GitHub App, Cloud account, LLM provider, or
Context7 provider. Hook, checkpoint, prepare, complete, and practice validation
must continue to work with `egress: none`.

## Write A Repo Practice

1. Put the overlay in `.archcontext/practices/<category>/<id>.yaml`.
2. Use `schemaVersion: archcontext.practice/v1`.
3. Give the asset a stable dotted `id`, integer `revision`, `status`, category,
   tags, scope, triggers, evidence policy, guidance, checks, enforcement,
   provenance, and lifecycle fields.
4. For a repo override, set `overlay.mode` to `replace` or `disable`.
5. Keep the guidance original. Source records can inform the practice, but do
   not copy external source text into the asset.
6. Run:

   ```bash
   archctx practices validate --strict
   archctx practices show <practice-id> --json
   ```

Authoring invariants:

- Candidate terms are recall hints only.
- Enforcement requires deterministic evidence and repo opt-in.
- Reference-only sources stay out of built-in practice assets.
- Repo overlays are read only from `.archcontext/practices/`; path traversal,
  symlink escape, and repository escape remain invalid.

## Promote Enforcement

Built-in practices are advisory by default. Promote a practice only from repo
policy:

```yaml
schemaVersion: archcontext.practice-policy/v1
mode: active
rules:
  - practiceId: modularity.no-new-cycle
    enforcement: complete
    checker: dependency-cycle
```

Promotion rules:

- Use `.archcontext/policies/practices.yaml`.
- Keep `mode: advisory` to disable enforcement without deleting policy history.
- Promote only registered deterministic checkers.
- Do not promote heuristic-only matches, task text, Context7 resources, LLM
  output, or unknown checker results.
- Run `archctx prepare`, `archctx checkpoint`, and `archctx complete` on the same
  task session before treating the policy as active.

## Add A Waiver

Use the CLI so waiver writes stay inside the ChangeSet approval boundary:

```bash
archctx practices waive \
  --practice-id modularity.no-new-cycle \
  --owner team-architecture \
  --reason "External migration window requires this edge until cutover." \
  --expires-at 2026-07-24T00:00:00.000Z \
  --evidence-digest sha256:<64-hex> \
  --subject module.a->module.b
```

Then review and apply the generated ChangeSet. Waiver invariants:

- Files live under `.archcontext/waivers/`.
- Owners must come from the repo model owner registry.
- Waivers must be exact-scope, unexpired, and bound to the current evidence
  digest.
- Expired, tampered, overscoped, or ownerless waivers do not suppress complete
  enforcement.

## Connect A Central Hook

Active Hook execution is central-first. Configure the Agent Host to call the
packaged adapter rather than vendoring runtime scripts into this repository:

```bash
archctx hooks install --host codex
archctx hooks status --host codex
```

Expected adapter path:

```text
~/.codex/hooks.json -> repo-harness-hook -> archctx hook checkpoint
```

Hook invariants:

- The hook is a trigger only; the daemon remains the decision owner.
- `archctx hook checkpoint` is local RPC only, has `network: forbidden`, and
  fail-opens when the daemon is unavailable.
- Do not set `"hook_source": "repo"` unless doing an explicitly reviewed
  repo-local hook runtime override.

## Pin Context7 And Preserve Privacy

Context7 is optional and manual by default.

```bash
archctx docs status
archctx docs resolve --allow-network --library React --query "state hooks"
archctx docs pin --library-id /facebook/react --version 18.2.0 --approved
archctx docs fetch --allow-network --library-id /facebook/react --intent "state hooks"
archctx docs purge --all
```

Privacy invariants:

- Resolve and fetch require `--allow-network`.
- Pins live in `.archcontext/integrations/context7.lock.yaml`.
- The provider gets bounded library/query metadata, not source bodies, diffs,
  prompts, completions, secrets, or raw repository paths.
- Context7 content is `external-unverified` and `advisory-only`.
- Disabled, missing-key, no-network, rate-limit, timeout, or malformed-provider
  cases must leave Local Core prepare and complete results unchanged.

## Source Update Runbook

1. Create a curation PR that changes only the source record and dependent
   practice revisions.
2. Verify source license, usage policy, attribution text, upstream URL, pinned
   version or retrieval date, and digest.
3. Increment affected practice revisions. Do not reuse a revision for changed
   guidance.
4. Regenerate and verify catalog manifests:

   ```bash
   bun run record:s6:catalog
   bun run readback:s6:catalog
   archctx practices validate --strict
   ```

5. Run eval and release gates before merge:

   ```bash
   bun run readback:s6:eval
   bun run readback:s6:runtime
   bun run readback:fg6:npm-release-dry-run
   ```

## License Incident Runbook

1. Stop new release promotion for the affected practice ID or source ID.
2. Mark the source `reference-only` if redistribution is uncertain.
3. Disable or replace built-in practices that depend on a disallowed source.
4. Preserve historical revisions that are referenced by evidence, policy, or
   attestations; supersede rather than delete.
5. Regenerate package dry-run evidence and confirm `NOTICE.md` does not omit
   required attribution:

   ```bash
   bun run readback:fg6:npm-release-dry-run
   ```

6. Publish the incident note in the release gate and link the remediation PR.

## False-Positive Rollback Runbook

Use the smallest rollback that removes user pain while preserving evidence:

1. If the issue is an automatic hook interruption, disable automatic checkpoint
   hooks and keep manual checkpoint available.
2. If the issue is complete-stage blocking, set
   `.archcontext/policies/practices.yaml` to `mode: advisory`.
3. If the issue is a single governed subject, create an exact waiver with an
   expiry date and evidence digest.
4. If the issue is a bad built-in practice, supersede it with a corrected
   revision or set the repo overlay to `overlay.mode: disable`.
5. If the issue is Context7 data, run `archctx docs purge --all` and leave
   Context7 disabled until a new pin is reviewed.
6. Verify the rollback:

   ```bash
   archctx sync
   archctx prepare --task "<same task>"
   archctx checkpoint --task-session-id <same-session>
   archctx complete --task-session-id <same-session>
   ```

## Quarterly Asset Review

Owner: `team-architecture`.

Every quarter:

1. Review every source record with `reviewDate` older than 90 days.
2. Confirm source license, attribution, digest, and usage policy.
3. Confirm deprecated practices have `supersededBy` or an explicit retention
   reason.
4. Run catalog, eval, runtime, package, and local no-cloud readbacks.
5. Record the review date and owner in the release gate.

## Feature Flags And Rollout Readback

Roll out Practice Assets v1 in ordered phases:

1. Catalog only: users can list, show, and validate practices.
2. Advisory prepare: matching appears in prepare resources and guidance.
3. Central Hook checkpoint: opted-in Agent Hosts trigger local checkpoint.
4. Repo opt-in enforcement: `.archcontext/policies/practices.yaml` sets
   `mode: active` for specific deterministic checks.
5. Optional Context7: exact library/version pins are manually approved.

Rollback switches:

- Enforcement off: `practices.enforcement.mode: advisory`.
- Context7 off: no provider config or provider health `enabled: false`.
- Hook off: `practices.checkpointHooks.enabled: false` or remove host hook
  config with `archctx hooks remove --host <host>`.
- Package rollback: reinstall the previous `archctx` package and rerun
  `archctx daemon upgrade`.

Readback commands:

```bash
bun run readback:s3:hook-egress
bun run readback:s5:context7
bun run readback:s6:catalog
bun run readback:s6:runtime
bun run readback:fg6:npm-release-dry-run
bun run readback:fg6:local-product-tarball
bun run readback:fg6:rollback-compat
```

Do not claim design-partner, opt-in beta, or team rollout completion from these
commands. Collaboration rollout needs a separate real telemetry packet.
