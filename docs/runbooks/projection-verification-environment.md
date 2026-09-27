# Local projection verification environment

Use the repository-pinned Bun 1.4.0. On the diagnosed macOS machine, starting Bun from system temporary fixture directories incurred substantial directory-enumeration work before user code; even `bun -e` exceeded five seconds once. Repeated starts also exhausted a projection integration test's outer budget. This was reproduced without CodeGraph.

For local projection verification, give this invocation an isolated temporary base in the worktree's ignored operations directory:

```sh
task_tmp_dir="$PWD/_ops/verification-tmp"
mkdir -p "$task_tmp_dir"
TMPDIR="$task_tmp_dir" bun test --timeout 60000 \
  packages/local-runtime/runtime-daemon/test/local-runtime.test.ts \
  packages/surfaces/cli/test/cli.test.ts \
  -t 'complete_task blocks active documentation projection drift until projections are reconciled|projection readback preserves delivered receipt and validates every current read over RPC'
```

The fixture code still creates independent repositories and runs the real package-local CLI/RPC paths. Only this command inherits `TMPDIR`; no global temp setting is changed. Do not clean the system temp directory or other tasks' fixtures. The path must be writable and owned by this worktree/task. The verification contract fingerprints `TMPDIR` when consuming these results.

Keep all child and outer deadlines unchanged. A real child timeout still fails closed. Do not replace the public CLI with a version string, mock indexed proof, cache current-read authority, or treat a later pass as rewriting an earlier failure.

The unchanged two tests passed locally in 29.84 seconds with 79 assertions; the existing bounded child-timeout negative guard also passed. Exact source/log identities and contrasting observations: `docs/verification/20260925-projection-environment-diagnosis.json`. This is a local verification-environment remedy, not a universal Bun fix or a Windows result. The exact internal Bun function/directory set behind the sampled enumeration is unresolved.

Whole-plan acceptance still requires #225's capability contract repair and a normal frozen acceptance run. If that run uses this isolated environment, declare the same `TMPDIR` input. This runbook does not bypass automatic architecture projection or issue an AcceptanceReceipt.
