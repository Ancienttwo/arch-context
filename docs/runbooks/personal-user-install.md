# Personal User Install

This runbook is the current individual-user install path for `archctx@0.1.1`.
Team collaboration, design-partner rollout, opt-in beta cohorts, and shared organization rollout evidence are deferred.

## Scope

- Target user: one local developer using ArchContext on their own repository.
- Required release artifact: public npm package `archctx@0.1.1`.
- Runtime: Bun 1.3.10 or newer must be available on `PATH`.
- Not required for this path: GitHub App installation, ArchContext Cloud token, Cloudflare deploy access, or LLM provider credentials.

## Install

```bash
curl -fsSL https://bun.sh/install | bash
```

Open a new terminal, then verify Bun and install ArchContext:

```bash
bun --version
npm install -g archctx@0.1.1
archctx --help
```

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
