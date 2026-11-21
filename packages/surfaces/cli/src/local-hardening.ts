import { ARCHCONTEXT_NODE_RANGE, nodeVersionSatisfiesRange, productVersionManifest, type LocalEgressReport } from "@archcontext/contracts";

export function secureDefaults() {
  return {
    tunnelEnabledByDefault: false,
    cloudContentUpload: "deny",
    thirdPartyTelemetry: "disabled-by-default",
    defaultEgress: "local-only",
    applyChangeSetRequiresApproval: true
  };
}

export function diagnostics(egress: LocalEgressReport) {
  return {
    node: process.version,
    supportedNode: nodeVersionSatisfiesRange(process.version, ARCHCONTEXT_NODE_RANGE),
    codeGraphVersion: productVersionManifest().runtime.codeGraph.requiredVersion,
    secureDefaults: secureDefaults(),
    egress
  };
}

export function installMarker(host: "codex" | "claude" | "generic") {
  return `<!-- BEGIN ARCHCONTEXT ${host} -->\nUse archcontext_prepare_task before coding and archcontext_complete_task before final response.\n<!-- END ARCHCONTEXT ${host} -->`;
}

export function uninstallMarker(content: string, host: "codex" | "claude" | "generic") {
  return content
    .replace(new RegExp(`\\n?<!-- BEGIN ARCHCONTEXT ${host} -->[\\s\\S]*?<!-- END ARCHCONTEXT ${host} -->\\n?`, "g"), "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
