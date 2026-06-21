import { digestJson } from "./schema";

export const CONTROL_PLANE_ROUTES = [
  "GET /oauth/github/start",
  "POST /oauth/github/callback",
  "POST /device/authorize",
  "POST /device/complete",
  "GET /entitlements/:repository",
  "POST /github/webhook",
  "POST /stripe/webhook",
  "GET /v1/challenges",
  "POST /v1/challenges",
  "GET /v1/challenges/:challenge",
  "POST /v1/challenges/:challenge/lease",
  "POST /v1/challenges/:challenge/attestations",
  "POST /v1/challenges/:challenge/cancel",
  "POST /v1/device-keys",
  "POST /v1/device-keys/:device/revoke",
  "POST /v1/runner-keys",
  "POST /v1/runner-keys/:runner/rotate",
  "POST /v1/runner-keys/:runner/revoke",
  "POST /attestations/verify",
  "POST /org-runners",
  "POST /org-runners/:runner/revoke",
  "GET /mcp/metadata",
  "GET /chatgpt/directory",
  "POST /chatgpt/releases/:version/rollback",
  "GET /notifications/providers",
  "PUT /notifications/providers/:provider",
  "POST /notifications/events"
] as const;

export function controlPlaneRouteDigest(routes: readonly string[] = CONTROL_PLANE_ROUTES): string {
  return digestJson([...routes]);
}
