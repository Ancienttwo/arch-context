import { errorEnvelope, okEnvelope, type Json } from "../../contracts/src/index";

export const CLOUD_METADATA_TOOLS = [
  "archcontext_account_status",
  "archcontext_billing_status",
  "archcontext_github_installations",
  "archcontext_device_sessions"
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
    archcontext_account_status: { accountId: args.accountId ?? "acct_demo", authenticated: true },
    archcontext_billing_status: { plan: "free", privateRepositoriesAllowed: false },
    archcontext_github_installations: { installations: [] },
    archcontext_device_sessions: { devices: [], revocable: true }
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
