/**
 * The routes `packages/cloud/control-plane` serves for surfaces that stay deferred: OAuth, device
 * authorization, entitlements, billing webhooks, MCP metadata, ChatGPT and notifications.
 *
 * ADR-0053 moved these here from `@archcontext/contracts` `CONTROL_PLANE_ROUTES` when it retired the
 * GitHub App governance bridge. The challenge, attestation, runner-key and check-delivery routes are
 * gone with that bridge and must not be re-added.
 */
export const CONTROL_PLANE_ROUTES = [
  "GET /oauth/github/start",
  "POST /oauth/github/callback",
  "POST /device/authorize",
  "POST /device/complete",
  "GET /entitlements/:repository",
  "POST /github/webhook",
  "POST /stripe/webhook",
  "GET /mcp/metadata",
  "GET /chatgpt/directory",
  "POST /chatgpt/releases/:version/rollback",
  "GET /notifications/providers",
  "PUT /notifications/providers/:provider",
  "POST /notifications/events"
] as const;
