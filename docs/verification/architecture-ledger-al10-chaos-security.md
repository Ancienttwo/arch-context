# AL10 Chaos and Security Readback

Status: verified

Gates closed by this packet: AL10-05, AL10-06

Explicitly open: AL10-BETA-4, AL10-GA-1, AL10-GA-2, AL10-GA-3, AL10-GA-4, AL10-GA-5, AL10-GA-6

## Chaos Matrix

| Case | Status | Reason | Guard |
| --- | --- | --- | --- |
| daemon-crash | pass | dead-connection-pid,stale-lock-file | recoverStaleDaemonControlFiles |
| db-lock | pass | database-locked | sqlite busy lock rejection |
| disk-full | pass | filesystem-write-failure | backupArchitectureLedger write-path failure handling |
| corrupt-row | pass | materialized-current-state-does-not-match-replay | checkArchitectureLedgerIntegrity |
| interrupted-rebase | pass | AC_SCHEMA_INVALID | ledger rebuild --from-git YAML parser and stale write guard |
| provider-timeout | pass | timeout | runInvestigationWithRetry deterministic fallback |

## Security Matrix

| Case | Status | Reason | Guard |
| --- | --- | --- | --- |
| prompt-injection | pass | tool-escape-forbidden | planInvestigationReportProposal and runInvestigationThroughPort |
| path-traversal | pass | repo-relative-path-required | assertRepoRelativePath |
| symlink-escape | pass | legacy-sqlite-symlink-rejected | migrateLegacyLocalStoreIfNeeded trusted legacy source check |
| forged-evidence | pass | AC_SCHEMA_INVALID,AC_SCHEMA_INVALID,AC_SCHEMA_INVALID | CLI review/complete caller-provided attestation field rejection |
| event-tamper | pass | materialized-current-state-does-not-match-replay | checkArchitectureLedgerIntegrity replay/materialized digest comparison |
| stale-replay | pass | AC_CONTEXT_STALE | runtime jobsComplete stale head/worktree rejection |

## Privacy

- clean: true
- forbiddenKeyHits: 0
- forbiddenTokenHits: 0

## Readback

```sh
bun scripts/architecture-ledger-al10-chaos-security-readback.ts inspect --evidence docs/verification/architecture-ledger-al10-chaos-security-readback.json --json
```

