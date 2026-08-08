# Implementation Notes: axr8-release-authority-cutover

> **Status**: Active
> **Plan**: plans/plan-20260809-0555-axr8-release-authority-cutover.md
> **Contract**: tasks/contracts/20260809-0555-axr8-release-authority-cutover.contract.md
> **Review**: tasks/reviews/20260809-0555-axr8-release-authority-cutover.review.md
> **Last Updated**: 2026-08-09 05:55
> **Lifecycle**: notes

## Design Decisions

- Treat `ARCHCONTEXT_PRODUCT_VERSION`, all workspace manifests, the bundled
  practice catalog, GitHub Action defaults, and current runner examples as one
  `0.4.0` release authority.
- Align the product manifest's CodeGraph requirement with the package-local
  provider handshake and production dependency at exact `1.5.0`.
- Keep Mermaid as an exact dev-only validator (`11.16.0`); the production
  tarball contains no Mermaid, Chromium, browser runtime, or generated HTML.
- Publish contracts before the CLI and require registry plus clean-room readback
  before changing repo-harness dependencies.

## Deviations From Plan Or Spec

- The AXR7 local artifact hashes were not reused because release preflight found
  that the bundled product manifest still advertised CodeGraph `1.4.0` while
  the actual adapter and package dependency require `1.5.0`. Shipping the old
  hash would make `doctor` lie about the runtime contract.
- The tarball smoke's isolated PATH used `dirname(process.execPath)`, which on
  Homebrew also exposed a global `codegraph`. The smoke now creates a temporary
  Node-only wrapper directory, proving the package-local dependency is used.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| Preserve AXR7 hash despite stale CodeGraph manifest | Rejected | Hash identity cannot outrank a false runtime contract. |
| Vendor Mermaid/Chromium in `archctx` | Rejected | Diagram validation is authoring-time only and would enlarge the runtime. |
| Resolve PATH CodeGraph during smoke | Rejected | It would not prove the published dependency is sufficient. |

## Open Questions

- None.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`
- Full producer gate: `bun run verify` — 1218 pass, 0 fail; all downstream audits and evals PASS.
- `archctx@0.4.0` dry-run integrity: `sha512-LFl8PqYv6Yu/VUbQHKJR00v2VZerRiyEvTlPXZVYEVjh1DzD37QmvlCq6zTUgZE3+wVLJJRpKe69u1vj2P4N7w==`.
- `archctx-contracts@0.4.0` preflight integrity: `sha512-yV7mOuKqEDgW5NVVCpaBSqKehC1VasBbxHNVGWa3EaQ3JjOVzX+gwqJ4e+l1T8Li60qp3Mb1bDOU2N4MMZnpiQ==`.
- Clean-room product proof: `docs/verification/fg6-local-product-tarball-smoke.json`.

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
