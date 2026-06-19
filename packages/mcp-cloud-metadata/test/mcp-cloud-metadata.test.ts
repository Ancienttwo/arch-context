import { describe, expect, test } from "bun:test";
import { assertNoRepositoryContentProxy, callCloudMetadataTool, listCloudMetadataTools } from "../src/index";

describe("cloud metadata MCP", () => {
  test("exposes only metadata tools and denies content proxy", () => {
    const tools = listCloudMetadataTools();
    expect(tools).toContain("archcontext_account_status");
    expect(() => assertNoRepositoryContentProxy(tools)).not.toThrow();
    expect((callCloudMetadataTool("archcontext_read_source") as any).error.code).toBe("AC_TUNNEL_SCOPE_DENIED");
  });
});
