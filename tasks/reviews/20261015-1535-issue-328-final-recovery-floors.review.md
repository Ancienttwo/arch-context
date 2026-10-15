# Review: #328 final recovery metadata and engine floors

> **Status**: Passed locally; delivery gated on accepted C1 main
> **Plan**: plans/plan-20261015-1535-issue-328-final-recovery-floors.md
> **Base**: 1fd88cf61e2f5ba49914680fd43ba479266720b2

## Scope and budget

Deep review of the frozen eight source paths, seven regression paths, manifest schema and two product documents. Two read-only reviewers: final_recovery_security (recovery/own-data/trust boundary, assumption and abuse angles) and final_floors_architecture (interfaces/dependencies/floors/write ordering, composition and cascade angles). Main writer independently verified findings against callers and sinks. One semantic cycle, two bounded repair loops; no additional reviewer fleet or broad lifecycle work.

## Findings and closure

1. P2, both lanes: strict raw-path equality at the candidate/actual manifest guards missed dot/slash aliases. Main writer reproduced two failing whole-file cases before repair. Both gates now share normalized destination identity, conservatively reserving the name on case-insensitive filesystems. Regressions cover canonical, dot, repeated slash, case aliases and implicit output. Four complete ChangeSet files pass 60 cases/302 assertions after this repair. The architecture lane read back and closed the fix.
2. P2, architecture lane: manifest-first input could put the manifest in rollback backups before a later asynchronous journal append raised its floor; the new refusal would restore the older floor. Main writer reproduced two new failing whole-file cases before repair. A local queue now defers the single manifest write until every supplied/ordinary/implicit non-manifest file operation finishes. All writes still use the existing file writer, journal, counting, guards and rollback implementation; no recovery resolver or lifecycle rewrite. Regressions preserve the complete concurrently raised manifest across four layouts and retain actual journal sequence/fault counting. Four complete ChangeSet files pass 62 cases/336 assertions. The same architecture reviewer read the repaired source/tests and closed the original finding, with no direct contract regression found.

## Other covered boundaries

The security lane found no additional recovery finding after checking complete ordinary metadata/catalog attributes, default C1 8 KiB isolation, dedicated 256 KiB exact UTF-8 thresholds, full IDs and request omission flag, own-data/accessor behavior, direct writer ordering, all legacy automatic replay/restore branches and the existing maintenance client flow. The architecture lane found no additional dependency or manifest contract break after reading no-floor serialization, floor retention including isolated output, v1/v2 rebaseline behavior, future refusal and the real maintenance client readback proof. Production dependencies remain contracts -> projection/schema, with no contracts -> core/runtime import.

## Verification ledger

The pre-repair candidate passed 645 cases/4568 assertions across 34 complete files. Repair 1 passed 646 cases/4584 assertions across the same 34 files. Each also passed typecheck, five-workspace boundary audit, production reachability audit and packaged native/CLI smoke, with recorded source/test/schema hashes unchanged during that verification. These are affected checks, not a complete root-suite claim.

Final repair 2 passes 648 cases/4618 assertions across 34 complete files in 173.18s, with no test-name filtering or new skips. Type/boundary passes in0.77s, production audit in0.30s, packaged native/CLI in17.49s. Recorded source/test/config/schema and product-document hashes are unchanged during verification. No complete root suite was rerun or claimed green. Both P2 findings are fixed and independently closed; no outstanding finding within this package. Main alignment and the final PR remain gated on accepted C1 main integration; the coordinator subsequently permits verified branch-only commit/push for review. #359 and its CI are owned by the parent and unchanged by this package.

## RFC closure limit

The coordinator requested a final all-D6 check before source publication. The current finite package passes its own scope; it does not close every public failure boundary in RFC328. Four direct synthetic witnesses demonstrate the remaining generic apply/projection/recovery exits, and the original C1 inventory retains ten partial C2 boundaries plus six lifecycle symbols. No global all-public-boundaries sign-off was performed or claimed. The exact accepted count is648 across34 affected files; it cannot establish untested public-boundary compliance. Source publication is branch-only for review; no PR, merge, release or issue closure is implied.
