---
schemaVersion: archcontext.adr/v1
id: adr.0002.codegraph-required-code-facts-engine
title: CodeGraph as Required Code Facts Engine
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - module.architecture-context.local-runtime
supersedes: []
---

# Context

ArchContext needs call graph, impact, symbol, and code context facts but should not become a generic code graph parser.

# Decision

CodeGraph is a product-level hard dependency. Runtime code reaches it only through `CodeFactsPort`.

# Consequences

- No direct reads of CodeGraph internal SQLite or file layout. One exception, [ADR-0058](ADR-0058-codegraph-reads-in-process-read-only.md) Decision 10 ([#608](https://github.com/Ancienttwo/arch-context/issues/608)): the base-index refresh opens `codegraph.db` as an opaque SQLite file on a read-only handle, only for `VACUUM INTO`. It reads no table and writes no row.
- Compatibility is guarded by adapter contract tests and version checks.
