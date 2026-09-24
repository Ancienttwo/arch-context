import type { DevicePrivateKeyStore } from "@archcontext/cloud/control-plane-client";
import type { CliRuntimeDeps, GitHubConnectionRecord } from "../src/main";

/** In-process scaffold fixture; this does not exercise OAuth or durable credential storage. */
export function createFixtureGithubConnectionReader(
  store: DevicePrivateKeyStore,
  input: { accountId: string; githubUserId: string; publicKeyId: string }
): NonNullable<CliRuntimeDeps["githubConnectionReader"]> {
  const connectedAt = "2026-06-20T08:59:00Z";
  const deviceKey = store.provisionDevicePrivateKey({ ...input, createdAt: connectedAt }).reference;
  const record: GitHubConnectionRecord = {
    schemaVersion: "archcontext.github-connection/v1",
    status: "connected",
    accountId: input.accountId,
    githubUserId: input.githubUserId,
    issuer: "https://example.test",
    deviceKey,
    connectedAt
  };
  return { async readVerifiedConnection() { return record; } };
}
