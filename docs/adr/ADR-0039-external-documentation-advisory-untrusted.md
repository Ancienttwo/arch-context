---
schemaVersion: archcontext.adr/v1
id: adr.0039.external-documentation-advisory-untrusted
title: External Documentation Is Advisory and Untrusted
status: accepted
decidedAt: 2026-06-24
appliesTo:
  - package.contracts
  - package.runtime-daemon
  - package.local-runtime
  - package.surfaces-cli
supersedes: []
---

# Context

The Versioned Practice Catalog is intentionally local and deterministic.
External documentation can improve recall for version-specific framework
unknowns, but it is mutable community content fetched over the network.

The runtime already separates local model facts, deterministic practice checks,
and advisory inputs. A Context7 integration must preserve that separation:
network documentation cannot become a policy source, cannot inspect repository
source, and cannot give an agent a general HTTP escape hatch.

# Decision

ArchContext represents fetched external docs as
`ExternalDocumentationResourceV1` with `trust: external-unverified` and
`enforcement: advisory-only`.

The Context7 integration is implemented behind `ExternalDocumentationPort`.
Core packages depend only on that port and the typed resource contract. The
Context7 adapter stays in local runtime code.

Default runtime configuration keeps the provider disabled. Manual CLI commands
can resolve, pin, fetch, inspect status, and purge Context7 resources. Fetching
requires an exact pinned library ID/version from
`.archcontext/integrations/context7.lock.yaml` and explicit `--allow-network`.

Outbound requests are minimized to library name or exact library ID, pinned
version, bounded intent/query, max result count, timeout, and optional API key
from environment. Absolute paths, repository names, code blocks, diffs, symbol
lists, and secret-like values are rejected before transport.

Fetched content is size-limited, cleaned, URI-validated, cached locally by
provider/library/version/query digest, and exposed as a local
`archcontext://external-docs/context7/<digest>` resource. It can appear only as
resource/unknown context, never as enforceable constraints or hard-gate
evidence.

# Consequences

- Default install and default prepare have zero Context7 egress.
- Context7 content cannot change `complete` conclusions, deterministic practice
  violations, review attestations, or governance checks.
- Exact library/version cache replay is auditable without repeating network
  calls.
- Provider failure, no API key, no network, malformed responses, and disabled
  provider states must leave Local Core results unchanged.
- `ADR-0038` is already assigned to versioned practice assets, so this decision
  uses `ADR-0039` while satisfying the S5 external-documentation ADR intent.
