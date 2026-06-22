# FG6 Release Distribution Readback

- Task: FG6 release distribution precondition
- Environment: release-distribution
- Home URL: https://archcontext.repoharness.com
- Generated At: 2026-06-22T04:15:51.849Z
- Status: verified

## Decision

PASS: public install command is `npm install -g archctx`.

## Registry

- `archcontext`: missing (E404)
- `@archcontext/cli`: missing (E404)
- `archctx`: published 0.1.0

## Local Manifests

- Root package: `archcontext` 0.1.0, private=true
- Publishable manifests exposing `archctx`: 0
- Placeholder package: `archctx` 0.0.0
- Dry-run package: `archctx` 0.1.0, ok=true

## Rollout Implication

FG6-18 design-partner and opt-in beta rollout now has a public release artifact precondition: `archctx@0.1.0` is published and installable from npm. Staging Cloudflare deploy and local tarball smoke remain insufficient as rollout evidence; the next required evidence is real internal, design-partner, and opt-in beta telemetry gathered through the public install path.
