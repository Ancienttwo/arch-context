# Threat Model v1

## Scope

ArchContext MVP plus Sprint 2 spans a local runtime, repository `.archcontext/` files, CodeGraph adapter, multi-repo landscape metadata, CLI/MCP surfaces, ChatGPT tunnel, Cloudflare control plane, Stripe webhooks, and the AL0 hybrid architecture-ledger contract.

Out of scope: generic source code security review, customer CI hardening, Slack, hosted code analysis, SSO, SCIM, centralized policy distribution, and organization billing administration.

## Primary Assets

| Asset | Boundary |
|---|---|
| Source code, diffs, symbols, CodeGraph output | Local only |
| `.archcontext/` model, ADRs, policies | Repository Git |
| SQLite runtime and future architecture ledger | Local app data |
| Architecture ledger events, snapshots, evidence bindings, recommendation runs, and agent jobs | Local app data; rebuildable or reconcilable from Git projections and observed code facts until authority promotion |
| Cloud egress recorder envelopes | SaaS logs, metadata only |
| Stripe customer/subscription state | SaaS D1 |
| Landscape numeric repository IDs | SaaS D1 |

## Threats and Controls

| Threat | Impact | Control |
|---|---|---|
| SaaS receives code content | Breaks product trust boundary | Route allowlist, schema audit, log redaction, privacy tests |
| Path traversal in ChangeSet | Writes outside repository model | Canonical path resolution, allowlist, symlink check, expected digest |
| Stale context apply | Model writes based on old HEAD | HEAD/worktree/model digest preconditions |
| Unjustified compatibility | Permanent fallback debt | CompatibilityContract requirement and review finding |
| CodeGraph adapter drift | Incorrect architecture evidence | Exact version, capability check, golden fixtures |
| MCP prompt injection | Tool misuse or oversized content | Five workflow tools by default, resource indirection, budgets, write confirmation |
| ChatGPT tunnel overexposure | Private details sent to OpenAI unintentionally | Explicit opt-in, scope, data classification, apply disabled by default |
| Local DB corruption | Runtime cannot recover | Rebuild from Git model and CodeGraph; snapshots |
| Cross-repo content leaves device | Breaks multi-repo trust boundary | Landscape context is local; SaaS only receives numeric repository IDs |
| Annual entitlement mis-scoped | Accidental team billing path | Entitlement schema has billing interval and per-person scope, no seat pool or org billing fields |
| Direct ledger database edit | Bypasses stale HEAD/worktree, ChangeSet, idempotency, and audit controls | Daemon-owned single writer, agent contract prohibition, schema fixtures, future DB integrity checks |
| SQL ledger becomes unrecoverable sole truth too early | User cannot recover architecture state from Git review artifacts | Hybrid mode sequence, YAML rollback path, projection digests, rebuild requirement before promotion |
| Evidence binding forgery or free-text practice matching | Unsupported advice is promoted to checkpoint/complete authority | `EvidenceItem/v2` plus `EvidenceBinding/v1`, binding reason allowlist, no free-text binding authority |
| Subagent direct write | Non-deterministic output mutates architecture authority | Agent job/report contracts require `directMutationAllowed: false`; proposals must pass deterministic validation and ChangeSet |
| Repository prompt injection or model-output tool escape | Repository text or LLM output is interpreted as a command, tool call, file write, ledger write, or ChangeSet apply | Bounded context carries refs and digests, report validation rejects raw prompt/completion/source/diff payloads plus tool-call/command/write fields, proposal plans are advisory-only, and ChangeSet planning rejects agent/proposal provenance before promotion |

## Security Invariants

1. Cloud routes never accept source, diff, symbol, CodeGraph payloads, architecture model bodies, or detailed findings.
2. Repository writes are ChangeSet-only.
3. Every write binds repository, HEAD SHA, worktree digest, and expected file digest.
4. Multi-repo collaboration and conflict handling remain Git/worktree responsibilities.
5. Ledger-affecting writes are ChangeSet or daemon-owned event append only.
6. Raw source bodies, raw diffs, prompt/completion bodies, full CodeGraph output, secrets, credentials, and private keys are not ledger payloads.
7. Subagent output is proposal evidence, not architecture authority.
8. Repository text and model output are untrusted input; they may produce only validated typed proposal records until deterministic validation and ChangeSet review approve a mutation path.
