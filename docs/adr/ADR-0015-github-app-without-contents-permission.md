---
schemaVersion: archcontext.adr/v1
id: adr.0015.github-app-without-contents-permission
title: GitHub Governance API Allowlist without Contents Permission
status: accepted
decidedAt: 2026-06-19
appliesTo:
  - package.github-app
  - package.control-plane
supersedes: []
---

# Context

The GitHub App coordinates governance proof without executing review. The earlier shorthand "without Contents permission" is necessary but insufficient: Pull Requests read permission and future SDK changes can still expose metadata shapes that are broader than the product needs.

# Decision

Default GitHub App permissions are Metadata read, Pull Requests read, Checks write, and Commit Statuses write. Commit Statuses write is included only because the FG2 staging ruleset expected-source readback proved GitHub requires `statuses:write` before the App can be selected as the expected source for a required status check. Business logic must use a typed `GitHubGovernancePort`, not a generic Octokit client or installation token. The allowed runtime operations are repository metadata, pull head metadata, check create, and check update.

Static and runtime guards must deny PR Files, Contents, Blob, Tree, Diff, and Patch API access, including Diff/Patch media types. The privacy claim is "ArchContext Cloud does not request, process, or store code content," not "GitHub permissions make code access technically impossible."

# Consequences

- Review runs locally.
- SaaS cannot become a code proxy through normal typed ports.
- Commit Statuses write is a GitHub ruleset configuration requirement, not a runtime status-publishing path.
- SDK drift, accidental endpoint expansion, and media type changes become contract-test failures.
- Any future permission expansion requires staging evidence, ADR update, and install-page disclosure.
