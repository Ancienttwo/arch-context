# ArchContext AL10 GPT Pro Advisory Architecture/Security Review

> **Review outcome**: Rejected
> **Date**: 2026-06-27
> **Reviewer**: GPT-5.5 Pro external AI reviewer
> **Scope**: AL10-GA-6 readiness, `ledger-authoritative` promotion readiness,
> enforcement enablement readiness, production GA readiness, and local opt-in
> advisory beta boundary.

## Independence Statement

The reviewer states independence from the patch author, release owner, subagent
output author, and automation that generated the evidence. The reviewer also
states a limiting condition: as an external AI reviewer, GPT-5.5 Pro cannot
satisfy the repository policy that requires one human independent reviewer for
`ledger-authoritative` promotion or blocking enforcement enablement.

## Sources Inspected

The reviewer reports inspecting PR #84, branch
`codex/architecture-ledger-al10-external-acceptance-packet`, the AL10 authority
and promotion documents, AL10 technical/readback/release evidence, remaining
external acceptance artifacts, MCP/local runtime acceptance evidence, npm beta
evidence for `archctx@0.1.4-beta.0`, and GitHub verification evidence.

The review notes that PR #84 had already been merged into
`codex/architecture-ledger-al10-ga-technical-gates` when the review was
performed.

## Executive Decision

The reviewer rejects PR #84 as sufficient basis for:

- AL10-GA-6 closure.
- `ledger-authoritative` promotion.
- Enforcement enablement.
- Production GA.

The reviewer supports only continued local opt-in advisory beta within the
existing `archctx@0.1.4-beta.0` beta boundary. This does not imply AL10 external
acceptance, promotion, enforcement enablement, or production GA.

## Architecture Review Summary

Positive findings:

- ADR-0040 preserves the intended hybrid authority split.
- `.archcontext/` remains the Git-visible review and collaboration boundary
  until explicit promotion.
- SQLite remains operational audit/event state before promotion.
- Ledger-affecting writes are restricted to ChangeSet lifecycle or
  daemon-owned transactional event append.
- CLI, MCP, hooks, agents, and subagents remain triggers, readers, status
  surfaces, or proposal producers rather than authority writers.
- The MCP runtime auto-start fix preserves the thin CLI/MCP adapter invariant
  by using the same daemon/RPC path instead of creating a second runtime.

Blockers:

- The repository policy still requires a human independent reviewer for
  promotion or blocking enforcement.
- The canonical approval artifact remains pending.
- Rollback safety is not production-drill verified.
- AL10-GA-6 cannot be closed by this AI advisory review.

## Security Review Summary

Positive findings:

- The reviewed evidence is directionally positive for stale write rejection,
  tamper checks, path/symlink handling, caller-controlled attestation rejection,
  and aggregate no-private-content counters for AL10-GA-1 through AL10-GA-5.
- Subagent direct mutation remains forbidden by the design and contracts.
- MCP completion paths reject caller-provided attestation fields.

Blockers and required follow-ups:

- Human independent approval is still missing.
- Production rollback drill evidence is still missing.
- Beta-user interview evidence is still missing.
- The hook enqueue p95 beta-budget miss remains unresolved or unaccepted by a
  human reviewer/release owner.
- Privacy/runtime-state evidence should explicitly cover representative SQLite,
  logs, and artifact scans for raw source bodies, raw diffs or patches,
  prompt/completion bodies, full CodeGraph output, secret-like tokens, private
  keys, and raw webhook/source payloads before promotion or enforcement.

## Gate Assessment

| Gate | Status | Reason |
| --- | --- | --- |
| AL10-14 beta-user interviews | BLOCKED | Canonical beta-user interview evidence is missing or not verified. |
| AL10-GA-6 independent architecture/security review | BLOCKED | Human independent reviewer approval is missing; AI advisory review cannot satisfy the policy. |
| AL10-GA-7 production rollback drill | BLOCKED | Canonical production rollback drill evidence is missing or not verified. |

## Approval Boundary

- Approved for continued local opt-in advisory beta only.
- Not approved for AL10-GA-6 closure.
- Not approved for `ledger-authoritative` promotion.
- Not approved for enforcement enablement.
- Not approved for production GA.
- Green CI, npm beta publication, FG6 artifacts, M6 artifacts, generated
  readbacks, and this AI advisory review are not substitutes for the required
  AL10 human independent approval.

## Required Changes Before Approval

1. Record verified real beta-user interview evidence in
   `docs/verification/architecture-ledger-al10-beta-user-interviews.md`.
2. Record human independent architecture and security approval in
   `docs/approvals/architecture-ledger-al10-independent-review.md`.
3. Record verified production or explicitly accepted production-equivalent
   rollback drill evidence in
   `docs/verification/architecture-ledger-al10-production-rollback-drill.md`.
4. Resolve the hook enqueue p95 beta-budget miss or record explicit human risk
   acceptance.
5. Strengthen canonical privacy/runtime-state scan evidence for representative
   runtime SQLite, logs, and artifacts.
6. Rerun the AL10 external acceptance readback only after the canonical artifacts
   are present.
