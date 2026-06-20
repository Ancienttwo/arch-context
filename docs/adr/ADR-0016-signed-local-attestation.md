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

The local runtime signs Attestation v2, bound to challenge nonce, installation, repository numeric ID, pull request number, head/base/tree identity, worktree/model/policy/code-facts/review digests, runtime build digest, key identity, and expiry.

Publishable Developer Review must execute against an exact detached clean worktree for the Challenge head. Agent, MCP, and CLI inputs cannot provide `result`, digest fields, or signature material; those values come from the completed runtime review session and signer boundary.

# Consequences

- New commits invalidate old attestations.
- Developer attestation is not marketed as tamper-proof CI.
- v1 attestations are scaffold only and cannot satisfy Organization Runner requiredTrust.
- Cross-platform canonicalization fixtures are required before Beta.
