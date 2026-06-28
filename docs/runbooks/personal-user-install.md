# Personal User Install

This runbook is the current individual-user install path for `archctx@0.1.5`.
Team collaboration, design-partner rollout, opt-in beta cohorts, and shared organization rollout evidence are deferred.

## Scope

- Target user: one local developer using ArchContext on their own repository.
- Required release artifact: public npm package `archctx@0.1.5` (`latest`).
- Runtime: Node.js 24.x or 25.x, npm, and git must be available on `PATH`.
- Not required for this path: GitHub App installation, ArchContext Cloud token, Cloudflare deploy access, or LLM provider credentials.
- Do not treat this runbook as approved for a published package version until `docs/verification/fg6-release-distribution-readback.json` is verified for that exact version.

## Install

Verify Node/npm/git and install the current npm release:

```bash
node --version
npm --version
git --version
npm install -g archctx@latest
archctx --help
```

For pinned reproduction of the current verified release:

```bash
npm install -g archctx@0.1.5
```

The npm package is the generated public `archctx` artifact. The repository root package `archcontext` and workspace packages remain private source manifests for building and verifying that artifact.

## First Run

Run from an ordinary Git repository:

```bash
cd /path/to/your/repo

archctx doctor
archctx paths
archctx init
archctx sync
archctx context --task "first local context smoke"
archctx prepare --task "first local context smoke"
archctx status
```

The no-cloud first-run path is expected to stay local-only. It should not require GitHub, Cloudflare, ArchContext Cloud, OpenAI, Anthropic, or other provider credentials.

## Verification Surface

- Public release artifact: `docs/verification/fg6-release-distribution-readback.json`
- Local no-cloud first run: `docs/verification/fg6-local-no-cloud-readback.json`
- Release gate summary: `docs/verification/fg6-staging-release-gate.md`
