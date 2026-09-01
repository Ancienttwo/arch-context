import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CONTRACTS_SOURCE_PACKAGE_NAME = "@archcontext/contracts";
export const CONTRACTS_PUBLIC_PACKAGE_NAME = "archctx-contracts";
export const CONTRACTS_SOURCE_FILES = ["src", "fixtures"];
export const CONTRACTS_PUBLIC_FILES = ["src", "fixtures", "schemas"];
export const CONTRACTS_PUBLIC_EXPORTS = {
  ".": "./src/index.ts",
  "./schemas/*": "./schemas/*"
};

/**
 * The workspace stays scoped for internal imports. This is the one staging boundary that creates
 * the separately published, unscoped consumer package so release paths cannot pack the workspace
 * manifest by accident.
 */
export function preparePublicContractsReleaseStage({ root, sourceManifest, packageName = CONTRACTS_PUBLIC_PACKAGE_NAME }) {
  const packageRoot = join(root, "packages", "contracts");
  const workspace = mkdtempSync(join(tmpdir(), "archctx-contracts-publish."));
  cpSync(join(packageRoot, "src"), join(workspace, "src"), { recursive: true });
  cpSync(join(packageRoot, "fixtures"), join(workspace, "fixtures"), { recursive: true });
  cpSync(join(root, "schemas"), join(workspace, "schemas"), { recursive: true });
  const packageJson = buildPublicContractsReleaseManifest(sourceManifest, packageName);
  writeFileSync(join(workspace, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  return { workspace, packageJson };
}

export function cleanupPublicContractsReleaseStage(workspace) {
  rmSync(workspace, { recursive: true, force: true });
}

export function buildPublicContractsReleaseManifest(sourceManifest, packageName = CONTRACTS_PUBLIC_PACKAGE_NAME) {
  return {
    name: packageName,
    version: String(sourceManifest.version ?? ""),
    private: false,
    type: sourceManifest.type,
    license: sourceManifest.license,
    files: CONTRACTS_PUBLIC_FILES,
    publishConfig: { access: "public" },
    exports: CONTRACTS_PUBLIC_EXPORTS
  };
}

export function publicContractsReleaseManifestIssues(sourceManifest, packageJson, packageName = CONTRACTS_PUBLIC_PACKAGE_NAME) {
  const issues = [];
  if (sourceManifest.name !== CONTRACTS_SOURCE_PACKAGE_NAME) issues.push("source package name must remain @archcontext/contracts");
  if (sourceManifest.private !== false) issues.push("source contracts manifest must be publishable");
  if (sourceManifest.license !== "Apache-2.0") issues.push("source contracts license must be Apache-2.0");
  if (JSON.stringify(sourceManifest.files ?? []) !== JSON.stringify(CONTRACTS_SOURCE_FILES)) {
    issues.push("source contracts files must remain src and fixtures");
  }
  if (sourceManifest.exports?.["."] !== CONTRACTS_PUBLIC_EXPORTS["."]) {
    issues.push("source contracts root export is invalid");
  }
  if (packageJson.name !== packageName || packageName !== CONTRACTS_PUBLIC_PACKAGE_NAME) {
    issues.push("public contracts package must be unscoped archctx-contracts");
  }
  if (packageJson.version !== sourceManifest.version) issues.push("public contracts version must match source manifest");
  if (packageJson.private !== false) issues.push("public contracts package must be publishable");
  if (packageJson.type !== "module") issues.push("public contracts package must be ESM");
  if (packageJson.license !== "Apache-2.0") issues.push("public contracts license must be Apache-2.0");
  if (JSON.stringify(packageJson.files ?? []) !== JSON.stringify(CONTRACTS_PUBLIC_FILES)) {
    issues.push("public contracts files must include src fixtures and schemas");
  }
  if (JSON.stringify(packageJson.exports ?? {}) !== JSON.stringify(CONTRACTS_PUBLIC_EXPORTS)) {
    issues.push("public contracts exports must expose root and schemas");
  }
  if (packageJson.publishConfig?.access !== "public") issues.push("public contracts package must declare public access");
  return issues;
}
