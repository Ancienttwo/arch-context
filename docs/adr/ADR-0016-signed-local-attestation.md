---
schemaVersion: archcontext.adr/v1
id: adr.0016.signed-local-attestation
title: Signed Local Attestation
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.attestation
supersedes: []
---

# Context

SaaS needs a minimal proof that local review occurred against the current PR head without receiving findings or code.

# Decision

The local runtime signs an attestation bound to challenge nonce, repository, head SHA, worktree digest, review digest, device key, and expiry.

# Consequences

- New commits invalidate old attestations.
- Developer attestation is not marketed as tamper-proof CI.
