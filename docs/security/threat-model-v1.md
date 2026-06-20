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
| GitHub App permission manifest and governance API allowlist | Contracts package and GitHub App package |
| GitHub webhook delivery projections and egress recorder envelopes | SaaS D1/logs, metadata only |
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
| GitHub App permission expansion | App can access data beyond the published privacy promise | Contracts-owned permission manifest, install-page disclosure, staging evidence requirement, ADR update before expansion |
| GitHub SDK/API drift | Typed calls start reaching files, contents, blob, tree, diff, or patch data | `GitHubGovernancePort`, method/path allowlist, forbidden endpoint denylist, diff/patch media denylist, static contract audit, egress readback guard |
| GitHub webhook replay or forgery | Duplicate or forged event creates stale challenge/check side effects | Raw-byte HMAC-SHA256 verification before projection, provider/delivery ID ledger, event/action allowlist, idempotent replay response |
| GitHub governance logs leak raw payload or code-adjacent data | Source, diff, filenames, symbols, model bodies, or findings leave the local boundary | Immediate minimal projection, raw webhook body retention of 0 days, structured log/trace/queue/error allowlists, bait fixture privacy tests |

## FG2 GitHub Governance Trace

Input source of truth is the GitHub webhook raw body plus `X-Hub-Signature-256`, `X-GitHub-Delivery`, event name, selected-repository installation state, and the contracts-owned permission manifest.

1. The GitHub App adapter verifies the raw body with HMAC-SHA256 before JSON projection. Invalid signatures stop before domain handling.
2. `projectVerifiedGitHubWebhook` accepts only supported pull request, check run, installation, and repository-selection events, then projects the payload to delivery/action/repository/head metadata.
3. `GitHubAppState` records the provider/delivery ID, treats repeats as idempotent replays, rejects unselected repositories, and creates challenge/check side effects only from the projected DTO.
4. Outbound GitHub calls must cross the typed governance port. Method, path, endpoint category, and `Accept` media type are checked before transport; the recorder stores only category, status, latency, and request ID.
5. The first failure pressure points are hidden permission expansion, SDK endpoint/media drift, raw payload leakage through logs/queues/errors, and webhook replay. FG2-02 still gates any future Commit Statuses permission, and FG2-17 still gates live staging egress recording.

## Security Invariants

1. Cloud routes never accept source, diff, symbol, CodeGraph payloads, architecture model bodies, or detailed findings.
2. Repository writes are ChangeSet-only.
3. Every write binds repository, HEAD SHA, worktree digest, and expected file digest.
4. Attestation payloads contain only minimal proof metadata.
5. Device private keys never enter repository files, SQLite, D1, logs, or tool output.
6. Organization runner keys stay in the customer's runner environment.
7. Organization-attested means customer-controlled provenance, not a guarantee of an untampered environment.
8. Multi-repo collaboration and conflict handling remain Git/worktree responsibilities.
9. GitHub App permission changes require manifest, ADR, install-page, and evidence updates before release.
10. GitHub governance code cannot use a generic GitHub client or forbidden endpoint/media type.
11. Duplicate GitHub delivery IDs cannot create new challenge or check side effects.
