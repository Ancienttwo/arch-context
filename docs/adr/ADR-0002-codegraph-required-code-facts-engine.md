---
schemaVersion: archcontext.adr/v1
id: adr.0002.codegraph-required-code-facts-engine
title: CodeGraph as Required Code Facts Engine
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.codegraph-adapter
supersedes: []
---

# Context

ArchContext needs call graph, impact, symbol, and code context facts but should not become a generic code graph parser.

# Decision

CodeGraph is a product-level hard dependency. Runtime code reaches it only through `CodeFactsPort`.

# Consequences

- No direct reads of CodeGraph internal SQLite or file layout.
- Compatibility is guarded by adapter contract tests and version checks.
