# Issue 409: Stateless Git ref range impact

Status: Review

## Authorization

The user explicitly requested parallel implementation of issues #402, #407, #408 and #409 on 2026-10-26. This isolated lane implements #409. Baseline: `0e08d30cb9e3daf87730a7126ca9b785d7663f72`.

On 2026-10-27 the user approved resolving #412's current-main conflicts and path-identity bug, GitHub CI and merge of this explicitly partial delivery. Main `5dc25c88` is merged into the candidate; #409 remains open for historical flow evidence.

## Task Breakdown

- [ ] Implement the issue contract with backward-compatible defaults and explicit unknown/error states.
- [x] Add focused regressions and run affected tests and typecheck.
- [x] Preserve legal path whitespace in file/stdin path lists and verify actual CLI ownership without runtime writes.
- [x] Independently review and repair findings; check shared-interface composition.
- [x] Submit a linked Draft PR with exact evidence and remaining gates.

## Boundaries

Run complete verification in GitHub CI after the repair and review. No release, deployment, services, secrets, permission expansion or user-data/model repair. Synthetic fixtures only. Preserve existing worktrees.

## Partial delivery and evidence

Ref/path ownership, head-graph dependents, raw-blob line counts, model delta,
bounded output and explicit unknown coverage are implemented. Actual CLI
historical flow facts remain unavailable; engine injection tests do not complete
that requirement. Use `Refs #409`, never a closing keyword. See
`docs/runbooks/ref-impact.md` for the public boundary.

Final isolated checks: 19 tests, 57 assertions, zero failures; typecheck and
whitespace checks passed. Independent review identified missing-selector base
deletion coverage and worktree-attribute sensitivity; both were fixed and
reverified. An independent LCS comparison covered 16129 cases. The final test log
is `../issue409-object-final-tests.log`; typecheck logs are adjacent. Composition
and Draft PR delivery remain pending. Rollback is a code/schema/docs revert;
this read-only feature has no persisted-data migration.

The 2026-10-27 path repair failed its two new LF/CRLF cases before the fix
(7 pass / 2 fail) and passed all 21 affected tests afterward (85 assertions).
The real CLI covers file and stdin inputs, leading/trailing/whitespace-only paths,
exact ownership and absence of runtime state. No existing assertions were removed
or relaxed. Independent incremental review passed, including the main merge's
preservation of both impact and constraints routing. Full CI runs on GitHub.
