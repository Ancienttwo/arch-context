# Public Repository Demo

Goal: complete install to first task context in under 10 minutes.

```bash
archctx install --host codex
archctx init --name Demo
archctx sync
archctx validate
archctx prepare --task "add team invitations"
archctx complete --task-session-id demo
```

Expected result: public repositories work without subscription and no SaaS private content route is used.
