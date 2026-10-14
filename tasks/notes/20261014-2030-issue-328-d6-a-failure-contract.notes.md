# D6-A implementation notes

Baseline: d6788c4b565aa043530b2f6407234b3ed108fa00 (merged D5). One isolated
worktree/implementation writer. W1/W2/W6 and the closed reason/details ledger are in the plan.
No manifest, lock, workflow, state, model, D5, U4, scanner, upgrade or global RPC wire edit.

## Implementation

Contracts export strict selected FailureCode/FailureEnvelope, typed FailureError, pure normalization
and validation. Legacy AC-only JsonEnvelope and successful raw reader APIs retain their shapes.
Producers classify actual typed errors once; surfaces preserve registered reason/action/severity/
retryability. Unknown errors use fixed safe W1 text and stage, without inspecting message/stack.
Transport timeout/abort from selected operations retains its code, deadline facts and unknown
mutation outcome; automatic replay is prohibited.

Private frozen policy/default snapshots prevent shared mutation. Array facts use own data
descriptors only. Unknown compound facts are refused without traversal, including malformed
omittedCount, because a nested recovery binding cannot be silently discarded. Ordinary scalar
summary facts may be counted as omitted. Critical keys are refused rather than truncated.

## Evidence and limitations

- Genuine baseline regression: immutable d678 source archive ran five selected surface cases,
  zero passed/five failed. Dependency setup failures were excluded from this evidence.
- Intermediate affected suite: typecheck, package boundary audit and ten files passed,
  389 tests/2329 assertions. This preceded final independent review repairs.
- Final affected suite after health repairs: typecheck, package boundaries and ten files passed,
  398 tests/2434 assertions. Metadata-only post-review probes also passed (22 tests).
- Final packaged native Node bundle and packaged CLI smoke passed after health repairs,
  exercising temporary Git/state/daemon fixtures. No release was published.
- Canonical contract execution records exact complete virtual tree, environment and toolchain
  in ignored harness evidence. Only the resulting report can establish final exact passes;
  timeouts/failures must be reported, not replaced with intermediate evidence.
- Coordinator approved selected health timeout passthrough, including the actual stdio resolver.
  Existing live-PID refusal returns its typed error only for selected callers. Default consumers,
  PID/version/control-file/recovery/start predicates and call counts remain unchanged.
- Actual CLI complete/review/practices checkpoint plus unselected status, and official SDK actual
  stdio tools: two failing pre-fix regressions became two passes/50 assertions. Seeded SQLite
  baseline and connection/lock bytes are preserved; only existing health GETs occur, no mutation.
- #351 old-line hunk intersection is zero; upgradeDaemon body is identical to baseline.
  Discovery abort and post-start health remain excluded; no claim covers all transport failures.
- Initial canonical execution recorded focused/package passes, but ordinary helper supervision
  terminated the invocation at 120 seconds during governance. This is an execution budget in
  the installed runner, not a completed governance result. The raw failure is preserved privately.
  A separately bounded canonical invocation requires coordinator resolution; no budget/config edit.

Tests use temporary state and local loopback fixtures. Sandbox listener restrictions required
local execution outside the filesystem sandbox; no real service credentials or user state used.
Hosted new-HEAD matrix and coordinator independent acceptance remain separate requirements.
No self-merge, release, or closure of #328.

## Committed-subject canonical result and test follow-up

The coordinator approved one direct packaged-helper invocation capped at 600000ms. At exact
7fc6a9d9122edcc96c7cea806f4215cf006b62fe the canonical report recorded two exact passes
(focused 67397ms; packaged 15346ms), then governance timed out/SIGTERM after 517773ms.
Overall report: failed, exact_passed=2, unmet=d6-a-governance; snapshot_changed=false.
Before interruption diagnostics contain 3033 pass lines, zero fail lines and three skip lines;
execution stopped during projection lifecycle tests before full-suite/remaining governance
completion. These partial counts are not a suite pass. The earlier 120-second interruption
is retained too. No test/CI/safety budget was edited.

Independent narrow tests exposed two legacy CLI cases with five raw-message echo assertions.
A test-only follow-up replaces them with strict registered refusal metadata, exact empty details
and no flag echo; product files remain byte-identical to 7fc6a9d9. This correction and its
canonical compatibility check remain within the selected CLI failure contract.
Hosted current-HEAD full validation is still required; no complete local governance pass claimed.

Follow-up verification: both existing CLI cases passed (2 tests/113 assertions), typecheck
passed and the extended canonical contract validated. No production source differs from 7fc6a9d9.
