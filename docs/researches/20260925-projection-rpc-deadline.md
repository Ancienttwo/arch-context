# Projection/RPC verification blockers

This is the approved diagnosis of the two failures in
`docs/verification/20260925-egress-local-checkpoint.json`. Before reproduction, every
recorded egress source fingerprint matched the working tree. Existing failed logs
remain historical; a later pass does not rewrite them.

## P1: boundary map

`packages/surfaces/cli/test/cli.test.ts` owns the scenario and its outer Bun deadline.
`runAdoptedHookAdaptersScenario` drives real CodeGraph initialization and repeated
adoption, snapshot, semantic-change and refresh-signal proofs. `runTestCli` invokes
local daemon services; the parity scenario then uses real loopback RPC and MCP.
The projection service builds snapshots via the CodeGraph adapter; subprocess
version/status/sync limits remain 5/10/120 seconds. Projection RPC has the existing
900-second long-operation deadline. One-time approval is consumed before execution.

## P2: captured trace

The original churn failure returned `unresolvedProtocol.ok === false` during fixture
preparation at test line 4448, before runtime churn injection. Its error envelope was
not printed. The diagnostic reproduction passed in 116.486 seconds under the same
120-second limit. That is not proof of the earlier failure's cause. The assertion
now includes its returned envelope so a future failure retains the actual error.

The parity failure reproduced at 120.012 seconds. Of its 102 captured CodeGraph
calls, the final `--version` was killed with SIGTERM after only 738 ms against its
own 5000 ms deadline. Bun reported that it killed a dangling process. Thus the outer
test deadline, not that child deadline, interrupted execution.

An observational run with only the outer allowance extended completed in 129.938
seconds: 61 original assertions passed, including the single successful concurrent
approval, replay denial and recovery. All 111 CodeGraph calls succeeded; cumulative
child time was 123.816 seconds and maximum individual child duration was 1.666
seconds. The required sequential child work alone exceeded the old overall budget.
Diagnostic preload records method/timing/exit status only and is not product code.

## P3: correction and limits

Only the parity test's macOS/Linux allowance changes from 120 to 240 seconds, matching
its existing Windows allowance. Its complete fixture, proof and approval assertions
remain intact. The churn test keeps its existing budget; its original false envelope
is unconfirmed and is not labelled an egress regression or a known flake. Product
RPC, child deadlines, consent, single-use approval, writer and receipt behavior do
not change. Both failure assertions now print their result instead of hiding it.
At 10x scenarios repeated CodeGraph process startup dominates verification cost;
this change does not cache authority or make a runtime performance promise.

## Verification

Pre-fix reproduction and timing logs are retained under
`_ops/remaining-issues/projection-rpc/round1*`; observational evidence under `round2*`.
The final check uses the package-declared Bun runner without the diagnostic preload
and selects only the two named cases. Final result and source/log hashes are recorded
in `docs/verification/20260925-projection-rpc-diagnosis.json` after completion.
This bounded result is separate from full current-candidate CI and from the earlier
macOS kernel-isolated egress proof.

Final uninstrumented check: 2 pass / 0 fail / 95 assertions in 239.57 seconds; churn 109.124s, parity 130.021s. Typecheck passes. Frozen candidate `5117abd` then passed all ten Verify jobs in run `36138457129`; both named cases passed in every job. Full hosted source/job/artifact evidence is `docs/verification/20260925-egress-hosted-ci.json`. These passes do not establish the missing historical churn envelope's root cause.
