# FG2 Staging Evidence Handoff

Date: 2026-06-20

## Result

Status: blocked.

This packet coordinates the remaining FG2 staging-only evidence. It does not mark any FG2 staging gate complete. Completion requires replacing the pending JSON packet with sanitized staging proof and running the strict readback command successfully.

## Gates Covered

| Gate | Status | Evidence Surface |
|---|---|---|
| `FG2-02` | blocked | Ruleset expected-source permission decision |
| `FG2-17` | blocked | Staging GitHub egress and log/trace/queue DLP export |
| `FG2-EG1` | blocked | Real GitHub App PR event plus Check create/update readback |
| `FG2-EG4` | blocked | Zero PR Files, Contents, Blob, Tree, Diff, and Patch egress |
| `FG2-EG5` | blocked | Zero bait hits in Cloud log, trace, and queue surfaces |
| `FG2-EG6` | blocked | Ruleset expected-source decision record |
| `FG2-EG7` | blocked | Install revoke E2E proof |

## Required Evidence

1. Deploy a staging GitHub App and install it on a staging repository.
2. Trigger a staging PR event and record sanitized proof that the App received the event, created a Check, and updated that Check.
3. Export sanitized GitHub egress recorder output and staging log/trace/queue DLP counts into `docs/verification/fg2-egress-recording.json`.
4. Record the ruleset expected-source result. If Commit Statuses becomes required, update the permission manifest, ADR, install disclosure, and evidence before marking `FG2-02` or `FG2-EG6` complete.
5. Revoke the staging installation and record sanitized proof that token use, challenge creation, and Check update stop after revoke.
6. Replace `docs/verification/fg2-staging-evidence.json` with `status: "verified"` and the required evidence fields.

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

## Boundary

This handoff is sufficient because it binds every remaining FG2 staging gate to one machine-readable packet plus the existing egress/DLP readback. It is not sufficient to start FG3 or mark FG2 complete until strict readback returns OK and the sprint ledger is updated gate by gate.
