# Trusted Runner Setup

## Boundary

Trusted Runner is a customer-controlled execution mode for `archctx review`. It signs an organization attestation bound to a GitHub Installation, HEAD SHA, worktree digest, review digest, nonce and runner identity.

It does not make ArchContext SaaS a build service, code analysis host, or zero-trust runtime. The runner uploads only attestation metadata, digests and signature.

## Minimal GitHub Actions Shape

```yaml
name: ArchContext Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  archcontext:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun test
      - run: archctx review --runner --challenge "$ARCHCONTEXT_CHALLENGE"
```

## Verification

- Runner identity is registered with `schemaVersion: archcontext.org-runner-identity/v1`.
- Check Run must show `Organization-attested`.
- Revoked runner identity must fail future verification.
- Network capture must show no repository bodies or detailed findings to ArchContext SaaS.
