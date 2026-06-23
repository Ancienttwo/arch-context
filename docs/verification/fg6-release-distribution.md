# FG6 Release Distribution Readback

- Task: FG6 release distribution precondition
- Environment: release-distribution
- Home URL: https://archcontext.repoharness.com
- Generated At: 2026-06-23T10:10:54.445Z
- Status: verified

## Decision

PASS: public install command is `npm install -g archctx`.

## Registry

- `archcontext`: missing (E404)
- `@archcontext/cli`: missing (E404)
- `archctx`: published 0.1.3

## Local Manifests

- Root package: `archcontext` 0.1.3, private=true
- Publishable manifests exposing `archctx`: 0
- Placeholder package: missing
- Dry-run package: `archctx` 0.1.3, ok=true

## Rollout Implication

FG6-18 design-partner and opt-in beta rollout must remain deferred until this readback passes on a real public release artifact. Staging Cloudflare deploy and local tarball smoke are not a substitute for npm release distribution. When the dry-run package is verified but registry publication is still missing, the next action is npm publication, not design-partner rollout.
