# Production GA External Readback

Date: 2026-06-20

## Result

Status: blocked.

This readback did not produce a production-verified capture because the required live endpoints and external evidence were not available on this machine.

## Observed State

- `git status` before this slice showed `main...origin/main [ahead 4]` plus unrelated local modifications in `.ai/*`, `README.md`, `docs/architecture/index.md`, and `tasks/todos.md`.
- `_ops/` contained no committed or local environment authority files.
- Shell environment contained OpenAI API variables only; no ArchContext production/staging URL, Cloudflare, Slack, webhook, email, or Directory evidence variables were present.
- `https://archcontext.dev/privacy` returned HTTP 404.
- `https://archcontext.dev/chatgpt/directory` returned HTTP 404.
- `https://archcontext.dev/.well-known/oauth-authorization-server` returned HTTP 404.
- `docs/security/scans/manifest.json` contains deterministic review evidence only; `production.security-scan` remains pending.

## Readback Contract

The executable readback entrypoint is:

```bash
node deploy/scripts/production-ga-readback.mjs preflight --environment production --json
node deploy/scripts/production-ga-readback.mjs run --environment production --json
```

Required production evidence:

- Deployed ArchContext base URL.
- GPT App Directory listing or non-secret evidence artifact.
- Real provider delivery evidence or explicitly safe provider webhook probe.
- Redacted production or staging HAR registered into `docs/security/captures/manifest.json` and verified with `node scripts/privacy-capture-manifest.mjs readback --require-external`.
- Production or staging security scan registered into `docs/security/scans/manifest.json` and verified with `node scripts/security-scan-manifest.mjs readback --require-external`.

## Boundary

This file is not a production launch approval. It records why the production GA claim remains blocked after Sprint 3 repo-local completion.
