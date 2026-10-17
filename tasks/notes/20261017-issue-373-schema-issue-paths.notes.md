# Issue 373: Native model issue paths

## Goal

Report the parsed source path for native model schema and reference issues.
Keep old contracts callers valid. Commit on `fix/373-schema-issue-paths`.
Do not push, open a PR, or merge.

## P1: Boundary

The CLI calls the stateless model reader. `capture` parses each input and knows
its repository-relative path. Contracts validate shapes and references.
`nativeFactsFor` validates and bounds public failure details.

## P2: Trace

Both ref and worktree sources call `capture`. The reader puts each record in
the model, but indexes paths by entity ID. Duplicate IDs overwrite that index.
Missing or non-string IDs have no index entry. `nativeContextModelIssues`
returns only entityId, field, and invariant. The strict failure boundary also
accepts only those three issue fields.

## P3: Decision

Add an optional record-to-path map to the validator. Bind parsed record objects
to paths in `capture`. Pass the owner record for both validation phases.
Keep existing issue fields, validation order, reason codes, and diagnostic limits.
Add optional `path` to the issue contract. Set details.path when all reported
issues share one source path after diagnostic limits. The failure boundary owns
that summary because it can omit whole issues. Do not infer paths from IDs.

## Task Breakdown

- Add tests for mismatched, duplicate, missing, and non-string IDs.
- Add reference-phase, old-caller, public failure, and CLI coverage.
- Confirm the new tests fail on the old implementation.
- Update contracts, the reader, the public issue schema, and the runbook.
- Run typecheck, affected tests, and the requested affected CI command.
- Run one read-only Herdr review of implementation and test changes.
- Review the diff and commit the authorized files.

## Risk and rollback

The diagnostic contract is additive. Keep own-data checks and byte limits.
No ledger, checked-in model YAML, or runtime state changes are needed.
Revert this commit to restore the previous diagnostic shape.

## Changes

- Contracts accept optional record paths and return optional issue paths.
- The reader binds each parsed record to its input path.
- The strict failure boundary accepts path as an own string field.
- The boundary derives a common path after whole-issue omission.
- A public JSON schema and runbook describe the additive contract.
- Tests cover both source selectors, invalid and duplicate IDs, reference owners,
  old callers, public failure validation, real CLI output, and diagnostic budgets.

No previous test assertion was removed or weakened. Two new assertions were
corrected during verification. The expected entity ID uses a string literal.
The public boundary test compares the full failure value, not error object
identity. That boundary already creates a new FailureError for ordinary failures.

## Verification

All test commands use `TMPDIR=$PWD/_ops/373/tmp`. Fixtures stay in this worktree.

- Before implementation, the five affected test files returned 136 pass and
  34 fail. Exit 1. The new path tests exposed the old missing paths.
- A separate budget regression returned 0 pass and 1 fail. Exit 1. Omission
  left one source path but no top-level summary.
- The first implementation run returned 169 pass and 1 fail. Exit 1.
  The failed new object-identity assertion was corrected as described above.
- The first typecheck failed on the new expected-value type. Exit 1.
- Final `bun run typecheck`: pass, exit 0.
- Before review follow-up, the seven files returned 438 pass, 0 fail, exit 0.
- The conflicting-path regression returned 0 pass, 1 fail before its fix. Exit 1.
- After review follow-up, typecheck passed again. Exit 0.
- Final `bun test` over the following files: 439 pass, 0 fail, exit 0.
  - packages/contracts/test/native-context.test.ts
  - packages/contracts/test/public-operation-failures.test.ts
  - packages/contracts/test/failure-envelope.test.ts
  - packages/contracts/test/contracts.test.ts
  - packages/local-runtime/model-store-yaml/test/native-context.test.ts
  - packages/local-runtime/runtime-daemon/test/public-operation-failures.test.ts
  - packages/surfaces/cli/test/native-context.test.ts
- `git diff --check`: pass, exit 0.
- `bash scripts/check-ci.sh affected --base origin/main`: unavailable, exit 127.
  This checkout has no scripts/check-ci.sh.
- `repo-harness run check-ci affected --base origin/main`: unavailable, exit 2.
  The installed package has no check-ci helper. This is not a passed CI check.

Logs are in ignored `_ops/373/`. No debug output was added to product code.
The required affected CI command remains a verification gap.

## Read-only review

Claude Opus reviewed the implementation and tests through Herdr in this worktree.
It found no test changes that hide a bug. It accepted the additive API and the
post-omission path summary. It reported no blocking findings.

The follow-up addresses its two medium findings. Source-aware issues now override
a conflicting caller summary. Legacy issues still keep their explicit path.
The runbook explains that path-unsafe model issues identify the declaring file.
The missing-ID and numeric-ID test now checks each path and invariant separately.
The final checks above include these changes.

The reviewer noted the separate resolve/validate reader. That reader is outside
native export scope. It also questioned schema packaging. The release stage
copies all schemas and defines public files and exports in
scripts/contracts-release-stage.mjs. The reviewer withdrew that packaging finding.
Source paths count toward the existing diagnostic budget. The runbook records this.

No architecture projection or index was generated. The review hook requested a
projection check; it reported a missing CodeGraph index. Model and runtime writes
remain outside this task.
