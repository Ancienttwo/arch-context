# Threat Model v1

## Scope

ArchContext MVP plus Sprint 2 spans a local runtime, repository `.archcontext/` files, CodeGraph adapter, multi-repo landscape metadata, CLI/MCP surfaces, ChatGPT tunnel, Cloudflare control plane, GitHub App, Stripe webhooks, signed developer attestations, and customer-controlled runner attestations.

Out of scope: generic source code security review, customer CI hardening beyond runner identity binding, Slack, hosted code analysis, SSO, SCIM, centralized policy distribution, and organization billing administration.

## Primary Assets

| Asset | Boundary |
|---|---|
| Source code, diffs, symbols, CodeGraph output | Local only |
| `.archcontext/` model, ADRs, policies | Repository Git |
| SQLite derived state | Local app data |
| Device private key | OS keychain only |
| Org runner private key | Customer-controlled runner only |
| Attestation challenge and public proof | SaaS D1 |
| GitHub installation and check metadata | SaaS D1 |
| Stripe customer/subscription state | SaaS D1 |
| Landscape numeric repository IDs | SaaS D1 |

## Threats and Controls

| Threat | Impact | Control |
|---|---|---|
| SaaS receives code content | Breaks product trust boundary | Route allowlist, schema audit, log redaction, privacy tests |
| Path traversal in ChangeSet | Writes outside repository model | Canonical path resolution, allowlist, symlink check, expected digest |
| Stale context apply | Model writes based on old HEAD | HEAD/worktree/model digest preconditions |
| Attestation replay | Old review passes new commit | Challenge nonce, head SHA, expiry, single-use challenge |
| Unjustified compatibility | Permanent fallback debt | CompatibilityContract requirement and review finding |
| CodeGraph adapter drift | Incorrect architecture evidence | Exact version, capability check, golden fixtures |
| MCP prompt injection | Tool misuse or oversized content | Five workflow tools by default, resource indirection, budgets, write confirmation |
| ChatGPT tunnel overexposure | Private details sent to OpenAI unintentionally | Explicit opt-in, scope, data classification, apply disabled by default |
| Local DB corruption | Runtime cannot recover | Rebuild from Git model and CodeGraph; snapshots |
| Cross-repo content leaves device | Breaks multi-repo trust boundary | Landscape context is local; SaaS only receives numeric repository and installation IDs |
| Runner trust overstated | Users treat organization-attested as tamper-proof | Check copy and ADR state organization-controlled is higher provenance, not zero-trust |
| Runner key compromised or stale | Forged organization attestations | Runner identity binding, installation check, public key rotation, revocation |
| Annual entitlement mis-scoped | Accidental team billing path | Entitlement schema has billing interval and per-person scope, no seat pool or org billing fields |

## Security Invariants

1. Cloud routes never accept source, diff, symbol, CodeGraph payloads, architecture model bodies, or detailed findings.
2. Repository writes are ChangeSet-only.
3. Every write binds repository, HEAD SHA, worktree digest, and expected file digest.
4. Attestation payloads contain only minimal proof metadata.
5. Device private keys never enter repository files, SQLite, D1, logs, or tool output.
6. Organization runner keys stay in the customer's runner environment.
7. Organization-attested means customer-controlled provenance, not a guarantee of an untampered environment.
8. Multi-repo collaboration and conflict handling remain Git/worktree responsibilities.
