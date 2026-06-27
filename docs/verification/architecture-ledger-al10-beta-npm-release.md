# Architecture Ledger AL10 Beta NPM Release Readback

Status: verified

Scope: advisory local opt-in beta. This release exists so testers can install a public npm artifact before GA external gates close. It does not approve `ledger-authoritative` promotion, hard enforcement, AL10-GA-6, or AL10-GA-7.

## Published Artifact

- Package: `archctx@0.1.4-beta.0`
- Dist-tag: `beta`
- Tester install: `npm install -g archctx@beta`
- Explicit install: `npm install -g archctx@0.1.4-beta.0`
- Tarball: `https://registry.npmjs.org/archctx/-/archctx-0.1.4-beta.0.tgz`
- Shasum: `51bf49a0e5ba1e593753cb079df153682736f11c`
- Integrity: `sha512-Hvlsd+CZiYF0OxDuJfxnLse6vo2eqrD1Y/ey9twNsPUgd7IJZuAzwbR5nliQCQhS2esv4iHRcp7WFBlx/Lz5yw==`

## Registry Readback

- `latest` remains `0.1.3`.
- `beta` points to `0.1.4-beta.0`.
- `archctx@0.1.4-beta.0` is registry-visible with Node engine `>=24 <26`, `archctx` and `codegraph` bins, homepage `https://archcontext.repoharness.com`, and license `UNLICENSED`.

## Install Smoke

The clean install smoke used a temporary npm prefix with `node@24` and `archctx@beta`.

- Node: `v24.18.0`
- `archctx --help`: ok, requestId `help`, 36 commands
- `archctx update --check`: ok, currentVersion `0.1.4-beta.0`, latestVersion `0.1.3`, status `current`

## Verification

- `bun run readback:fg6:npm-release-dry-run`
- `npm publish _ops/npm/fg6-release-dry-run/archctx-0.1.4-beta.0.tgz --tag beta --access public --registry=https://registry.npmjs.org/`
- `npm view archctx version dist-tags versions --json`
- `npm view archctx@0.1.4-beta.0 name version dist.tarball dist.shasum dist.integrity bin engines homepage license --json`
- temporary `node@24` + `archctx@beta` install smoke
- `bun run record:al10:release-packaging`
- `bun run readback:al10:release-packaging`
