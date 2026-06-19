---
schemaVersion: archcontext.adr/v1
id: adr.0026.multi-repo-architecture-context
title: Multi-repo Architecture Context
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.architecture-domain
  - package.context-compiler
  - package.runtime-daemon
supersedes: []
---

# Context

Teams commonly split one product across multiple repositories. The existing model treats one repository as the architecture source of truth and one CodeGraph index as the code fact source.

# Decision

Keep each repository as its own source of truth. Add a Git-tracked landscape file and local derived cross-repo edges for context, impact and review. ArchContext does not build a collaboration or sync service; Git and worktrees remain the collaboration boundary.

# Consequences

- Cross-repo node IDs use `repo.id::node.id`.
- Cross-repo context activates a bounded subset of repositories by task scope.
- SaaS receives only numeric repository or installation identifiers.
- Removing the local store must be recoverable from repository files plus CodeGraph indexes.
