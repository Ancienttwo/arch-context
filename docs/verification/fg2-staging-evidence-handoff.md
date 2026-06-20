# FG2 Staging Evidence Handoff

Date: 2026-06-20

## Result

Status: blocked on install revoke E2E only.

This packet coordinates the remaining FG2 staging-only evidence. FG2-02, FG2-17, FG2-EG1, FG2-EG4, FG2-EG5, and FG2-EG6 are verified; FG2-EG7 remains blocked. Completion requires replacing the pending JSON packet with sanitized revoke proof and running the strict readback command successfully.

## Gates Covered

| Gate | Status | Evidence Surface |
|---|---|---|
| `FG2-02` | verified | Ruleset expected-source permission decision |
| `FG2-17` | verified | Staging GitHub egress and log/trace/queue DLP export |
| `FG2-EG1` | verified | Real GitHub App PR event plus Check create/update readback |
| `FG2-EG4` | verified | Zero PR Files, Contents, Blob, Tree, Diff, and Patch egress |
| `FG2-EG5` | verified | Zero bait hits in Cloud log, trace, and queue surfaces |
| `FG2-EG6` | verified | Ruleset expected-source decision record |
| `FG2-EG7` | blocked | Install revoke E2E proof |

## Required Evidence

1. Deploy a staging GitHub App and install it on a staging repository.
2. Trigger a staging PR event and record sanitized proof that the App received the event, created a Check, and updated that Check.
3. Export sanitized GitHub egress recorder output and staging log/trace/queue DLP counts into `docs/verification/fg2-egress-recording.json`.
4. Revoke the staging installation and record sanitized proof that token use, challenge creation, and Check update stop after revoke.
5. Replace `docs/verification/fg2-staging-evidence.json` with `status: "verified"` and the required evidence fields.

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

This handoff is sufficient because it binds the remaining FG2 revoke gate to one machine-readable packet plus the existing egress/DLP readback. It is not sufficient to start FG3 or mark FG2 complete until strict readback returns OK and the sprint ledger is updated gate by gate.
