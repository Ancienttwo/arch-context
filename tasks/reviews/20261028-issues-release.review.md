# 0.9.4 independent acceptance review

Subject: `226b6bda2dbda60d36c3f449979a5ad7cacd58b3..dc93dcf3308cc80e8dede032a7cbc3ea300801cc`.
Reviewer: independent Claude Opus, Herdr `default`, agent `arch-release-review`, pane `wC:p5`.
Scope: all 49 changed files; issues #409, #414, #415, #417, #421. PR #420 was already accepted and merged separately.

The reviewer inspected architecture/API boundaries, filesystem and SQLite snapshot safety, ref evidence binding, daemon readiness and authenticated shutdown, portable receipt claims, version authorities, test assertions and adversarial composition/scale scenarios. It ran no tests and made no edits, consuming the parent's recorded checks.

Verdict: no code blockers; approve after a documentation clarification. The impact reader summarizes snapshot failures as `ref-code-facts-unavailable`, so its runbook must not imply that each unsupported-layout cause is individually exposed. The parent clarified that behavior and identified `flows check --no-sync` as the surface exposing specific snapshot failure reasons. No runtime change was needed.

The reviewer confirmed the configured-source fixture retained its `[1, 1]` assertion and added original-provider preconditions; the directory correction exercises the provider's actual `includeIgnored` contract. Renamed-selector tests exercise the documented complete provider lookup; ambiguity retains unknown coverage. No assertion was removed to turn a failing implementation green.

Receipt model digests are already validated by the committed-journal reader; the parent did not add a second validator. Unsigned receipts remain explicitly unauthenticated. The positive Node/Bun snapshot fixtures cover the reviewer’s static uncertainty about private-root readiness. Tarball/clean-install checks and full release gates remain separate pending evidence.

An automatic stop-hook ownership warning named historical `.github` paths outside this diff. It was not changed or treated as a candidate defect.
