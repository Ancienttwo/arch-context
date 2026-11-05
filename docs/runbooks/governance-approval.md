# Governance Approval Evidence

## Purpose

Human Gate approval is a governance artifact, not a test result. Agent-authored implementation evidence can prove repository behavior, but it cannot approve ADR governance decisions by itself.

## Approval Contract

A human approver records an approval in an issue decision comment. Acceptance goes to PR review threads. A durable decision goes to an ADR that links the issue decision. There is no approval file, and no script reads an approval.

CD-EG3 is closed without approval. The decision and its reason are on [issue #487](https://github.com/Ancienttwo/arch-context/issues/487).
