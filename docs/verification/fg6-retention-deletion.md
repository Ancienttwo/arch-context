# FG6-15 Retention and Deletion Readback

- Task: FG6-15
- Environment: staging-release-readback
- Generated At: 2026-06-21T20:00:24.850Z
- Status: verified

## Coverage

| Surface | Evidence | Result |
|---|---|---|
| Remote D1 retention purge | docs/verification/fg5-retention-staging-readback.json | expired rows remaining 0; recent rows preserved 8; authorization rows 0 |
| Installation revoke | docs/verification/fg2-install-revoke-readback.json | token rejected true; Challenge stopped true; Check stopped true; restored true |
| Account delete | in-memory Control Plane probe | account deleted true; devices after delete 0; revoked marker after delete false; scoped notification provider after delete false |

## Decision

PASS for FG6-15 retention, installation revoke, and account-delete release drill.
