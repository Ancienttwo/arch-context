# FG2 Staging Evidence Handoff

Date: 2026-06-20

## Result

Status: verified.

This packet records the completed FG2 staging-only evidence. FG2-02, FG2-17, FG2-EG1, FG2-EG4, FG2-EG5, FG2-EG6, and FG2-EG7 are verified. Completion replaced the pending JSON packet with sanitized revoke proof and strict readback now succeeds.

## Gates Covered

| Gate | Status | Evidence Surface |
|---|---|---|
| `FG2-02` | verified | Ruleset expected-source permission decision |
| `FG2-17` | verified | Staging GitHub egress and log/trace/queue DLP export |
| `FG2-EG1` | verified | Real GitHub App PR event plus Check create/update readback |
| `FG2-EG4` | verified | Zero PR Files, Contents, Blob, Tree, Diff, and Patch egress |
| `FG2-EG5` | verified | Zero bait hits in Cloud log, trace, and queue surfaces |
| `FG2-EG6` | verified | Ruleset expected-source decision record |
| `FG2-EG7` | verified | Install revoke E2E proof |

## Required Evidence

1. Deploy a staging GitHub App and install it on a staging repository.
2. Trigger a staging PR event and record sanitized proof that the App received the event, created a Check, and updated that Check.
3. Export sanitized GitHub egress recorder output and staging log/trace/queue DLP counts into `docs/verification/fg2-egress-recording.json`.
4. Revoke the staging installation with reversible suspend/unsuspend and record sanitized proof that token use, challenge creation, and Check update stop after revoke.
5. Replace `docs/verification/fg2-staging-evidence.json` with `status: "verified"` and the required evidence fields.

The revoke proof is recorded in `docs/verification/fg2-install-revoke-readback.json`. It records only sanitized request IDs, statuses, delivery ID, check metadata, and booleans; it does not persist GitHub tokens, private keys, webhook signatures, webhook body content, or source content.

## Commands

Allow-pending readback for local development:

```bash
bun run readback:fg2:staging
```

Strict completion readback:

```bash
node scripts/fg2-staging-evidence-readback.mjs readback \
  --packet docs/verification/fg2-staging-evidence.json
```

Underlying egress/DLP readback:

```bash
node scripts/github-egress-recording-readback.mjs readback \
  --recording docs/verification/fg2-egress-recording.json
```

Install revoke readback:

```bash
bun run readback:fg2:install-revoke
```

## Boundary

This handoff is sufficient because it binds the FG2 revoke gate to one machine-readable packet plus the existing egress/DLP readback. FG3 remains blocked by the sprint plan until FG2 completion is reflected in the strict readback, acceptance ledger, and sprint status checks.
