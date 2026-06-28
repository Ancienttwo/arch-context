# ArchContext Contracts npm Scope Readback

> Date: 2026-06-28
> Package: `@archcontext/contracts@0.1.4`
> Source commit: `b34d6a6d89fcf3e55da070a0e6738c07851c1369`
> Status: blocked on npm `@archcontext` scope authorization

## Summary

`@archcontext/contracts` is package-ready in the repository, but it is not
published to the public npm registry. The current npm identity can authenticate
as `ancienttwo`, yet cannot administer or publish under the `@archcontext`
scope.

The correct decision is to keep ModelContext on its staged
`@modelcontext/contracts` path until `@archcontext/contracts` is registry
published and read back as installable.

## Code Readiness

- `packages/contracts/package.json` declares `private: false`.
- `publishConfig.access` is `public`.
- Package contents are restricted to `src`, `fixtures`, and `package.json`.
- `packages/contracts/test/publishability.test.ts` verifies the manifest and
  `npm pack --dry-run` contents.

Clean `origin/main` readback at `b34d6a6d89fcf3e55da070a0e6738c07851c1369`:

```text
repo-harness run check-task-sync
[task-sync] No changes detected.

repo-harness run check-task-workflow --strict
[workflow] OK

node scripts/package-boundary-audit.mjs
Package boundary audit passed (5 workspaces).

bun test packages/contracts/test/contracts.test.ts packages/contracts/test/publishability.test.ts scripts/sprint-status-check.test.ts --timeout 90000
167 pass
0 fail
```

## Registry Readback

All npm commands below used a temporary npm userconfig and cache. No global
`~/.npmrc` or global npm cache was modified.

Authenticated identity:

```text
npm whoami --registry=https://registry.npmjs.org/
ancienttwo
exit=0
```

Scope package access:

```text
npm access list packages @archcontext --json --registry=https://registry.npmjs.org/
E403 Forbidden - GET https://registry.npmjs.org/-/org/archcontext/package
exit=1
```

Scope org membership readback:

```text
npm org ls archcontext --json --registry=https://registry.npmjs.org/
E403 Forbidden - GET https://registry.npmjs.org/-/org/archcontext/user
exit=1
```

Scope team readback:

```text
npm team ls archcontext --json --registry=https://registry.npmjs.org/
E403 Forbidden - GET https://registry.npmjs.org/-/org/archcontext/team?format=cli
exit=1
```

Package registry readback:

```text
npm view @archcontext/contracts version dist-tags versions --json --registry=https://registry.npmjs.org/
E404 Not Found - GET https://registry.npmjs.org/@archcontext%2fcontracts
exit=1
```

Publish retry:

```text
npm publish ./packages/contracts --access public --ignore-scripts --json --registry=https://registry.npmjs.org/
E404 Not Found - PUT https://registry.npmjs.org/@archcontext%2fcontracts
The requested resource '@archcontext/contracts@0.1.4' could not be found or you do not have permission to access it.
exit=1
```

## Decision

This is not a package-content, test, tarball, or local build problem. It is an
npm scope authorization blocker.

Do not:

- rename the package to a different scope as a workaround;
- publish an unscoped compatibility package;
- switch ModelContext to `@archcontext/contracts` before registry readback;
- enable `MODELCONTEXT_REQUIRE_ARCHCONTEXT_CONTRACTS=1` in CI before the package
  is installable from npm.

Do:

- grant the `ancienttwo` npm account publish/admin rights for the `@archcontext`
  scope, or create/claim that npm organization under the correct owner account;
- rerun the publish command with a temporary npm userconfig;
- read back the package from npm;
- run a clean-room install/import smoke;
- then enable the ModelContext public-contract dependency path.

## Retry Commands After Scope Access Is Fixed

```bash
npm publish ./packages/contracts \
  --access public \
  --ignore-scripts \
  --registry=https://registry.npmjs.org/

npm view @archcontext/contracts@0.1.4 \
  name version dist.tarball dist.shasum dist.integrity \
  --json \
  --registry=https://registry.npmjs.org/

WORK="$(mktemp -d /tmp/archctx-contracts-consume.XXXXXX)"
cd "$WORK"
printf '{"type":"module"}\n' > package.json
bun add @archcontext/contracts@0.1.4
cat > smoke.ts <<'TS'
import { digestJson, productVersionManifest } from "@archcontext/contracts";
if (!digestJson({ ok: true }).startsWith("sha256:")) throw new Error("bad digest");
if (productVersionManifest().product.version !== "0.1.4") throw new Error("bad version");
console.log("ok");
TS
bun smoke.ts
```

After the clean-room smoke passes, ModelContext can add the dependency and run:

```bash
MODELCONTEXT_REQUIRE_ARCHCONTEXT_CONTRACTS=1 \
ARCHCONTEXT_REPO=/Users/ancienttwo/Projects/arch-context \
bun test tests/archcontext-contract-readiness.test.ts --timeout 30000
```
