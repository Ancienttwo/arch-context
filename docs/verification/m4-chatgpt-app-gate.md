# M4 ChatGPT App Gate

Date: 2026-06-19

## Scope

M4 adds the ChatGPT-facing local surface: loopback Streamable HTTP MCP, explicit Secure MCP Tunnel, read-only ChatGPT tool list by default, resource-backed UI metadata, data-sharing disclosure, metadata-only remote MCP, and OAuth/PKCE client validation.

## Evidence

- Local HTTP MCP and tunnel: `packages/surfaces/mcp-local/src/index.ts`.
- Metadata-only remote MCP: `packages/cloud/mcp-cloud-metadata/src/index.ts`.
- OAuth/PKCE client checks: `packages/cloud/control-plane-client/src/index.ts`.
- ChatGPT UI resource: `packages/surfaces/chatgpt-ui/src/index.ts`.

## Verified Path

```text
ChatGPT connector
  -> explicit tunnel start
  -> local loopback HTTP MCP
  -> read-only tools by default
  -> UI resource metadata
  -> visible OpenAI data-sharing disclosure
  -> no SaaS content proxy
```

## Verification

Command:

```bash
bun test
```

Observed result:

```text
77 pass
0 fail
```

## Boundary Notes

- Local HTTP MCP rejects non-loopback host.
- Tunnel is opt-in, short-lived, scoped, revocable, and invalid after expiry.
- ChatGPT tool list excludes `archcontext_apply_update` unless write mode is explicitly enabled.
- Remote MCP exposes account/billing/GitHub/device metadata only.
- ArchContext SaaS tokens are refused when building GitHub request headers.
