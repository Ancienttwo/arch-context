/**
 * The control-plane route table: OAuth, device authorization, entitlements, the Stripe webhook,
 * MCP metadata, ChatGPT and notifications. `routeDigest()` digests this list, and the compatibility
 * policy (`docs/api/control-plane-compatibility-policy.md`) treats removing or renaming an entry as
 * a breaking change.
 */
export const CONTROL_PLANE_ROUTES = [
  "GET /oauth/github/start",
  "POST /oauth/github/callback",
  "POST /device/authorize",
  "POST /device/complete",
  "GET /entitlements/:repository",
  "POST /stripe/webhook",
  "GET /mcp/metadata",
  "GET /chatgpt/directory",
  "POST /chatgpt/releases/:version/rollback",
  "GET /notifications/providers",
  "PUT /notifications/providers/:provider",
  "POST /notifications/events"
] as const;
