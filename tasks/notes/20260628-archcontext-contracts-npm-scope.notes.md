# ArchContext Contracts npm Scope Note

`@archcontext/contracts@0.1.4` is package-ready on `origin/main`, but public npm
publish is blocked by `@archcontext` scope authorization. The current
authenticated npm identity is `ancienttwo`; scope package, org, and team
readbacks return `E403`, while `npm view @archcontext/contracts` returns `E404`.

Durable readback:
`docs/verification/archcontext-contracts-npm-scope-readback.md`.

Do not switch ModelContext to `@archcontext/contracts` or enable
`MODELCONTEXT_REQUIRE_ARCHCONTEXT_CONTRACTS=1` until the package is published and
clean-room install/import readback passes.
