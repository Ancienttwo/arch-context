# Implementation Notes: changeset-acceptance-v2

> **Status**: Executing
> **Plan**: `plans/plan-20260928-2313-changeset-acceptance-v2.md`
> **Contract**: `tasks/contracts/20260928-2313-changeset-acceptance-v2.contract.md`
> **Issue**: #238 prerequisite (`tasks/todos.md` row "Semantic acceptance for committed YAML ChangeSets beyond node renames")
> **Lifecycle**: notes

## Design Source

On 2026-09-28 two independent designs were produced: Opus (deep-reasoner) and Codex, each blind to the other. The orchestrator synthesized them. Both agreed that widening the rename predicate is unsafe, and that acceptance must be proven by a chain from an anchored baseline, through explicitly listed journals, to the current model.

Where they diverged, the decisions were:
- **Evidence granularity**: take Opus's NativeModel before/after digest per journal, not Codex's full per-file inventories plus semantic summaries. The model digest covers everything the model loader reads, so a hand edit to any semantic file breaks the chain. Journal metadata already stores per-file preimage hashes.
- **Consumer-side event authentication**: left out of scope. `acceptedChange` is an opaque reference in the cross-repository v1 protocol (`plans/plan-20260925-1345-remaining-audit-issues.md:443`), so a mandatory local-SQLite resolver would break valid external acceptances. It is recorded as a deferred opt-in local verification.
- **Old RPC shape**: rejected with `AC_SCHEMA_INVALID`. The CLI keeps `--journal-id/--changeset-id` as a one-journal shorthand that maps to the new request.

## Facts The Design Relies On (verified by the Opus track at a4cc94b)

1. `packages/core/projection-engine/src/major-change.ts:85-96`: every per-node facet hashes an array keyed by member id. Therefore:
   - adding one component emits about 10 reason codes, with affected = `[capability, new node]`;
   - an ownership-only `source.include` edit gives `["ownership-changed"]` with affected = `[capability]` only;
   - a summary edit gives `["responsibility-changed"]` with affected = `[capability]`.

   The edited node is often **not** in `affectedNodeIds`, so v1's per-affected-node file rule (`runtime-daemon/src/index.ts:1213-1219`) is structurally wrong for these shapes.
2. This repo has one capability owning all 50 nodes. Capability-level attribution cannot tell a journaled edit from a hand edit.
3. `readCommittedChangeSet` (`local-store-sqlite/src/index.ts:2258-2271`) returns only `{journalId, changeSetId, committedAt, files}`. Journal metadata (`:7706-7723`) holds preimage hashes but no model digest. The YAML-store `modelDigest` (`model-store-yaml/src/index.ts:302,317-337`) hashes `{path, body}` including `.archcontext/generated`, so it cannot be used as the chain digest.
4. The anchor: the manifest `semanticBaseline.digests.modelDigest` (`projection-engine/src/index.ts:448,482-485`) is `digestJson(loadNativeModelFromArchContext(root))` (`codegraph-adapter/src/index.ts:729`). It matched the live digest at a4cc94b.
5. `architectureDocumentationProjectionWorktreeDigest` ignores `docs/architecture` (`projection-engine/src/index.ts:627-637`), so the manifest can change while `expectedWorktreeDigest` stays equal. The acceptance plan id closes this gap.
6. Consumers never resolve the event (`cli/src/main.ts:1139-1163`; `runtime-daemon/src/projection-service.ts:24-28,438,659-676`). This is by design; see the Design Source section.
7. `acceptCommittedChange` has no daemon domain tests. The only coverage is the RPC wire sentinel at `runtime-daemon/test/rpc-methods.test.ts:24-41`.

## Commit A: Journal Model-Transition Evidence

- **Where it runs.** In `applyAuthorizedUpdate`, only for drafts whose operation paths touch `.archcontext/model/{nodes,relations,flows}/*.y(a)ml` (exactly what the model loader reads; `projection-engine/src/index.ts:1415-1428`).
- **Before the apply.** Right after the existing base checks (`runtime-daemon/src/index.ts:~1087-1097`):
  - hash each semantic file as `{path → digestJson({body})}`;
  - compute `before` = `digestJson(loadNativeModelFromArchContext(root))`.
- **Install the hook.** Install `afterModelValidatedBeforeCommit` for these drafts in **every** write mode. Today it is only installed when `writesLedger || projectionApplyReceipt` (`index.ts:~1106`). Compose with, and do not replace, the existing hook behavior for ledger and projection modes.
- **Inside the hook**:
  - re-hash;
  - require that paths the draft did not write are unchanged, and that written paths equal the op body hash (deleted paths absent);
  - compute `after`;
  - while the journal is still pending, call a new store method `recordChangeSetModelTransition(journalId, {schemaVersion: "archcontext.changeset-model-transition/v1", before, after})`.
- **Failure handling.** If the loader throws or a check fails, record nothing and leave the apply outcome unchanged; that journal simply cannot be accepted later. Store digests only, never bodies.
- **Commit semantics.** The hook's return value must keep today's commit semantics: `{journalCommitted: writesLedger && Boolean(journalId)}` (`changeset-engine/src/index.ts:322-326`). Verify this exactly; YAML-mode commit behavior must not change.
- **Envelope.** `apply_update` additionally returns `journalId`.
- **Store.** Add `recordChangeSetModelTransition` (only while pending; malformed input throws). `readCommittedChangeSet` also returns the transition when present. Mirror both in `TestLocalStore` (`local-store-sqlite/test/factories.ts:~495-500`). Any persistence must be additive journal metadata; document it here if it is a schema change.

## Commit B: v2 Acceptance

- **Inputs.**
  - B = manifest baseline modelDigest.
  - C = current NativeModel digest.
  - J1..Jn = journals in operator order (1..32), each with a recorded transition (b_i, a_i).
- **The chain.** Require b1 = B, a_i = b_{i+1}, and a_n = C.
- **Per-journal rules.** Every journal must be committed, belong to the same canonical root, and write at least one semantic file (no padding). The changeSetId must match. No duplicate journal ids. `committedAt` must be non-decreasing in the given order.
- **Node sets** (a label for the record; soundness comes from the chain):
  - `directlyEditedNodeIds`:
    - for node files a journal wrote, the id parsed from the current file; the path must be `nodes/<id>.yaml`;
    - for deleted node files, the id comes from the path; it must exist in the baseline and be absent now.
  - `affectedAncestorNodeIds`: affected capabilities not in the direct set.
  - `carriedNodeIds`: affected non-capabilities not in the direct set.
- **Proof gate.** If a capability's `semanticFingerprint` is unchanged but its `flowProofFingerprint` changed, and no bound journal wrote one of its flow files, reject.
- **Which shapes are acceptable.** All 13 reason codes (`contracts/src/projection.ts:38-52`). The mode must be `human-action-required`, and the accepted sets must **exactly equal** the observed sets.
- **Fail-closed on everything else**:
  - authority mode is not YAML;
  - the journal is missing, pending, aborted or from another root;
  - an id mismatch, duplicate, more than 32 journals, or out-of-order journals;
  - a journal with no transition;
  - a break in the chain;
  - a symlink segment, or a non-standard node path;
  - no manifest baseline, or `refreshSignals[0].baseDigests.modelDigest != B`;
  - `rejected` is non-empty, or a p1/p2 proof is unprovable;
  - an unexplained proof-only change;
  - a digest or plan-id mismatch;
  - an event already exists at this snapshot.
- **Preview/approve** (the pattern of `docs adopt`, `projection-service.ts:228-241`):
  - A call without `approved` returns the plan plus `acceptancePlanId = digestJson(plan)`. The plan includes the journals, B, C, the reason codes, the affected ids, the three node sets, the worktree digest and HEAD.
  - The approve call recomputes under the writer lock and must produce the same id.
- **Event.**
  - `payloadVersion: "archcontext.accepted-committed-change/v2"`, same `eventType`, `operations: []`, base == resulting ledger graph digest.
  - The payload records:
    - `journals[{journalId, changeSetId, committedAt, before, after}]`;
    - `fileSetDigest` over the semantic files' last writers;
    - `baselineModelDigest`, `modelDigest`;
    - reasonCodes, affectedNodeIds;
    - the three node sets;
    - `projectionWorktreeDigest`, `acceptancePlanId`;
    - `authority: "yaml"`.
  - Event id: `architecture_event.changeset_accepted.<24 hex of digestJson({v: 2, journalIds, B, C})>`.
  - Idempotency key: distinct from v1's.
  - The payload type becomes a v1 | v2 union (`core/architecture-ledger/src/index.ts:~112`). Recorded v1 events are untouched.
- **RPC.** Input `{journals[], approved?, expectedWorktreeDigest?, acceptancePlanId?}`; the RPC schema version stays. The old four-field shape returns `AC_SCHEMA_INVALID`. Update the wire sample in `rpc-methods.test.ts`.
- **CLI.** Repeatable `--journal <journalId>=<changeSetId>`; `--journal-id/--changeset-id` stay as a one-journal shorthand. Without `--approved` it runs a preview; with it, it requires the plan id and expected digest.
- **Code placement.** Put pure helpers (chain check, node-set labelling, plan id) in a new module, e.g. `runtime-daemon/src/committed-change-acceptance.ts`, so the later #238 move does not need to move them. Keep `index.ts` growth minimal.
- **Exposure.** Not exposed through MCP.

## Tests To Add

- **Store** (`local-store-sqlite/test/local-store-sqlite.test.ts` plus `TestLocalStore`):
  - a transition is recorded only while the journal is pending;
  - readback works;
  - a malformed transition throws;
  - another root returns undefined.
- **Daemon** (`runtime-daemon/test/local-runtime.test.ts`):
  - YAML and dual modes record a transition;
  - projection-only and waiver drafts record none;
  - an injected engine that writes a model file mid-apply leaves no transition, and the apply still succeeds;
  - the envelope includes `journalId`;
  - the existing test near `:1343` is unchanged.
- **Pure helpers**, in a new `runtime-daemon/test/accepted-committed-change.test.ts`:
  - chain checking;
  - node-set labelling: carried children, relation-only, flow-only, proof-only rejected, deleted-node id rule;
  - the plan id is stable.
- **Integration**, in the same file (SQLite-backed temp git repo plus `MockCodeGraphProvider`, following `tests/ownership-change-acceptance-recovery.test.ts`):
  - Should accept:
    - node addition;
    - ownership-only change;
    - main journal plus a follow-up;
    - rename;
    - a moved container with children;
    - a waiver journal in between;
    - the same transition at a new HEAD gets the same eventId in a new scope.
  - Should refuse:
    - a hand edit before, between, or after the journals;
    - a missing follow-up, or a journal from before the baseline;
    - a padding journal;
    - a journal from another root, pending or aborted;
    - id mismatch, duplicate ids, wrong order, more than 32 journals;
    - a journal with no transition;
    - a non-standard node path, or a symlink segment;
    - an unprovable proof, or rejected projection entries;
    - digest mismatch, or plan-id mismatch after a re-baseline;
    - replay at the same snapshot;
    - a non-YAML mode;
    - the old request shape.
- **CLI end to end** (`cli/test/cli.test.ts`): preview → approve → `projection run` with the tuple → receipt recorded → `recover` delivers one refresh signal → drift is clean.

## Out Of Scope

- Consumer-side event resolution; recorded as a deferred todo.
- MCP exposure.
- Ledger graph authority promotion.
- Draft eviction.
- The #238 move-only extraction.

## Progress

- 2026-09-28 23:13: plan captured and approved; contract worktree `codex/changeset-acceptance-v2` created from `a4cc94b`.
- 2026-09-28 23:24: Commit A landed. Falsifier checked first in a `git archive a4cc94b` copy under `/tmp`: manifest `semanticBaseline.digests.modelDigest` equals `digestJson(loadNativeModelFromArchContext(root))` (`sha256:79c534fa…`). `applyAuthorizedUpdate` now captures the semantic file hashes and the NativeModel digest before apply for drafts that write `.archcontext/model/{nodes,relations,flows}/*.y(a)ml`, and the pre-commit hook records `archcontext.changeset-model-transition/v1` only after the re-hash check passes; the evidence path swallows its own failures. The hook is now installed for every apply so the envelope can return `journalId`; its return value is still `{journalCommitted: writesLedger && Boolean(journalId)}`, so YAML-mode commit behavior is unchanged. Helpers live in `runtime-daemon/src/committed-change-acceptance.ts`. **Persistence**: no schema migration. The transition is stored as a new `modelTransition` key inside the existing `changeset_journal.metadata_json` column, written only while `status = 'pending'`; older readers ignore unknown metadata keys, so this is additive and `git revert`-safe. `readCommittedChangeSet` validates the key's closed shape and fails closed when it is malformed.
- 2026-09-28 23:42: Commit B landed. `acceptCommittedChange` now takes `{journals[1..32], approved?, expectedWorktreeDigest?, acceptancePlanId?}`. The old four-field shape returns `AC_SCHEMA_INVALID`. The daemon method stays a thin shell. The decoder, chain check, last-writer file re-proof, node-set labelling, proof gate, plan id and v2 event builder live in `runtime-daemon/src/committed-change-acceptance.ts`, and `index.ts` shrank on net (2164 → 2121 lines) because the v1 issuance code and its binding helper were removed. The v1 payload type stays valid in the `AcceptedCommittedChangePayloadV1 | V2` union; recorded v1 events are untouched.
  - The approve call runs its own check, and so does the plan. The approve call recomputes the plan and requires the same `acceptancePlanId` and projection worktree digest. The plan re-runs `classifyArchitectureMajorChange` twice. The first run, without the reference, must reproduce the projection's observed sets. The second run, with the reference, must resolve to `refresh-required` with exactly those sets.
  - Decisions the notes left open:
    - `acceptedChange.changeSetId` is the first listed journal's changeSetId.
    - The plan also carries `fileSetDigest` over the semantic last writers. Every last writer's bytes are re-hashed against the journal, so a byte-level hand edit that leaves the model unchanged is also refused.
    - The CLI refuses a mix of `--journal` and `--journal-id`/`--changeset-id`, and refuses `--acceptance-plan-id`/`--expected-worktree-digest` without `--approved`.
    - The preview envelope is `{status: "preview", plan, acceptancePlanId, acceptedChange, expectedWorktreeDigest}`.
  - Known strictness: the proof gate follows these notes exactly (a proof-only capability needs a journaled write to one of its flow files). A flow-participant rename in another capability therefore moves this capability's proof without explaining it, and is refused. This fails closed.
  - The CLI end-to-end test runs a real `codegraph init`, because refresh-signal delivery re-proves a ready CodeGraph snapshot.
  - **Persistence**: none in this commit. v2 events use the existing `architecture_events` table; the payload lives in `payload_json`, and the idempotency key has the distinct prefix `architecture-ledger-accepted-committed/v2:`.
