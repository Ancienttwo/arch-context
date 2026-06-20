import { digestJson } from "./schema";

export const CONTROL_PLANE_ROUTES = [
  "GET /oauth/github/start",
  "POST /oauth/github/callback",
  "POST /device/authorize",
  "POST /device/complete",
  "GET /entitlements/:repository",
  "POST /github/webhook",
  "POST /stripe/webhook",
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
