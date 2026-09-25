# Plan: Handle remaining audit issues 162 164 171

> **Status**: Executing
> **Created**: 20260925-1345
> **Slug**: remaining-audit-issues
> **Planning Source**: codex-plan
> **Orchestration Kind**: host-plan
> **Source Ref**: (none)
> **Artifact Level**: work-package
> **Promotion Reason**: human_decision_boundary
> **Verification Boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260925-1345-remaining-audit-issues.contract.md --strict`.
> **Rollback Surface**: Before execution remove `plans/plan-20260925-1345-remaining-audit-issues.md`; after execution revert branch `codex/remaining-audit-issues` or the explicitly reviewed diff.
> **Spec**: `docs/spec.md`
> **Research**: See `docs/researches/`
> **Task Contract**: `tasks/contracts/20260925-1345-remaining-audit-issues.contract.md`
> **Task Review**: `tasks/reviews/20260925-1345-remaining-audit-issues.review.md`
> **Implementation Notes**: `tasks/notes/20260925-1345-remaining-audit-issues.notes.md`

## Agentic Routing
- Selected route: planning
- Routing reason: Captured from codex-plan planning output.
- Source ref: (none)
- Due diligence:
  - P1 map: See captured planning output below.
  - P2 trace: See captured planning output below.
  - P3 decision rationale: See captured planning output below.

## Workflow Inventory
Complete this inventory before implementation. If any line is unknown, keep the plan in Draft and fill it before projection.

- Active plan: `plans/plan-20260925-1345-remaining-audit-issues.md`
- Sprint contract: `tasks/contracts/20260925-1345-remaining-audit-issues.contract.md`
- Sprint review: `tasks/reviews/20260925-1345-remaining-audit-issues.review.md`
- Implementation notes: `tasks/notes/20260925-1345-remaining-audit-issues.notes.md`
- Deferred-goal ledger: `tasks/todos.md`
- Current checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Scope authority: `tasks/contracts/20260925-1345-remaining-audit-issues.contract.md` `allowed_paths`
- Concurrency rule: `.ai/harness/active-plan` selects the active plan for this worktree when present; `.ai/harness/active-worktree` records the owning worktree. If another worktree already owns active work, open or switch to the matching worktree instead of serializing unrelated plans.
- Execution isolation: approved contract-level work projects through `repo-harness run plan-to-todo --plan plans/plan-20260925-1345-remaining-audit-issues.md` and may start `repo-harness run contract-worktree start --plan plans/plan-20260925-1345-remaining-audit-issues.md`.

## Approach
### Strategy
Use the captured planning output below as the execution source of truth.

### Trade-offs
| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Captured plan | Preserves the approved Codex Plan or Waza think decision | Requires the captured text to be concrete enough to execute | Use |

## Detailed Design
### File Changes
| File | Action | Description |
|------|--------|-------------|
| See captured planning output | Follow | Implement only the approved scope named below |

### Code Snippets
See captured planning output.

### Data Flow
See captured planning output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Captured plan lacks enough detail | Medium | Execution may need clarification | Stop before implementation if the captured output contradicts repo rules or lacks concrete file targets |

## Task Contracts
- Contract file: `tasks/contracts/20260925-1345-remaining-audit-issues.contract.md`
- Review file: `tasks/reviews/20260925-1345-remaining-audit-issues.review.md`
- Implementation notes file: `tasks/notes/20260925-1345-remaining-audit-issues.notes.md`
- Template: `.claude/templates/contract.template.md`
- Verification command: `repo-harness run verify-contract --contract tasks/contracts/20260925-1345-remaining-audit-issues.contract.md --strict`
- Active plan rule: this captured plan is written to `.ai/harness/active-plan` and the owning worktree is written to `.ai/harness/active-worktree` unless --no-active is used. Do not infer active execution from the latest non-archived plan.

## Handoff

- Checks file: `.ai/harness/checks/latest.json`
- Session handoff: `.ai/harness/handoff/current.md`

## Promotion Gate

- **Merge/PR unit**: Captured plan `plans/plan-20260925-1345-remaining-audit-issues.md` is the proposed mergeable execution unit; revise before execute if this is only a checklist step.
- **Rollback surface**: Before execution remove `plans/plan-20260925-1345-remaining-audit-issues.md`; after execution revert branch `codex/remaining-audit-issues` or the explicitly reviewed diff.
- **Verification boundary**: Commands named in the captured planning output plus `repo-harness run verify-contract --contract tasks/contracts/20260925-1345-remaining-audit-issues.contract.md --strict`.
- **Review/acceptance boundary**: `tasks/reviews/20260925-1345-remaining-audit-issues.review.md` must record pass against the captured acceptance criteria.
- **High-risk surface**: Risks named in captured planning output; keep the plan Draft if risk ownership is not concrete.
- **Why not checklist row**: human_decision_boundary

## Evidence Contract

- **State/progress path**: `plans/plan-20260925-1345-remaining-audit-issues.md` task breakdown, `tasks/todos.md` deferred-goal ledger, `tasks/contracts/20260925-1345-remaining-audit-issues.contract.md`, `tasks/reviews/20260925-1345-remaining-audit-issues.review.md`, and `tasks/notes/20260925-1345-remaining-audit-issues.notes.md`
- **Verification evidence**: `.ai/harness/checks/latest.json`, `.ai/harness/runs/`, and the commands named in the captured planning output
- **Evaluator rubric**: `tasks/reviews/20260925-1345-remaining-audit-issues.review.md` must record a passing Waza /check style recommendation
- **Stop condition**: all task breakdown items are complete, sprint verification passes, and the review recommends pass
- **Rollback surface**: Before execution remove `plans/plan-20260925-1345-remaining-audit-issues.md`; after execution revert branch `codex/remaining-audit-issues` or the explicitly reviewed diff.

## Captured Planning Output

## Goal
Handle remaining audit issues #162, #164 and #171 against main e3d8077. Owner requested implementation and reiterated continuation. Preserve local-product scope: no production cloud build, publish, deployment, remote merge or speculative compatibility path.

## P1 Architecture Map
CLI/MCP trigger runtime-daemon services. The daemon owns runtime writes and ChangeSet apply. ExplorerServerService owns loopback authentication and SSE; explorer-html owns navigation. .archcontext remains Git architecture authority; model updates must use ChangeSet. Existing #220 -> #221 -> #222 PRs own already-written helper/docs/jobs extraction. #162 local truthful status is already merged; ADR-0017 retains the separate cloud release gate.

## P2 Concrete Trace
Explorer start returns a random expiring token; browser navigation places it in query; server accepts query or Bearer; renderer repeats query token in EventSource. Regression explorer-session.test.ts proves /health?token=secret returns 200 before repair (Bun 1.4.0). Change to a data-free /connect bootstrap with fragment token, immediate history clearing, port-scoped tab sessionStorage, Bearer HTML and SSE fetches, and authenticated navigation/reload (preserves the GET-only service contract). Query-token requests fail closed. Existing expiry, revoke, loopback Host/Origin and read-only architecture boundary remain.

## P3 Decision
Use the existing server session lifetime and authenticated renderer fetch stream. Do not introduce durable browser credentials, user tracking, or architecture writes. At 10x scale open SSE connections remain the existing pressure point. Control-file ACL, manifest mutation and egress/script authority need separate bounded traces before changes; do not force their acceptance by weakening checks.

## Scope
Parent owns all implementation. Read-only research delegates may inspect shared source. Preserve unrelated WIP. Allowed areas: packages/local-runtime, packages/surfaces, packages/contracts when required by shared contracts, scripts, tests, docs/researches, docs/runbooks, docs/adr implementation status, tasks and plans. Architecture YAML only through existing ChangeSet or integration of already-authored commits. No external service activation, secrets or provider calls.

## Task Breakdown
- [x] Pull main and identify open issues/stacked PRs; prove #162 local fix and cloud gate boundaries.
- [x] Repair Explorer query-token transport and verify bootstrap, session, expiry, revoke, origin rejection, renderer navigation/SSE.
- [x] Integrate already-authored #220/#221/#222 locally without duplicating their feature extraction; resolve source conflicts preserving accepted main behavior.
- [ ] Trace and address remaining #171 manifest, Windows control ACL, egress and scripts ownership/readback findings in bounded slices; record any real blocker without claiming closure.
- [ ] Inventory remaining #164 facade logic after integration and perform justified move-only extractions with parity verification.
- [x] Record #162's separately deferred cloud-delivery milestone in canonical ledger; preserve ADR target and release gate.
- [ ] Freeze code, run pinned Bun focused tests, typecheck, package boundaries and one full verification; one review of new boundary only.
- [ ] Record exact results and update canonical project memory; report local changes and any unresolved issue scope truthfully.

## Validation
Use _ops/toolchain-bun-1.4.0/node_modules/.bin/bun (global Bun 1.4.2 is rejected by repo). Red/green regression already exists. Run targeted tests per changed boundary, then full bun run verify once on frozen source. Do not reproduce expensive evidence for unchanged upstream PR subjects. Stop after three repair rounds per issue. No hosted CI or production claims from local tests.

## Rollback
Revert this branch's new code changes; do not reset existing main or other worktrees. Runtime session changes require no persistence migration. Do not modify control files or ledger databases directly.

## Annotations
<!-- [NOTE]: prefixed inline. Claude processes all and revises. -->

## Task Breakdown
- [x] Pull main and identify open issues/stacked PRs; prove #162 local fix and cloud gate boundaries.
- [x] Repair Explorer query-token transport and verify bootstrap, session, expiry, revoke, origin rejection, renderer navigation/SSE.
- [x] Integrate already-authored #220/#221/#222 locally without duplicating their feature extraction; resolve source conflicts preserving accepted main behavior.
- [ ] Trace and address remaining #171 manifest, Windows control ACL, egress and scripts ownership/readback findings in bounded slices; record any real blocker without claiming closure.
- [ ] Inventory remaining #164 facade logic after integration and perform justified move-only extractions with parity verification.
- [x] Record #162's separately deferred cloud-delivery milestone in canonical ledger; preserve ADR target and release gate.
- [ ] Freeze code, run pinned Bun focused tests, typecheck, package boundaries and one full verification; one review of new boundary only.
- [ ] Record exact results and update canonical project memory; report local changes and any unresolved issue scope truthfully.

## Execution stop

Stopped after the second out-of-scope test failure per user AGENTS. Full verify was terminated with exit 143; neither whole-issue completion nor a passing acceptance receipt exists. Implementation and exact remaining scope are preserved in the task notes. Continue only after a new instruction resolves this stop boundary.

## Approved continuation: CodeGraph handshake timeouts

Owner approved the bounded diagnosis after the stop report. Scope is the two failed projection/recovery tests and their evidence only; no full matrix rerun, cloud work, remote publication or new facade extraction is implied. Preserve existing auth/integration WIP.

- [x] Reproduce the recovery failure without changing source or assertions.
- [x] Trace command runtimes and distinguish individual handshake failure from whole-test deadline cancellation.
- [x] Make the smallest evidence-supported correction and run the two affected scenarios plus directly related coverage.
- [x] Record the diagnosis, actual verification and remaining whole-work-package gate.

## Approved continuation: Windows control-file ACL

Owner approved #171 private control-file creation and readback. P1: RPC daemon publishes token/lock files; both daemon discovery and fast hook consume them; installed-bin platform readback and FG6 artifact validation are verification consumers. P2: server creates token -> writes connection JSON -> clients check private mode -> read token -> send Bearer RPC. Windows currently bypasses the check in both readers and the readback emits a constant. The unavailable-native-ACL regression fails before implementation. P3: one lightweight shared security module uses native Windows FileStream with explicit owner-only protected FileSecurity at CreateNew; reads inspect ACL and consume bytes through the same handle. No create-then-tighten window, permissive fallback, or credential in command arguments. POSIX retains private-mode checks. At 10x hooks, PowerShell startup is the Windows cost; no cache may mask a later ACL change.

- [x] Trace daemon and fast-hook consumers and reproduce missing-authority acceptance.
- [x] Implement private creation plus same-handle validation/read and wire both consumers.
- [x] Add native Windows positive/negative cases and replace constant readback with measured ACL evidence.
- [x] Run local guards, typecheck, packaging and relevant platform tests; explicitly record unavailable Windows execution.

This local environment has no Windows VM/runner. Existing workflow Windows execution requires publishing a reviewable candidate; remote push remains outside the current contract until separately approved.

Windows ACL code/local validation are complete; actual Windows execution and replacement of the historical FG6 evidence remain pending. No passing native acceptance or publication receipt exists.

## Approved candidate publication and hosted verification

Owner approved committing and pushing the current candidate, creating a Draft PR, and running Windows CI. Existing stack #220 -> #221 -> #222 is unchanged remotely; the candidate integrates it. The current main and stack refs were rechecked before publication. Preserve Draft status, do not merge, publish packages, deploy, close the three umbrella issues, or fabricate acceptance receipts. Update actual platform evidence only from verified downloaded CI artifacts.

- [x] Commit candidate, preserve integrated stack ancestry, push and create Draft PR.
- [ ] Inspect Windows test and installed-bin ACL readback results; repair only concrete in-scope failures within the three-round cap.
- [x] Bind actual artifacts to the tested source and update truthful verification records.

### Hosted verification attempt 1 and bounded repair

Draft PR #223 published candidate `7136c6a81b21b4ceb247a5999bb530de27aa4242`; Verify run `36105876838` finished with failure. Six Linux/macOS jobs and their v2 readbacks passed. Governance rejected only the four historical FG6 Windows-evidence findings. All Windows jobs reached the 20-minute limit; Node 24 logged a complete suite with 2024 pass / 5 fail just before cancellation. No Windows artifact was produced.

P1/P2: pwsh launches Bun, which inherits PS7 module paths into Windows PowerShell 5.1; the broad-read fixture cannot autoload Get-Acl. The stale-file CLI fixture is also newly invalid because ordinary writeFileSync has inherited ACLs. The one-second idle test checks publication after waiting for CLI process exit, while native ACL discovery can outlast the idle window. All are within the approved ACL verification scope.

P3: pin each fixed PowerShell script's module path to its own PSHOME Modules; create the stale fixture with the shared private writer; observe actual publication concurrently with startup, retaining the one-second idle behavior and cleanup/PID checks. Reject absent files before spawning the native reader, with same-handle ACL validation unchanged for every existing file. Execute targeted Windows ACL tests and upload installed-bin readback before the full suite so later failures do not erase boundary evidence. No check or timeout is weakened. This is repair round 1, within the three-round cap.

Hosted attempt 2 (`36107901114`, `410af0f`) reached 14 passing native cases on all Windows targets, then the standalone focused runner's default 5-second deadline cancelled RPC stale recovery. Repair round 2 aligns that command to the existing full-suite `--timeout 60000`; no source, assertion or product timeout changes. Readback remains pending.

Hosted attempt 3 (`36108161898`, `61b01b2`) passed all three Windows ACL focused steps and installed-bin readbacks. The read-only native-proof blocker is closed, scoped to that subject. Seven full jobs passed, including Windows/Node 25; Node 24 passed all 2029 tests but was cut off afterward, and Node 22 was cut off during late E2E. Repair round 3 changes only the Windows whole-job budget from 20 to 30 minutes, based on measured suite/packaging time. Other deadlines and assertions remain unchanged. No further fail/fix/reverify loop is allowed after this round without a new instruction.

### Final stop after repair round 3

Run `36110137854` / candidate `7b16ec6` failed the first Windows/Node 24 private-file creation after 10024.63 ms with the fixed native-operation error; the other 14 focused cases passed. The exact subprocess cause is unproven. No fourth repair loop is authorized by the standing cap. Remaining jobs were cancelled and actual evidence was preserved. Prior `61b01b2` native-proof PASS does not establish current-candidate or full-work-package acceptance. The Windows verification task stays incomplete; Draft PR #223 is not ready to merge.

## Approved continuation: native first-create diagnostics

Owner approved the bounded next diagnostic after the three-round stop. This renews work only on the unresolved Windows first-create failure, safe subprocess diagnostics, its existing regression, and subject-bound evidence. Existing Draft publication authorization remains; no merge/release/whole-issue closure.

P1: the shared control-file-security module is the native child-process boundary for daemon publication/discovery, fast hook and recovery. Existing creation regression is the reproduction entrypoint; hosted Windows/Node 24 is required.
P2: createPrivateControlFile -> windowsControlFile -> fixed Windows PowerShell script via execFileSync (10000 ms) -> generic catch discards exit metadata. The prior failure occurred after 10024.63 ms, but code/status/signal are irrecoverable. Paths/body/stdout/stderr must not enter diagnostics.
P3: keep the native operation/deadline unchanged, attach only an allowlisted error code/signal, numeric exit status and elapsed time, and observe the existing test's first-create duration. Use three independent fresh Windows/Node 24 jobs for bounded cold-start observations. Cancel the redundant full Verify workflow during this diagnostic slice. Passing reruns do not prove the original failure's cause or lift whole-candidate acceptance.

- [x] Add and verify non-sensitive subprocess failure metadata.
- [x] Run the existing first-create case on three fresh Windows/Node 24 runners and inspect actual outputs.
- [x] Record proven versus unproven cause; make a correction only if supported, otherwise preserve the unresolved finding.

Diagnostic run `36114666871` / `86e2e7d` confirmed ETIMEDOUT/SIGTERM at 10252 ms, with successful first-create samples at 3395/9885 ms. Correction: create-only native deadline 30000 ms within existing Windows daemon startup 150000 ms; read deadline stays 10000 ms. Reverify three first-create samples plus one installed-bin lifecycle/ACL readback. This is repair round 1 of the newly approved diagnostic slice.

Bounded diagnostic complete: run `36115539255` / `c6f7335` passed three fresh Windows/Node 24 creation cases (4437/5946/4428 ms) and one installed-bin ACL/lifecycle readback. Archive/payload hashes and candidate/merge tree were verified. Evidence: `docs/verification/20260925-windows-first-create-diagnostics.json`. The child-deadline cause is proven and corrected; underlying OS startup-cost attribution remains unproven. Full PR/issue acceptance and historical FG6 are not marked complete. Final record-only publication uses `[skip ci]` to avoid repeating unchanged code verification.

## Approved continuation: FG6 matrix evidence closure

Owner approved correcting matrix-job versus workflow conclusions, then one full Verify run on a frozen candidate. P1: FG6 reads the Verify workflow contract, platform artifacts and independent FG4 runner records; Governance consumes the FG6 recording. P2: the old generator parses a human FG1 sentence saying matrix jobs PASS into runConclusion PASS, losing the separate failed Governance result. P3: replace that Markdown authority with explicit GitHub REST run and jobs JSON, record workflow status/conclusion separately, and require all nine exact matrix jobs to complete successfully for the matrix gate. Retain artifact ACL validation and current-source binding. No v1 fallback. A failed Governance job must remain visibly failed, even if the matrix passes. At 10x targets, job enumeration and artifact downloads dominate; the required matrix remains the current fixed nine.

- [x] Prove the conclusion confusion with regression coverage, implement the structured authority cutover, and run focused checks.
- [x] Freeze code/base, publish the candidate, and run one full Verify matrix (expected 20–30 minutes for Windows).
- [x] Record actual run/job/artifact evidence; verify FG6 and remaining Governance gates without claiming workflow success or rerunning unchanged matrix evidence.

Record-only follow-up commits preserve the tested source SHA explicitly; they do not claim that their own commit was executed by the earlier workflow. Draft status and all umbrella issue scopes remain open.

FG6 slice complete: frozen `8f87777` / run `36117123203` passed all nine full matrix jobs and actual platform readbacks. Workflow conclusion remains failure because its Governance job inspected the previous recording. The regenerated v2 recording passes inspection, and the other 22 Governance evidence inspections pass locally. Archive/payload identity and CI merge/candidate tree were verified. Record-only publication preserves the tested source explicitly and skips redundant CI. Whole-PR acceptance, remote Governance success and the umbrella issues remain open; see `docs/researches/20260925-fg6-matrix-conclusions.md`.

## Approved continuation: independent Governance revalidation

Owner approved an independent Governance entrypoint and actual hosted revalidation after FG6 evidence refresh. P1: `.github/workflows/verify.yml` owns both Governance and the nine-target matrix; `scripts/verify-governance.mjs` remains the canonical full local Verify plus 23 evidence inspections. P2: a record-only commit follows its tested matrix subject; rerunning the old failed job checks the old recording, while a normal PR event repeats the expensive nine-target matrix. P3: add `workflow_dispatch` to the existing registered Verify workflow; only this event excludes the matrix job. Pull requests and main pushes retain the complete matrix. Separate concurrency by event so a manual governance run cannot cancel an automatic matrix. Keep contents read-only and all Governance commands/deadlines intact. At 10x manual dispatch volume the existing full local Verify dominates cost; no duplicate runner or bypass mode is added.

- [x] Verify workflow routing and concurrency with focused tests; publish the reviewed diff with automatic CI skipped.
- [x] Dispatch Governance on the frozen branch head and verify the exact job/result, with no matrix execution.
- [x] Record hosted evidence, update Draft PR and canonical memory, and preserve remaining issue/acceptance scope.

Independent Governance slice complete: `405d6ca` / manual run `36122160055` completed successfully in 5m40s. Only Governance executed; the matrix was skipped before expansion. Canonical `verify:governance` ran all 24 commands with no skipped evidence inspections: full Verify (2037 pass / 2 platform skips / 0 fail), then all 23 evidence checks. Exact run/head/attempt, checkout, job conclusion and log digest are recorded in `docs/verification/20260925-governance-revalidation.json`. Focused routing/FG6 coverage passed 16 tests / 92 assertions and typecheck. Existing nine-platform proof remains bound to `8f87777`; no new platform execution is claimed. Normal PR/main matrix coverage is unchanged. Remaining issue scopes and formal work-package acceptance remain open.

## Approved continuation: manifest decisions configuration

Owner approved #171's supported configuration mutation contract and actual repository update. P1: manifest is Git-visible configuration read by YamlModelStore and included in model/ledger source digests; ChangeSetEngine owns durable writes, daemon plan/apply owns approval, freshness and writer serialization, and CLI/MCP are triggers. P2: `archctx plan` currently emits create_entity -> daemon planUpdate -> operation-scoped policy -> manifest denied; existing repository declares the absent `.archcontext/decisions`, while default manifests and ADR scanning use `docs/adr`. P3: add one typed `update_manifest_fields` ChangeSet operation with fixed manifest path and only `content.decisions = docs/adr`. No caller-provided body, unrelated settings, arbitrary directories, mixed operations, or automatic migration. Preserve other manifest data using the existing core YAML dependency's document editor; reject invalid/ambiguous input. Reuse hash checks, journal, rollback and daemon approval. Manifest-only apply must not rebuild/delete generated projections. A CLI manifest plan command creates the typed proposal; existing apply/approval performs the write. At 10x repositories the full model validation/ledger import remains the cost; no config cache or alternate authority is introduced.

- [x] Prove current rejection; implement typed operation, narrow path scope and schema/CLI/MCP/journal support.
- [x] Verify supported update, invalid fields/paths/body, stale hash, symlinks, no projection changes, rollback/recovery, daemon approval and CLI flow.
- [x] Apply the repository manifest update through the supported daemon ChangeSet path, verify preserved fields and record evidence.
- [x] Freeze and publish the candidate, complete appropriate checks, update Draft PR and canonical memory.

No `.archcontext/` file is edited directly by an agent. The manifest is in scope only as the output of the supported command. Existing runtime/source changes mean earlier platform CI is historical until this candidate receives its own verification.

Manifest continuation complete: frozen `57664d58b90abcc69e8c5f71c43a93ace5dcd2e3` / Verify `36125127163` passed all ten jobs (nine platform targets plus Governance). Every full suite executed 2060 tests with zero failures; platform skips remain explicit. Governance executed all 24 canonical commands with no skipped inspections. Nine downloaded archive/payload identities, native permission evidence and CI merge/candidate tree equality were verified. Exact results: `docs/verification/20260925-manifest-hosted-ci.json`. Final record-only publication uses `[skip ci]` and preserves the tested source; no runtime/base changes or redundant matrix rerun. The manifest item is complete; whole-plan acceptance, #164 facade work and #171 egress/historical-readback work remain open.

## Approved continuation: local egress admission and network-denied proof

Owner approved the next #171 slice: one admission boundary for actual local-product outbound operations and kernel-enforced network-denied local-first-experience evidence. Existing Draft publication authorization persists; no provider calls, cloud delivery, merge/release, or umbrella issue closure.

P1: current production non-local paths are Context7 HTTP, explicit npm update lookup, the audit investigator subprocess and GitHub issue executor. Feature enablement, user audit consent, publishing confirmation/credentials remain their domain authorities. CodeGraph telemetry is a separate explicitly configurable third-party channel. Daemon RPC/Explorer loopback remains local. Cloud clients currently expose crypto/ports without a production HTTP adapter; this slice does not invent one. The shared admission module belongs to the existing local-runtime workspace and is consumed by transports/CLI; it does not import surfaces or cloud.

P2: `docs fetch` -> external documentation service -> enabled Context7 adapter -> HTTP transport -> fetch; `audit run` -> manifest + user consent -> queued job -> investigator spawn; `audit approve` -> manifest/consent/confirmation/PAT -> repo probe/list/create via gh; `update --check`/opted-in doctor -> npm view spawn. Today those last boundaries have no common deny control. `local-no-cloud-e2e.mjs` strips provider variables but all child processes still inherit usable network access.

P3: introduce `ARCHCONTEXT_EGRESS_MODE=configured|local-only`, defaulting to configured feature opt-ins. `local-only` denies every named non-local operation even if its feature is enabled; invalid policy values fail closed. It never grants consent or overrides content/credential gates. Admission runs before real fetch/spawn and before audit queue/publish state changes. Reporting uses the same policy and separates daemon policy from a CLI update operation. Reject enabled CodeGraph telemetry under local-only instead of silently rewriting the user's value. No process-global fetch monkeypatch or proxy-only claim. The E2E must run under kernel network isolation (macOS Seatbelt / Linux network namespace), prove non-loopback socket and descendant-process denial while loopback works, and reject unsupported/unisolated runs. This verifies the test process tree; runtime admission is not advertised as an OS sandbox for arbitrary third-party code. At 10x operations, existing provider/process latency dominates; admission is constant-time and needs no new queue/cache.

- [x] Capture pre-fix admission/network-proof regressions and implement the shared boundary with exact four-channel wiring and telemetry handling.
- [x] Verify default opt-ins, explicit local-only/invalid policy denial, zero transport side effects, existing consent/approval, reporting and loopback behavior.
- [x] Replace env-only E2E proof with actual network-isolated execution; strengthen the existing FG6 evidence inspector with no old-evidence fallback and regenerate valid evidence.
- [x] Freeze candidate/base, publish Draft and run required current-source hosted checks once, record actual results and update canonical memory.

The full matrix may take 20–30 minutes; run it only after source freeze. The three-round repair cap applies to this newly approved slice. Network-isolation evidence on unsupported hosts must be a refusal, never a pass or silently unsandboxed execution.


## Egress verification stop (current checkpoint)

Runtime implementation and macOS kernel-isolated E2E are complete locally; publication is held. The broader CLI/workflow run finished after 664.60 seconds with 92 pass / 2 fail / 1 error (94 tests, 1507 assertions). `projection apply over real RPC ignores concurrent .ai/harness runtime churn` failed during shared fixture preparation at CLI test line 4448 (`unresolvedProtocol.ok === false`, underlying envelope absent). `projection CLI and MCP share RPC results and single-use request-bound write approval` exceeded the 120000 ms outer deadline; a subsequent unhandled line-5087 assertion expected one successful concurrent result and observed zero.

These are outside the named egress behavior; their causal relationship to this candidate is unproven. They are not labelled known flakes, existing baseline failures or egress regressions without evidence. No projection source/test fix or timeout increase was made. Per the user AGENTS second-out-of-scope-fault hard stop, the pending isolated rerun was interrupted (exit 130, no verdict), no full CI was launched and the work remains uncommitted in the isolated worktree. The 111 related tests, typecheck, package boundaries, architecture Mermaid and actual macOS FG6 proof passed. Linux kernel execution and current-source hosted checks remain unverified.

Exact WIP source hashes, log digests, results and stop boundary: `docs/verification/20260925-egress-local-checkpoint.json`. Next bounded diagnosis is the two projection/RPC failures: capture the typed failure envelopes and child/outer deadlines on this same source before changing any product behavior. Do not repeat a full matrix until that blocker is understood.


## Approved continuation: projection/RPC failure diagnosis

Owner approved the bounded diagnosis of the two verification blockers. P1: Bun owns the outer scenario deadline; CLI fixture setup invokes local daemon services; projection snapshot assembly invokes package-local CodeGraph with its own version/status/sync deadlines; later parity operations cross loopback RPC and one-time approval. P2: the first observed false envelope occurs during shared fixture preparation before injected runtime churn; the second expires at the outer 120-second deadline during concurrent approved RPC calls. Existing logs omit the first typed envelope and cannot establish causality. P3: preserve all product behavior, consent/receipt invariants and current deadlines while recording only diagnostic failure envelopes and subprocess method/timing/status. First reproduce the two named cases, then change only a proven cause. A separate observational longer-budget run may distinguish aggregate duration from a child deadline, without treating it as production acceptance. No broad matrix until this blocker is understood; maximum three fix/reverify rounds.

- [x] Capture actual typed errors and command/outer timing on the pinned source.
- [x] Prove or bound causality, apply only an evidence-supported correction if needed, and verify the named cases.
- [x] Record the outcome and next publication boundary without conflating targeted results with full CI.


## Approved projection/RPC diagnosis outcome

Source fingerprints matched the prior stop. The churn case passed at 116.486s under its unchanged 120s budget, then passed at 109.124s in normal verification. Its original false envelope is not reproduced or explained; the assertion now retains the returned error and no product fix is claimed for it.

The parity case reproduced the 120s outer timeout: Bun killed `--version` after 738ms, well before its own 5000ms limit. An observational longer-budget run completed all 61 assertions in 129.938s; all 111 child commands succeeded, consuming 123.816s cumulatively (max 1.666s). Only this test now uses its existing Windows 240s allowance on all platforms. Product RPC/subprocess deadlines, one-time approval and receipt semantics are unchanged. Final uninstrumented verification: 2 pass / 0 fail / 95 assertions, 239.57s; typecheck passes. Exact diagnosis, source/log hashes: `docs/verification/20260925-projection-rpc-diagnosis.json`; P1/P2/P3: `docs/researches/20260925-projection-rpc-deadline.md`.

The previous failed aggregate run remains failed. These current named checks clear the observed parity deadline blocker, without retroactively explaining the historical churn envelope. Existing authorization permits frozen Draft publication and full current-source CI; the original stop and interrupted rerun remain historical.


## Egress candidate hosted closeout

Frozen source `5117abd2a98a5fdaeaab744d79b2386e1cd5037c`, base `e3d807759e917b26c539f25c51edc31946feb740`, Verify run `36138457129` passed all ten jobs. Every full suite executed 2072 tests with zero failures: Linux/Governance 2070 pass / 2 platform skips; macOS/Windows 2071 pass / 1 platform skip. Both diagnosed projection cases passed in every job. Governance executed all 24 commands with no skipped inspections. Longest job: 25 minutes.

CI merge `9e26ccd31a753e28bd250ab6673a5d0d8562f203` has the same tree as the frozen candidate. Ten downloaded archives match GitHub digests; all nine installed-bin IPC/native-permission payloads pass the existing FG6 inspector. Actual Ubuntu/Node 22 kernel proof reports a distinct namespace with only loopback, IPv4/IPv6 direct and child `ENETUNREACH`, positive loopback and complete local task/review flow. Local macOS proof remains in FG6 v2. The duplicate Windows diagnostic run was cancelled because the canonical matrix already includes that coverage.

Exact source/job/log/payload identities and results: `docs/verification/20260925-egress-hosted-ci.json`. The initial local artifact inspection rejected an operator-assembled jobs envelope missing GitHub `total_count`; supplying the original complete API response passed the unchanged inspector. No test, gate or source was altered to force that result.

The approved egress and bounded projection diagnosis slices are complete. The first historical churn false envelope remains causally unconfirmed despite the subsequent local/hosted passes; the parity outer deadline is proven and corrected. Final publication is records-only with CI skipped; the tested source remains explicit. Draft #223 stays Draft. Remaining #164 facade work, #171 historical DE1/DE3/S6 readback scope, optional #162 cloud delivery and formal whole-plan acceptance remain open. No merge, release, deployment or issue closure.


## Approved continuation: DE1/DE3 source readback predicates

Owner approved the bounded #171 slice for `indexedBacklinks`, `requiredDomainsFailClosed`, and `explicitAuthorityBinding`.

- P1: the readback scripts combine source invariants with independent command results. Runtime owns authority selection, compiler owns input admission, SQLite owns indexed bounded metadata reads. Historical artifacts remain historical.
- P2: `buildExplorerProjectionV2` selects Git/verified-ledger authority, reads planned graph/metadata, and passes explicit graph/evidence cursors into `compileProjectionInputManifest`. The compiler validates the selected graph against its read-set and rejects unavailable domains. Both store read paths call the indexed `readExplorerProjectionBacklinksFromDb`.
- P3: preserve these invariants and replace obsolete call/error spellings with checks of the current connected function bodies. Scope source witnesses to their current declaration boundaries; require both call sites and guards. Negative mutations and existing runtime/store/compiler tests must remain red on regressions. At 10x graph size, unbounded legacy reads would fail first; do not restore them to satisfy the old detector.

### Task Breakdown: readback continuation
- [x] Capture the three old predicate failures against the unchanged candidate.
- [x] Repair only these source predicates and add negative mutation coverage.
- [x] Run scoped compiler, daemon and SQLite behavior tests plus typecheck/governance ownership checks; record source hashes and exact results.
- [x] Publish the bounded slice on Draft #223 and update durable records. Do not relabel historical DE1/DE3 artifacts, merge, deploy, or close umbrella issues.


## DE1/DE3 predicate repair (approved bounded slice)

Completed the three current-source detectors without runtime behavior changes. Cause and P1/P2/P3: `docs/researches/20260925-de1-de3-source-predicates.md`; exact input hashes, baseline failures and mutation evidence: `docs/verification/20260925-de1-de3-predicate-readback.json`. Final scoped checks: 41 tests / 118 assertions; ownership 6 tests / 52 assertions; typecheck and package boundaries passed. Three actual product-source mutations failed at the intended assertions and were restored byte-for-byte. Historical DE1/DE3 artifacts remain unchanged; full old command matrices/preflights were not rerun. This is bounded predicate repair acceptance only. S6, remaining facade/cloud scope and whole-plan acceptance remain open.


## Approved continuation: S6 central-hook documentation readback

- P1: the S6 docs/ops script reads harness-owned `.ai/hooks/README.md`, the product-owned practice runbook, and historical hook evidence. CLI `hooks` declares the central adapter; `hook checkpoint` crosses local RPC. No installed host configuration or runtime behavior changes are in scope.
- P2: harness refresh `b24808c` replaced the hook README with a generic user-level typed-runtime/helper-only boundary, removing `central-first` and the product evidence link. The old docs predicate therefore fails, and `centralHookComplete` correctly propagates that failure. Current CLI and product runbook retain central ownership.
- P3: check the current harness README contract and put the product-specific evidence link in the existing product runbook. Preserve the predicate key and aggregate computation; no compatibility alternative or fabricated current network evidence. At repeated harness refreshes, product prose in generated helper docs would drift again; product-owned documentation prevents that coupling.

### Task Breakdown: S6 continuation
- [x] Capture baseline failure and a failing run-path regression on unchanged code/docs.
- [x] Repair the current README/runbook predicate and test missing-boundary/evidence negatives.
- [x] Run/inspect a separate current docs readback, scoped tests and typecheck; preserve historical artifacts.
- [x] Publish to Draft #223, record verification limits and update project memory.


## Current directive: accept all PRs and clean remaining issues

Owner requested acceptance of every open PR and cleanup of remaining issues. This supersedes the preceding bounded-slice stop: S6 current hook evidence and the observed Windows CI failure are now named acceptance blockers. Inventory covers #220/#221/#222/#223 and #162/#164/#171. Preserve prior proof by exact subject; do not infer cloud delivery or a composition-only facade from partial extractions. Final disposition must link completed work and retain concrete unfinished work. No release, deployment or provider activation is included.

### Task Breakdown: integrated acceptance
- [x] Audit all open PR heads, dependencies, current CI and issue acceptance criteria.
- [x] Finish S6 current adapter evidence and resolve the named Windows verification blocker with bounded proof.
- [x] Freeze candidate; run scoped checks and one complete current-source verification; review the integrated diff once.
- [x] Publish findings and perform supported PR/issue dispositions; record unresolved delivery gates explicitly.


- [ ] Clear #225/#226 and obtain the normal frozen whole-plan AcceptanceReceipt; remains blocked.

## Integrated acceptance scope and source review

The current user directive accepts the existing PR work and cleans issue tracking. #220/#221/#222 heads are ancestors of #223; their feature extractions are included. Further composition-only facade work and general RPC decoders remain #164 and are explicitly deferred in `tasks/todos.md`, rather than claimed complete by this PR. Cloud delivery remains a blocking milestone under #224; ADR-0016/0017 retain the target and now point to it. This supersedes the earlier open-ended further-extraction task for this acceptance boundary, without marking #164 done.

S6 v2 now validates current CLI metadata, required evidence fields and the current generic harness README. Canonical output was generated; v1 was archived byte-for-byte. Source review found no blocking code defects. The reported stale S6 proof hashes/assertion count were corrected against final verified source. Windows run 36144083941 remains failed: the docs digest test exceeded 15 seconds once; unchanged production code previously passed that test in 3.608 seconds. No particular slow phase is proven. Retain the 15-second deadline and all assertions for the one planned frozen-candidate matrix.


## Final integrated acceptance disposition (2026-09-25)

**BLOCKED**. Hosted candidate `18d2075` passed all ten jobs in run 36149269956, with 2115 tests per full suite and zero failures; native/network artifacts and source/merge identities were verified. #220–#222 were closed as superseded by Draft #223, preserving branches. #162 is closed for completed local status truthfulness; #224 retains real cloud delivery. #164 and #171 remain open with explicit remaining work.

Formal freeze fails on the installed harness/repository capability contract mismatch (#225). Migrated direct local contract checks passed Explorer session, typecheck and boundaries, but full verify failed with 2112 pass / 1 skip / 2 fail: documentation-drift CodeGraph handshake timeout and a separate projection RPC readback outer timeout (#226). No second matrix, timeout change or additional repair was attempted. No AcceptanceReceipt, merge, release or deployment is claimed. Exact source/log/command evidence and P1/P2/P3: `docs/verification/20260925-integrated-pr-acceptance.json` and `docs/researches/20260925-integrated-pr-acceptance.md`.


## Approved continuation: issue #226 deadline diagnosis

Owner approved the two named local projection failures. Continue in the existing Draft worktree. #225, full matrix reruns, merge and release remain outside this slice.

- P1: runtime completion owns the documentation-drift gate; the CodeGraph adapter owns package-local public CLI proof and child deadlines. The CLI integration test owns the real RPC/readback scenario and outer test deadline.
- P2: completeTask → completeTaskProjectionDrift → prepareArchitectureDocumentationProjectionSnapshot → prepareProjectionCodeFacts → package-local `--version` (5000ms). The second test prepares an adopted/indexed model, applies via RPC, observes pending recovery, verifies delivered receipt stability and rejects changed identities/targets/inputs. Each current read reconstructs proof rather than trusting the historical receipt.
- P3: preserve child/runtime deadlines, fresh-current-read proof, all original assertions and writer authority. Capture command timing and failure envelopes before deciding any correction. At 10x reads, repeated subprocess startup is the likely cost pressure, not a reason to cache away the current-read contract. Do not call an unreproduced timeout a known flake or infer its cause from later success.

### Task Breakdown: #226
- [x] Verify prior source/log identities and reproduce only the two cases with child and outer timing.
- [x] Establish the failing phase and a sufficient regression before fixing a proven cause; at most three rounds.
- [x] Run the two uninstrumented cases and relevant cheap checks after any correction.
- [x] Publish bounded evidence and update #226, Draft #223 and project memory; retain unresolved causes and #225 gate.


### #226 measured decision before final scoped check

Round 1 reproduced the 120s outer RPC deadline; round 2's diagnostic 240s window instead exposed two actual `--version` child deadline expirations at 5008/5022ms during fixture setup. The diagnostic test edit was restored byte-for-byte. A no-CodeGraph `bun -e` probe reproduced a 5s failure before user code. Nested preload timing puts the delay before Bun preload, while bundled Node version execution takes tens of milliseconds. A one-second native sample places 719 of 767 main-thread samples at directory enumeration (`__getdirentries64`); exact Bun-internal symbol/directory cause remains unproven.

Empty config/package markers and no-env/no-install/tsconfig flags did not remove the warm startup penalty. Paired same-runtime/same-script probes gave 637–793ms under system temp versus 14ms under the task's isolated temp base. Use an operator-scoped `TMPDIR` in ignored `_ops/remaining-issues/issue226/temp-base` for the final two original tests. This is environment isolation; do not change product commands, child/outer deadlines, runtime semantics, assertions, or global system temp. No deletion of other temp state is authorized.


## #226 local verification environment resolved

No product/test source or timeout changed. The old outer timeout reproduced; a longer observation then exposed real 5s version-child expirations before the RPC phase. A no-CodeGraph Bun start reproduced the delay before user code; native samples show directory enumeration. Task-scoped `TMPDIR` reduced paired startup to 14ms and the two original uninstrumented cases passed (2 pass, 79 assertions, 29.84s). The existing child deadline rejection also passed. Exact Bun internals remain unproven; no universal runtime fix is claimed.

`docs/researches/20260925-projection-verification-environment.md` contains P1/P2/P3 and Root Cause Evidence; `docs/verification/20260925-projection-environment-diagnosis.json` binds measurements/source/logs. `docs/runbooks/projection-verification-environment.md` supplies the operator command. Contract test checks now fingerprint `TMPDIR`. #226 is ready to close for this bounded resolution; #225 still blocks formal whole-plan acceptance. No full matrix rerun or receipt/merge/release.


## Approved continuation: #225 projection profile alignment

Owner approved capability contract alignment and controlled migration. ArchContext work remains in this worktree. The necessary consumer correction is isolated in `repo-harness-wt-archctx-projection-profile`, based on upstream `6a097792`; existing source-exclusion/release worktrees remain untouched. No package release, global installation or merge is included.

- P1: initializer owns fresh model creation; ADR-0043 defines capability identity and glob ownership; the daemon owns model/projection writes. `repo-harness/v1` requires a three-part capability ID and explicit contract-file targets. Harness policy here selects the existing registry for workflow ownership.
- P2: prepare-acceptance → automatic projection → snapshot capture → agent-context target discovery currently invokes the complete ownership-registry translator before calling ArchContext. That translator rejects valid generic source globs/exclusions and requires unrelated metadata. Separately, the initializer and current model use a two-part capability ID.
- P3: target identity is `capability.architecture.context`: architecture is the domain and context is the existing function, retaining the displayed Architecture Context meaning. Fix fresh initialization; migrate the live root plus every graph reference in one exact-digest ChangeSet. Explicit root `AGENTS.md`/`CLAUDE.md` targets follow the existing root routing contract. Preserve include/exclude, entrypoints and workflow registry authority. In the harness projection consumer validate the actual projection profile, without translating source ownership or relaxing the ownership registry. At 10x nodes the existing filesystem snapshot remains the cost boundary; this change adds no provider invocation or second resolver.

### Task Breakdown: #225
- [x] Prove producer identity and projection-consumer contract failures with focused regression coverage.
- [x] Correct fresh initialization and the isolated harness projection consumer; retain invalid identity/path rejection.
- [ ] Apply a reviewed exact-digest model ChangeSet updating all root references; regenerate through daemon-owned projections and validate graph semantics.
- [ ] Verify the paired candidates using isolated TMPDIR, record source versus installed-runtime boundaries, and attempt normal acceptance only when its actual prerequisites are satisfied.
- [ ] Update Draft #223, #225 and canonical project memory with verified outcome and any release/adoption prerequisite.


## #225 profile correction and controlled migration stop (2026-09-26)

Initializer now uses `capability.architecture.context`; the isolated harness candidate separates projection target validation from ownership registry translation. Real initialized-model/daemon-configuration paired proof passes without changing source globs/exclusions or registry authority. ArchContext 145 focused cases and harness 72 cases pass; both typechecks, ArchContext package boundaries and harness required integrity checks pass. Scoped consumer security review passes.

Live migration is not complete. The first transaction rolled back on ADR-0021's old appliesTo reference; the second rolled back on the existing docs/adr write guard. All ten original files match preimages and the new node is absent. Root AGENTS/CLAUDE targets are separately denied by the documented policy boundary. The temporary helper extension was removed; no allowlist/policy change or direct model/projection editing occurred. The required next slice is a typed ADR-reference update and marker-only root-contract write contract with preserved human text and rollback proof, before retrying the complete migration.

Evidence and P1/P2/P3: `docs/researches/20260926-capability-profile-alignment.md` and `docs/verification/20260926-capability-profile-diagnosis.json`. #225 remains open and #223 remains Draft. No new whole-plan freeze, full matrix, AcceptanceReceipt, merge, release or global installation.


## Approved continuation: #225 restricted writer contracts

Owner approved the bounded ADR-reference and root-contract writer slice after the safe rollback report. Preserve the isolated worktree and the existing local harness counterpart. Draft publication remains authorized; no package release/global installation/merge is implied.

- P1: ChangeSetEngine owns approval, expected hashes, journaling and rollback; policy-engine owns per-operation path scope; projection-engine owns generated marker content; runtime-daemon binds current-model rendering to the writer; CLI/MCP/proposal helper are triggers.
- P2: identity migration must update ADR-0021 appliesTo within the same transaction as node/graph references. Existing generic writes cannot reach docs/adr. Root agent-context targets are already explicit profile fields, but the writer rejects them regardless of renderer output.
- P3: add closed `update_adr_references` operations containing an existing-file hash and exact old/new node-ID replacements, never arbitrary Markdown body. Patch only explicit YAML scalar ranges in appliesTo, rejecting malformed/ambiguous/alias values and preserving all other bytes. Root AGENTS/CLAUDE writes remain render_agent_context-only, require existing hash-bound files and explicit current model targets, and must match a fresh canonical renderer result. Preserve human bytes when appending the first generated region. Keep generic write/delete and inferred-root source ownership forbidden. At 10x model size repeated current-model rendering is the existing read cost; introduce no cache that can mask changed authority.

### Task Breakdown: restricted writers
- [x] Add failing ADR transaction and root marker-only write regressions.
- [x] Implement closed operation/schema/surface/readback support and exact renderer validation.
- [x] Verify rejection, rollback/recovery, current-model/hash checks and human-byte preservation.
- [ ] Rebuild the complete migration proposal, apply through daemon with exact digests, regenerate projections through their owner and inspect current readback.
- [ ] Record verified source/candidate/installed-runtime boundaries and complete the available acceptance/disposition steps without bypassing guards.

### Current boundary after restricted writers

The 11-file model/ADR migration and two root contract marker writes committed through the daemon. Source invariants, focused tests, typecheck and boundaries pass. Documentation projection still reports `human-action-required` for the real node rename; the YAML-mode ChangeSet journal does not contain an architecture event that can truthfully fill `acceptedChange.eventId`. No adoption candidates exist. Keep documentation regeneration, paired installed-harness acceptance and the typed whole-plan receipt pending until that event reference and fixed point are established. Evidence: `docs/verification/20260926-restricted-writer-migration.json`.

## Approved continuation: accepted-change event and docs fixed point

Owner approved the next #225 slice. YAML remains the Git-visible declared authority. Do not switch ledger rollout mode, run an unsupported YAML import, or label a ChangeSet journal ID as an architecture event.

- P1: the committed ChangeSet journal proves the model/ADR write set; the daemon is the only ledger event writer; repo-harness/v1 projection classifies the old→new node delta and requires an accepted-change reference before its fixed-point apply. Local SQLite event state is operational; generated docs remain owned by the projection service.
- P2: `changeset.issue225.capability-profile-v3` wrote the old-node deletion, new node and all graph/ADR references, then root marker projection committed separately. The current documentation plan reports `node-added`/`node-removed`, 38 drift files and no adoption candidates. YAML-mode apply recorded no architecture event. `ledger rebuild --from-git` is not a substitute: it rejects the existing `archcontext.flow/v1` as unsupported.
- P3: if an accepted-change event can be created, make it an explicit daemon-owned transactional append with a closed input tied to the committed ChangeSet journal, current file hashes, head/worktree identity and observed reason/node set. No caller-provided event ID, arbitrary payload, mode promotion or shadow model derivation. Record-only event must not imply ledger graph authority. Recheck the event from storage before using it to drive projection. At 10x journal entries, bounded lookup and file-readback are the pressure points; do not scan unrelated history without a measured need.

### Task Breakdown: accepted event
- [x] Prove the event and protocol boundaries in source, then run scoped store and cross-repository projection regressions. `acceptedChange` is an opaque reference in the existing cross-repository v1 protocol; a universal local-SQLite resolver would break valid external acceptances, so the local issuance command independently reads back its event and its exact returned tuple is passed unchanged into projection. The live accepted-event append will be the positive integration proof after source freeze.
- [x] Implement the operator-invoked daemon event append and readback for a committed YAML node rename; reject missing journal, stale snapshot/file hashes, other major-change shapes and repeated inputs without promoting ledger graph authority. Typecheck and package boundaries pass; the live append remains pending until source freeze.
- [ ] Produce and read back the real event for the committed migration, then use its exact identity in the projection owner's accepted-change apply; verify the no-accepted-change fixed point.
- [ ] Run required bounded checks and update evidence, #225, Draft #223 and canonical project memory. Keep formal installed-harness/whole-plan gates distinct.
