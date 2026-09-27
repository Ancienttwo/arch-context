# Shared hook helpers — issue #164

## P1 — ownership

The daemon, regular CLI and fast-hook entrypoint each classify `.archcontext/generated/` paths with the same predicate. A dependency-free local-runtime module now owns that predicate. Fast-hook logging also duplicated JSON hashing already owned by contracts; it now imports the existing contracts function and type.

## P2 — behavior

The path guard still normalizes backslashes and matches the exact generated-directory prefix. Hook flag precedence and the requirement for a nonempty, entirely generated path list are unchanged. Hook log digests still hash `{ paths: [...new Set(paths)].sort() }` and disclose no path text. The removed private sorter used locale key order, whereas contracts uses code-unit key order; the only caller supplies one fixed key (`paths`) and a string array, so this replacement preserves every accepted input's digest. It is not a change to general JSON canonicalization.

## P3 — scope

This removes repeated policy from three real consumers without loading the daemon or store in the fast-hook dependency graph. The contracts module has no native/database dependencies. RPC, filesystem writes, path eligibility, CLI defaults and wire schemas remain unchanged. At 10x paths the existing array sorting and hashing cost still dominates; no throughput improvement is claimed.

`readCurrentBranch` and `readHeadCommittedAt` already have one implementation in `projection-inputs.ts` after projection orchestration moved. Process liveness and runtime state paths were consolidated by earlier slices. JSON file writers stay separate because their fsync and exclusive-create behavior differs.

## Verification

Fast and regular CLI entrypoints are compared over generated, mixed, empty, prefix-adjacent, Windows, Unicode, duplicate-path and explicit override cases. Fixed wire hashing is checked independently. These tests plus existing real connection/state-path coverage pass: 2 tests, 53 assertions. Typecheck and package boundaries pass. The component and daemon/CLI relations were created through ChangeSet; model validation has no errors. Full verification and hosted CI are tracked in the PR.
