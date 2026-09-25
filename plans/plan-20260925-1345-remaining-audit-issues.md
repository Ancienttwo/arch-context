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
- [ ] Freeze and publish the candidate, complete appropriate checks, update Draft PR and canonical memory.

No `.archcontext/` file is edited directly by an agent. The manifest is in scope only as the output of the supported command. Existing runtime/source changes mean earlier platform CI is historical until this candidate receives its own verification.
