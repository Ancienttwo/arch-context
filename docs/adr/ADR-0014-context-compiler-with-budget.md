---
schemaVersion: archcontext.adr/v1
id: adr.0014.context-compiler-with-budget
title: Context Compiler with Budget
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.context-compiler
supersedes: []
---

# Context

Agent context windows are finite and raw model dumps encourage brittle prompting.

# Decision

Compile task-scoped context with explicit byte and item budgets. Large objects are exposed through resource references.

# Consequences

- MCP responses avoid unbounded source or model bodies.
- Context must be reproducible from snapshot inputs.
