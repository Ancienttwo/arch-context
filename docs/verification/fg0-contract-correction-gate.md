# FG0 Verification

- Commit SHA: pending final commit
- Build/Artifact Digest: not applicable for contract slice
- Environment: local checkout `/Users/ancienttwo/Projects/arch-context`
- GitHub App Installation ID: not used in FG0
- Test Repository ID: not used in FG0
- Started At: 2026-06-20
- Completed At: 2026-06-20
- Reviewer: Codex execution under user goal

## Scope

FG0 freezes the governance contract before deeper integration work:

- Local Core is independent of GitHub App, Cloud account, subscription, and LLM provider.
- GitHub App is an optional governance bridge and not a code executor.
- Developer Review and Organization Runner use distinct check contexts.
- ReviewChallenge v2, Attestation v2, identity, check delivery, egress envelope, reason code, and state-machine contracts are machine-checkable.
- Acceptance ledger prevents marking completed tasks without evidence.

## Commands

```bash
bun test packages/contracts/test/contracts.test.ts
bun test packages/cloud/github-app/test/github-app.test.ts
bun run verify:acceptance-ledger
```

## Results

- `bun test packages/contracts/test/contracts.test.ts`: PASS, 80 tests.
- `bun test packages/cloud/github-app/test/github-app.test.ts`: PASS, 3 tests.
- `bun run verify:acceptance-ledger`: PASS, 23 ledger entries.
- `rg -n "ArchContext / Architecture Review" packages docs plans --glob '!docs/researches/**'`: PASS, no active-source matches.
- `bun run verify`: PASS, 260 tests plus package boundary audit, packaged CLI smoke, privacy route audit, packet capture audit, privacy/security manifest readback, acceptance ledger, sprint status check, and representative eval.

## Negative Tests

- Invalid v2 fixtures reject private content fields such as `filename`, `finding`, and `patch`.
- `check-delivery` rejects the legacy single check name.
- `satisfiesRequiredTrust("developer", "organization")` returns false.
- Illegal challenge and check-delivery backward transitions return false.

## Privacy Scan

FG0 privacy evidence is contract-level:

- `CloudEgressEnvelope` contains only endpoint category, method, host, path template, status, latency, request ID, and timestamp.
- DTO schemas deny source, diff, patch, filename, symbol, finding, prompt, completion, and LLM provider fields through `additionalProperties: false`.

## Known Limitations

FG0 is E0/E1. It does not claim real GitHub staging, durable control-plane persistence, exact worktree execution, or runner evidence. Those remain FG1-FG6.

## Linked CI / GitHub Run IDs

None for local FG0.

## Decision

PASS. FG0 is complete at E0/E1 maturity only; FG1-FG6 remain unstarted.
