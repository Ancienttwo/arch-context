# FG2 GitHub Privacy Verification

- Commit SHAs:
  - pending backfill — FG2-01 GitHub App permission manifest
- Environment: local checkout `/Users/chris/Projects/arch-context`
- GitHub App Installation ID: not used for FG2-01
- Started At: 2026-06-20

## Scope

This evidence currently covers FG2-01 only.

- `GITHUB_APP_PERMISSION_MANIFEST` is contracts-owned in `packages/contracts/src/github-governance.ts`.
- The default repository permissions are exactly Metadata read, Pull Requests read, Checks write, and Contents none.
- Actions, Administration, Deployments, Issues, Members, Secrets, and Workflows are forbidden by default.
- Commit Statuses remains `none` and is documented as conditional on FG2-02 / FG2-EG6 staging evidence.
- Subscribed events are frozen to installation, installation repositories, pull request opened/reopened/synchronize/closed, and check run rerequested.
- `packages/cloud/github-app/src/index.ts` now derives `GITHUB_APP_PERMISSIONS` from the contracts manifest instead of maintaining a separate local copy.

## Commands

```bash
bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts
bun run typecheck
```

## Results

- `bun test packages/contracts/test/contracts.test.ts packages/cloud/github-app/test/github-app.test.ts`: PASS, 87 tests.
- `bun run typecheck`: PASS.

## Negative Tests

- Contract tests reject drift from the exact permission manifest.
- GitHub App tests reject adapter drift away from the contracts-owned repository permission object.

## Known Limitations

FG2 is not complete. This slice does not claim staging GitHub App readback, Commit Statuses expected-source proof, webhook privacy projection, GitHub API allowlist, egress recording, or install/revoke lifecycle handling.

## Decision

PARTIAL PASS for FG2-01. Remaining FG2 tasks and exit gates stay open.
