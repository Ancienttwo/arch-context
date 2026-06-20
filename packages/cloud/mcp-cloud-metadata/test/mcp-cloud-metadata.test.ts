import { describe, expect, test } from "bun:test";
import {
  assertNoRepositoryContentProxy,
  buildCloudMetadataAppManifest,
  callCloudMetadataTool,
  listChatGptGaToolContracts,
  listCloudMetadataTools
} from "../src/index";

describe("cloud metadata MCP", () => {
  test("exposes only metadata tools and denies content proxy", () => {
    const tools = listCloudMetadataTools();
    expect(tools).toContain("archcontext_account_status");
    expect(() => assertNoRepositoryContentProxy(tools)).not.toThrow();
    expect((callCloudMetadataTool("archcontext_read_source") as any).error.code).toBe("AC_TUNNEL_SCOPE_DENIED");
  });

  test("builds GA Cloud Metadata App manifest and read-only tool contracts", () => {
    const manifest = buildCloudMetadataAppManifest({ baseUrl: "https://archcontext.example" });
    expect(manifest.oauth.pkce).toBe(true);
    expect(manifest.mcp.remoteSurface).toBe("metadata-only");
    expect((callCloudMetadataTool("archcontext_app_directory") as any).data.slug).toBe("archcontext");
    const contracts = listChatGptGaToolContracts();
    expect(contracts.every((contract) => contract.readOnlyByDefault)).toBe(true);
    expect(contracts.every((contract) => contract.surface === "cloud-metadata")).toBe(true);
  });
});
