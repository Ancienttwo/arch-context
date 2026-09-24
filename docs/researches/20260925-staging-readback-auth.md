# Staging readback authentication — issue #171

## Map and trace

The FG5 failure-injection route in `deploy/cloudflare/fg2-staging-worker.ts` accepts a POST authorized by an HMAC over method, path and timestamp. The operator client is `scripts/fg5-check-failure-readback.ts`. GitHub webhook verification is a separate route, but both previously used `GITHUB_WEBHOOK_SECRET`. The readback verifier never parsed or checked the signed timestamp.

Two pre-fix regressions returned HTTP 200 for a request signed with the webhook key and for an expired request. Both must return HTTP 401 before the diagnostic simulation starts.

## Decision

Require `ARCHCONTEXT_READBACK_SECRET` for the diagnostic route and refuse it if it equals the configured webhook key. The operator client uses that key exclusively, without the former webhook-secret CLI option or environment fallback. The deployment template and installer declare the separate key and reject reuse before installing any secret.

The verifier accepts canonical ISO timestamps no more than five minutes old and at most 30 seconds in the future. Malformed, normalized invalid dates, old and future timestamps fail closed. This bounds replay lifetime; it does not claim one-shot replay prevention within the accepted time window. Existing constant-time HMAC comparison remains unchanged. No extra network call, shared mutable cache or state store is introduced; at increased request volume the work remains one parse and HMAC per request.

## Validation and rollout boundary

Worker tests cover missing and reused keys, wrong key, stale/future/malformed timestamps, successful readback and unchanged webhook handling. An operator-client-to-Worker test proves the dedicated key works end to end, absence of the key performs no fetch, and saved evidence contains neither key. Typecheck passes.

This PR changes source and deployment instructions only. Existing deployments must receive an independently generated `ARCHCONTEXT_READBACK_SECRET` in both the Worker secret store and the operator's ignored environment file before readback resumes. No live credentials were created, installed or rotated and no deployment/readback was run.
