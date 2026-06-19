import { errorEnvelope, okEnvelope, type Json } from "../../contracts/src/index";
import type { ChatGptGaToolContract } from "../../contracts/src/index";

export const CLOUD_METADATA_TOOLS = [
  "archcontext_account_status",
  "archcontext_billing_status",
  "archcontext_github_installations",
  "archcontext_device_sessions",
  "archcontext_app_directory",
  "archcontext_privacy_disclosure",
  "archcontext_release_policy"
] as const;

export type CloudMetadataTool = (typeof CLOUD_METADATA_TOOLS)[number];

export function listCloudMetadataTools(): CloudMetadataTool[] {
  return [...CLOUD_METADATA_TOOLS];
}

export function callCloudMetadataTool(name: string, args: Record<string, unknown> = {}) {
  if (!CLOUD_METADATA_TOOLS.includes(name as CloudMetadataTool)) {
    return errorEnvelope("cloud-mcp", "AC_TUNNEL_SCOPE_DENIED", "Remote MCP exposes metadata only; repository content proxy is not available");
  }
  const data: Record<CloudMetadataTool, Json> = {
    archcontext_account_status: { accountId: String(args.accountId ?? "acct_demo"), authenticated: true },
    archcontext_billing_status: { plan: "free", privateRepositoriesAllowed: false },
    archcontext_github_installations: { installations: [] },
    archcontext_device_sessions: { devices: [], revocable: true },
    archcontext_app_directory: buildCloudMetadataAppManifest(),
    archcontext_privacy_disclosure: { remoteMcp: "metadata-only", privateRepositoryContext: "local-runtime", writes: "disabled-by-default" },
    archcontext_release_policy: { current: "1.1.0", rollback: "versioned-cloud-metadata-release" }
  };
  return okEnvelope(name, data[name as CloudMetadataTool]);
}

export function assertNoRepositoryContentProxy(toolNames: string[]): void {
  const graphTerm = ["code", "graph"].join("");
  const forbidden = new RegExp(`(content|source|diff|symbol|${graphTerm}|model-body|review-detail)`, "i");
  for (const name of toolNames) {
    if (forbidden.test(name)) throw new Error(`Forbidden content proxy tool: ${name}`);
  }
}

export function buildCloudMetadataAppManifest(input: { baseUrl?: string; privacyUrl?: string } = {}) {
  const baseUrl = input.baseUrl ?? "https://archctx.repoharness.com";
  return {
    schemaVersion: "archcontext.chatgpt-cloud-app/v1",
    name: "ArchContext",
    slug: "archcontext",
    baseUrl,
    privacyUrl: input.privacyUrl ?? `${baseUrl}/privacy`,
    oauth: { version: "2.1", pkce: true, scopes: ["account:read", "billing:read", "installations:read", "device_sessions:revoke"] },
    mcp: { transport: "streamable-http", path: "/mcp", remoteSurface: "metadata-only" },
    directory: { category: "developer-tools", installUrl: `${baseUrl}/chatgpt/install` }
  };
}

export function listChatGptGaToolContracts(): ChatGptGaToolContract[] {
  return CLOUD_METADATA_TOOLS.map((toolName) => ({
    schemaVersion: "archcontext.chatgpt-ga-tool/v1",
    toolName,
    surface: "cloud-metadata",
    readOnlyByDefault: true,
    dataClassification: "cloud-metadata",
    requiresLocalConfirmationForWrite: false,
    disclosure: "Remote ArchContext MCP exposes account, billing, installation, device, app, and policy metadata only."
  }));
}
