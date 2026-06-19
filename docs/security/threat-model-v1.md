# Threat Model v1

## Scope

ArchContext MVP spans a local runtime, repository `.archcontext/` files, CodeGraph adapter, CLI/MCP surfaces, ChatGPT tunnel, Cloudflare control plane, GitHub App, Stripe webhooks, and signed local attestations.

Out of scope: generic source code security review, organization runner hardening, Slack, multi-repo graph, and hosted code analysis.

## Primary Assets

| Asset | Boundary |
|---|---|
| Source code, diffs, symbols, CodeGraph output | Local only |
| `.archcontext/` model, ADRs, policies | Repository Git |
| SQLite derived state | Local app data |
| Device private key | OS keychain only |
| Attestation challenge and public proof | SaaS D1 |
| GitHub installation and check metadata | SaaS D1 |
| Stripe customer/subscription state | SaaS D1 |

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

## Security Invariants

1. Cloud routes never accept source, diff, symbol, CodeGraph payloads, architecture model bodies, or detailed findings.
2. Repository writes are ChangeSet-only.
3. Every write binds repository, HEAD SHA, worktree digest, and expected file digest.
4. Attestation payloads contain only minimal proof metadata.
5. Device private keys never enter repository files, SQLite, D1, logs, or tool output.
