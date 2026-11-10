# archctx / archctx-contracts 0.13.0 preparation

Baseline: `origin/main@a8ebbeef`, the archimap refresh for the state machine model kind (#528).

## Changes

- **#510, #512, #511: the state machine model kind (ADR-0054).** A new model kind, `archcontext.state-machine/v1`, lives in `.archcontext/model/state-machines/`; `archctx validate` checks it cross-entity rules, `archctx state-machines check` runs the built-in check (unreachable states, dead steps, deadlocks, `never` and `final` rules with the guards that protect them), the same check reports per-anchor status against the anchored code, and the capability projection renders a statechart section for a capability that declares one. The debt contract gains the `state-machines` check and two kinds. The new surfaces are listed under Release notes.
- **#504: pinned projection publication.** `archctx projection publish --base-sha <sha>` publishes only for one checked base commit and ends with `projection-writer-base-moved` when the remote base points elsewhere. #521 documents the flag and the failure in `docs/runbooks/projection-writer.md`.
- **#518: schema refusals.** `architecture-state-machine.schema.json` refuses the characters that break a rendered table (`|`, a backtick, a line break) in a rule `tracking` URL, a code-source `path` and a `symbol`, and selects the event `source` branch by `kind` so a refusal names the field that is wrong.
- **#509: agent job transitions.** A job status UPDATE applies only when the current status lists the target in `AGENT_JOB_STATE_TRANSITIONS`; a refused write fails `AC_PRECONDITION_FAILED` / `job-transition-invalid`. `failed -> queued` joins the table so that `archctx jobs retry` works on a failed job.
- **#514, #521, #513, #524, #528: repository only.** The publication policy accepts its own merge evidence, the projection-writer runbook gains `--base-sha`, ADR-0054 is proposed, and the generated architecture outputs and the archimap are refreshed. No product behavior change.

## Release notes

Use this section as the GitHub Release notes file.

> **archctx / archctx-contracts 0.13.0 adds a state machine model kind and pins projection publication to a base commit.** Nothing was removed.
>
> New surfaces:
>
> - `archctx state-machines check [--json]`. It reads `.archcontext/model/state-machines/` and returns `archcontext.state-machine-check/v1`: per machine, the reachable global state count, the transitions, each declared rule as `holds`, `broken`, `finding-open` or `finding-resolved` with the shortest path to a break, the guards that protect a holding rule, every `unreachable-state`, `dead-step` and `deadlock`, and the status of each code anchor (`confirmed`, `anchor-unconfirmed`, `anchor-changed`, `anchor-missing-path`, `anchor-missing-symbol`, `anchor-ambiguous-symbol`, `anchor-language-unsupported`, `unchecked`). It starts no daemon, writes nothing and needs no CodeGraph index; a symbol anchor without an index is `unchecked`.
> - `archctx projection publish --base-sha <sha>`. It takes 40 lowercase hex characters, refuses `--follow`, and fails `AC_PRECONDITION_FAILED` / `projection-writer-base-moved` with `expectedBaseSha`, `actualBaseSha` and `retryable: true` when the remote base moved, instead of re-evaluating. Documented in `docs/runbooks/projection-writer.md`.
> - The `state-machine` model kind. `.archcontext/model/state-machines/<id>.yaml` carries `schemaVersion: archcontext.state-machine/v1`, a `capabilityId`, finite-state `regions` (each optionally anchored to code), `events` with atomic `steps`, and `never` / `final` rules that may carry a `finding.tracking` URL. `archctx validate` lists the cross-entity issues in its model errors as `<path>: <field>: <invariant>`, for `state-machine-id-duplicate`, `state-machine-capability-missing`, `state-machine-initial-unknown`, `state-machine-region-unknown`, `state-machine-state-unknown`, `state-machine-step-source-missing` and `state-machine-product-too-large`; a reader that loads the machines instead fails `AC_SCHEMA_INVALID` / `state-machine-model-invalid` with `issues`, `issueCount` and `omittedCount`. The directory joins the committed model paths, so a ChangeSet is required to write it.
> - The capability projection renders `### 2.1 狀態機` in a capability document that declares a machine: one `stateDiagram-v2` per machine, the reachable-state and transition counts, each rule with its status, and the guards that protect it. `renderArchitectureDocumentationProjection` takes an optional `stateMachines` input.
> - The architecture debt contract reports the `state-machines` check after `flows`, with the kinds `state-machine-rule` and `state-machine-stale`, so `archctx checkpoint` and `archctx complete` report a stale anchor as debt. `architecture-debt.schema.json` now requires exactly six checks.
> - `archctx jobs retry` and `archctx jobs cancel` now apply the transition table: a refused status write fails `AC_PRECONDITION_FAILED` / `job-transition-invalid` with `jobId`, and `failed -> queued` is allowed.
> - The `state-machines-check` failure stage in `FAILURE_STAGES`, so a classified failure from the check carries it, and the `state-machines.check` request id in the CLI envelope.
> - Two new schemas: `schemas/repo/architecture-state-machine.schema.json` and `schemas/runtime/state-machine-check.schema.json`.
> - `archctx-contracts` exports the state machine contract: `STATE_MACHINE_SCHEMA_VERSION`, `STATE_MACHINE_CHECK_SCHEMA_VERSION`, `STATE_MACHINE_PRODUCT_LIMIT`, `stateMachineModelIssues`, `stateMachineModelIssuesByMachine` and the types `StateMachineV1`, `StateMachineRegion`, `StateMachineState`, `StateMachineStep`, `StateMachineEvent`, `StateMachineCodeSource`, `StateMachineEnvironmentSource`, `StateMachineRule`, `StateMachineNeverRule`, `StateMachineFinalRule`, `StateMachineFinding`, `StateMachineInvariant`, `StateMachineIssue`, `StateMachineGlobalState`, `StateMachinePathStep`, `StateMachineGuard`, `StateMachineRuleStatus`, `StateMachineRuleResult`, `StateMachineBreak`, `StateMachineMachineReport`, `StateMachineRuleCheckV1`, `StateMachineAnchorStatus`, `StateMachineAnchor`, `StateMachineCheckMachineV1` and `StateMachineCheckReportV1`. `ARCHITECTURE_DEBT_CHECKS` gains `state-machines` and `ARCHITECTURE_DEBT_KINDS` gains `state-machine-rule` and `state-machine-stale` in place, so both stay `v1`. The JSON Schema validator now supports `propertyNames`, `minProperties` and `maxProperties`.
>
> Unchanged: every CLI command and flag that existed in 0.12.0, the existing reason codes, the projection manifest schema, both projection profiles, RPC v2, the SQLite migrations and the renderer versions (`archcontext.docs-renderer/v6`, `archcontext.agent-context-renderer/v1`). CodeGraph stays at 1.6.2, Bun at 1.4.3, and Node at `>=22.22 <26`.

## Compatibility

Nothing was removed in 0.13.0: every CLI command, flag, reason code, schema and `archctx-contracts` export that 0.12.0 shipped is still there. Upgrade `archctx` and `archctx-contracts` together, because the version authorities and the fixture set move together.

Additive surfaces are safe to ignore. A consumer that reads the architecture debt envelope now sees a sixth `checks` row, `state-machines`; the schema requires it, so a consumer that validates the envelope against the shipped schema must accept six rows. `ARCHITECTURE_DEBT_CHECKS` and `ARCHITECTURE_DEBT_KINDS` grew in place and their schema version stays `archcontext.architecture-debt/v1`. A capability that declares no machine renders no statechart section, so its document is byte-identical to 0.12.0. `--base-sha` is optional, and a `projection publish` without it behaves as in 0.12.0.

Unchanged: the reason codes of kept surfaces, the projection manifest schema, both projection profiles, the renderer versions, RPC v2, the remaining SQLite migrations and the remaining model kinds. `ARCHCONTEXT_SCHEMA_SET_VERSION` stays `2026-07-11.explorer-view-v2`. CodeGraph stays at 1.6.2, Bun at 1.4.3, and Node at `>=22.22 <26`.

## New in the published payload

The `archctx` tarball ships the whole `schemas/` tree, because the root package has no `files` allowlist. The tree goes from 77 files in 0.12.0 to 79, and all of the change is new files:

- `schemas/repo/architecture-state-machine.schema.json` is new, so `schemas/repo/` goes from 14 to 15 files.
- `schemas/runtime/state-machine-check.schema.json` is new, so `schemas/runtime/` goes from 57 to 58 files.

`schemas/runtime/architecture-debt.schema.json` changes in place: `checks` goes from five rows to six, and the kind enum gains two values. Neither new file is in `RELEASE_SCHEMA_FILES` in `scripts/fg6-npm-release-dry-run.ts`, which lists only the practice schemas the dry run validates directly; that list is not an allowlist for packaging. Readback should confirm that both new files are present in the built tarball rather than assume it.

## Evidence and remaining gates

- [x] Version authorities synchronized: the root and package manifests, `bun.lock`, `product-version.ts`, the contracts fixtures (`archctx-capabilities`, `product-version-manifest`) and the practice catalog manifest. `catalogDigest` was regenerated from `loadPracticeCatalog` and cross-checked against `digestJson` over the manifest body.
- [ ] Release-candidate PR head: hosted full/matrix Verify passes before merge.
- [ ] Rebuild both package tarballs from accepted main, and read back the version, the contents (including the two new schemas) and the digests.
- [ ] Publish interactively with npm web authentication. Wait for both registry versions, then read back version, dist-tag and integrity.
- [ ] Create the tag and GitHub Release only for the published commit, using the Release notes above.

Publication procedure: `docs/runbooks/npm-release.md`.

## Publication boundary

After the release-candidate PR merges, rebuild both tarballs from accepted main. Publishing is a separate step: publish interactively, wait for both registry versions, and read back version, dist-tag and integrity. Do not republish an accepted upload while it is processing. Create the tag and GitHub Release only for that published commit.

Reverting the candidate before publication restores the 0.12.0 version authorities. Published versions are immutable, so a fix after publication needs a new version.
