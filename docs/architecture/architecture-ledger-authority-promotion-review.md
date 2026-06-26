# Architecture Ledger Authority Promotion Review

> Status: AL10 required policy
> Scope: authority promotion and enforcement enablement
> Source gates: AL10-15, AL10-16

## Requirement

Any authority promotion to `ledger-authoritative`, or any change from advisory
readback to blocking enforcement enablement, requires one independent reviewer.

The independent reviewer must be a human reviewer who is independent from the
patch author, release owner, subagent output author, and automation that
generated the evidence. The review must be recorded before promotion or
enforcement is enabled.

The approval artifact must live under `docs/approvals/` or link to an external
human review artifact from that directory. The artifact must include the review
scope, date, reviewer identity, approved boundary, and unresolved risk decision.
There is no self-attestation: automation, generated evidence, subagents, and
the author of the implementation cannot approve the promotion.

## Review Coverage

The independent reviewer must inspect:

- `docs/adr/ADR-0040-hybrid-architecture-ledger.md`
- `docs/architecture/architecture-ledger-authority-matrix.md`
- verified AL10 rollout, benchmark, hardening, chaos/security, recommendation,
  agent comparison, release packaging, runbook, and telemetry readbacks
- AL10-14 beta-user interview evidence for whether Book answers replace manual
  filesystem browsing
- privacy/storage evidence showing the ledger does not persist raw source body,
  raw diff or patch body, prompt body, completion body, full CodeGraph output,
  secrets, credentials, or private keys
- rollback evidence proving recovery to YAML authority remains available
- unresolved risks and explicitly open GA gates

## Current Decision

Decision: NO-GO for ledger-authoritative promotion and enforcement enablement.

Allowed: local opt-in advisory beta/readback may continue. This keeps SQLite as
operational runtime state and keeps `.archcontext/` as the Git-visible review
and projection boundary.

Blocked until:

- AL10-14 has real beta-user interview evidence.
- An independent reviewer records approval under `docs/approvals/`.
- The `hook-enqueue-p95-beta-budget` risk is accepted or resolved.
- AL10-GA-1 through AL10-GA-7 are closed by verified evidence.

## Invariants

- Ledger-affecting writes still pass through ChangeSet or daemon-owned
  transactional append paths.
- CLI, MCP, hooks, scripts, and subagents remain triggers, readers, or proposal
  producers unless an explicit command crosses the ChangeSet or daemon boundary.
- Subagents may draft typed proposals only; they must not directly mutate the
  ledger, YAML, docs, policies, or waivers.
- Advisory recommendations must not become hard completion gates without
  explicit policy, quality evidence, and independent reviewer approval.
- SQLite ledger state must not become the only recoverable copy before accepted
  promotion.
