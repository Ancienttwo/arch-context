---
schemaVersion: archcontext.adr/v1
id: adr.0035.github-governance-privacy-contract
title: GitHub Governance Privacy Contract
status: accepted
decidedAt: 2026-06-20
appliesTo:
  - package.github-app
  - package.control-plane
  - package.cloud-db
supersedes: []
---

# Context

The privacy boundary cannot rely on permission wording alone. A safe GitHub App can still become unsafe if generic API clients, raw webhook bodies, logs, queue payloads, or database schemas admit code content fields.

# Decision

ArchContext Cloud uses a typed API allowlist, egress envelope, DTO allowlist, runtime recursive privacy audit, queue serialization audit, D1 schema audit, and structured log projection. It must not request, process, or store Repository Contents, PR Files, Blob, Tree, Diff/Patch, filenames, symbols, model bodies, prompts, completions, or detailed findings.

Cloud evidence stores only minimum metadata: IDs, SHAs, digests, status, reason code, latency, and retry state.

# Consequences

- "No Contents permission" is not the full product claim.
- Static and dynamic privacy contract tests are required for GitHub Governance.
- Evidence files may reference redacted installation and repository IDs, but not private code content.
