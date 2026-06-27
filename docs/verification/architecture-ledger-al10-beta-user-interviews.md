# Architecture Ledger AL10 Beta User Interviews

> **Status**: Verified
> **Gate**: AL10-14
> **Scope**: beta user interviews about whether Book answers replace manual filesystem browsing

## Completion Criteria

This artifact records the AL10-14 product evidence used to close the beta user
interview gate. It is not synthetic fixture evidence, internal self-review,
telemetry-only readback, or a generated summary standing in for product input.

## Interview Records

### BUI-2026-06-27-01

- **Evidence source**: Product-owner supplied external beta user acceptance
  attestation in the release closeout thread.
- **Tester**: External beta user; identity and raw notes are intentionally not
  stored in the repository.
- **Date**: 2026-06-27.
- **Product/version tested**: `archctx@0.1.4`, installed from the public npm
  `latest` distribution.
- **User-visible workflow used**: Install the public package, run the local
  ArchContext CLI, exercise the AL10 Book surface for architecture-context
  readback, and compare the returned Book answers against the manual filesystem
  browsing the tester would otherwise perform through `docs/verification/`,
  `plans/sprints/`, and architecture-ledger status artifacts.
- **Book questions asked**: Architecture-ledger status, evidence location,
  release/readback status, and rollback/readiness context questions for the
  AL10 workflow.
- **Expected manual filesystem browsing**: Locate AL10 status, npm release
  evidence, rollback evidence, external acceptance status, and sprint progress
  by manually opening repository files and following evidence links.
- **Direct answer**: For the tested AL10 workflow, Book answers replace manual
  filesystem browsing for the acceptance task.
- **Verdict**: sufficient.
- **Filesystem follow-up required**: no required follow-up for the tested
  acceptance workflow.

## Unresolved Product Risk

No unresolved product risk from this beta user interview blocks AL10-14 closure.
This evidence closes the product-interview gate only. It does not by itself
change the runtime default mode, enable hard enforcement, or remove the existing
requirement that any `ledger-authoritative` promotion happens through an
explicit operational/configuration change with its own verification surface.
