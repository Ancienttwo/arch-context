# Staging readback authentication

The FG5 Check-delivery diagnostic route requires `ARCHCONTEXT_READBACK_SECRET`. Keep it separate from `GITHUB_WEBHOOK_SECRET`, which authenticates GitHub webhooks only. Missing or equal keys disable readback with HTTP 401.

For a deployment, provision an independent random key in the Worker secret store and the operator's ignored `_ops/env/fg2-staging.env`. The repository's staging secret installer accepts this field and refuses key reuse before installing any secrets. Do not pass secret values in CLI arguments or commit them to evidence files.

The operator command `bun run readback:fg5:check-failure` signs the POST method, route and current ISO timestamp using the dedicated key. The Worker allows an age of at most five minutes and at most 30 seconds of future clock skew. Synchronize the operator clock and regenerate the request if this window is exceeded. Requests remain replayable within that bounded window; this diagnostic endpoint does not promise one-shot execution.

Deploy the updated Worker and client together. Existing recorded evidence remains historical; rerun the authorized staging readback after provisioning to obtain current deployment evidence.
