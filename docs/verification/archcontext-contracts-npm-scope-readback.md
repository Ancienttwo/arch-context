# ArchContext Contracts npm Distribution Readback

> Date: 2026-06-28
> Source package: `@archcontext/contracts@0.1.4`
> npm package: `archctx-contracts@0.1.4`
> Package license: `Apache-2.0`
> Status: ready to publish on the no-org unscoped npm name

## Summary

`@archcontext/contracts` remains the ArchContext workspace source package name,
but public npm distribution now targets `archctx-contracts` to
avoid the paid npm organization requirement for `@archcontext`.

The current npm identity can authenticate as `ancienttwo`. The unscoped package name
preflight passes, while the original `@archcontext` organization scope remains
unusable without creating or claiming a paid org.

The package now declares the npm-visible SPDX license metadata as
`Apache-2.0`; the publishability test and publish helper both gate on that
field so the npm registry cannot silently miss the license on the next publish
attempt.

The correct decision is to keep ModelContext on its staged
`@modelcontext/contracts` path until `archctx-contracts` is
registry-published and read back as installable.

## Code Readiness

- `packages/contracts/package.json` declares `private: false`.
- `packages/contracts/package.json` declares `license: Apache-2.0`.
- `publishConfig.access` is `public`.
- Package contents are restricted to `src`, `fixtures`, and `package.json`.
- `packages/contracts/test/publishability.test.ts` verifies the manifest and
  `npm pack --dry-run` contents.
- `scripts/publish-archcontext-contracts.mjs` is the canonical npm preflight,
  publish, registry readback, and clean-room install/import smoke helper.
- The helper prepares a temporary publish package named
  `archctx-contracts`; it does not rename the internal
  `@archcontext/contracts` workspace package.

Clean `origin/main` readback at `b34d6a6d89fcf3e55da070a0e6738c07851c1369`
before the npm-scope blocker was filed:

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

Current preflight helper behavior on the no-org unscoped package name:

```text
bun run preflight:contracts:npm
[contracts-publish] ready
package: archctx-contracts@0.1.4
source package: @archcontext/contracts
license: Apache-2.0
manifest: ok
pack: ok
scope access: ok (unscoped)
registry readback: not-published
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

Original `@archcontext` scope package access:

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

Original `@archcontext/contracts` package registry readback:

```text
npm view @archcontext/contracts name version license dist.tarball dist.shasum dist.integrity --json --registry=https://registry.npmjs.org/
E404 Not Found - GET https://registry.npmjs.org/@archcontext%2fcontracts
exit=1
```

Original `@archcontext/contracts` publish retry:

```text
npm publish ./packages/contracts --access public --ignore-scripts --json --registry=https://registry.npmjs.org/
E404 Not Found - PUT https://registry.npmjs.org/@archcontext%2fcontracts
The requested resource '@archcontext/contracts@0.1.4' could not be found or you do not have permission to access it.
exit=1
```

No-org unscoped preflight:

```text
node scripts/publish-archcontext-contracts.mjs preflight --json
status=ready
package=archctx-contracts@0.1.4
sourcePackage=@archcontext/contracts
license=Apache-2.0
scopeAccess=unscoped
registryReadback=not-published
```

## Decision

This is not a package-content, test, tarball, or local build problem. It is an
npm organization scope cost/authorization blocker.

Do not:

- rename the internal workspace package away from `@archcontext/contracts`;
- occupy the `archctx` product/CLI package name with the contracts-only package;
- switch ModelContext to the public contracts package before registry readback;
- enable `MODELCONTEXT_REQUIRE_ARCHCONTEXT_CONTRACTS=1` in CI before the package
  is installable from npm.

Do:

- publish the no-org npm distribution as `archctx-contracts`;
- rerun `bun run preflight:contracts:npm`;
- rerun `bun run publish:contracts` with a temporary npm userconfig;
- read back the package from npm;
- run a clean-room install/import smoke;
- then enable the ModelContext public-contract dependency path.

## Publish Commands

```bash
bun run preflight:contracts:npm

bun run publish:contracts

WORK="$(mktemp -d /tmp/archctx-contracts-consume.XXXXXX)"
cd "$WORK"
printf '{"type":"module"}\n' > package.json
bun add archctx-contracts@0.1.4
cat > smoke.ts <<'TS'
import { digestJson, productVersionManifest } from "archctx-contracts";
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
