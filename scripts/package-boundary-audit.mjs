import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = process.cwd();

const CORE_PACKAGES = new Set([
  "@archcontext/application",
  "@archcontext/architecture-domain",
  "@archcontext/changeset-engine",
  "@archcontext/context-compiler",
  "@archcontext/policy-engine",
  "@archcontext/pressure-engine",
  "@archcontext/reconcile-engine",
  "@archcontext/refactor-decision",
  "@archcontext/retrieval",
  "@archcontext/review-engine"
]);

const APP_PACKAGES = new Set([
  "@archcontext/chatgpt-ui",
  "@archcontext/control-plane"
]);

const ADAPTER_AND_RUNTIME_PACKAGES = new Set([
  "@archcontext/adapter-likec4",
  "@archcontext/adapter-structurizr",
  "@archcontext/attestation",
  "@archcontext/cli",
  "@archcontext/cloud-db",
  "@archcontext/codegraph-adapter",
  "@archcontext/control-plane-client",
  "@archcontext/explorer-ui",
  "@archcontext/git-adapter",
  "@archcontext/github-app",
  "@archcontext/hardening",
  "@archcontext/local-store-sqlite",
  "@archcontext/mcp-cloud-metadata",
  "@archcontext/mcp-local",
  "@archcontext/model-store-yaml",
  "@archcontext/notifications",
  "@archcontext/renderer",
  "@archcontext/runner",
  "@archcontext/runtime-daemon"
]);

const workspaces = discoverWorkspaces();
const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
const findings = [];

for (const file of listFiles(root)) {
  if (!isWorkspaceSource(file)) continue;
  const owner = findWorkspace(file);
  if (!owner) continue;
  const source = readFileSync(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (specifier.startsWith(".")) {
      checkRelativeImport(owner, file, specifier);
      continue;
    }
    if (specifier.startsWith("@archcontext/")) {
      checkWorkspaceImport(owner, file, specifier);
    }
  }
}

if (findings.length > 0) {
  console.error("Package boundary audit failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Package boundary audit passed (${workspaces.length} workspaces).`);

function discoverWorkspaces() {
  const out = [];
  for (const base of ["apps", "packages"]) {
    const baseDir = resolve(root, base);
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(baseDir, entry.name);
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      out.push({ dir, manifest, name: manifest.name });
    }
  }
  return out.sort((a, b) => b.dir.length - a.dir.length);
}

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", ".codegraph", "node_modules"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    if (entry.isFile()) out.push(full);
  }
  return out;
}

function isWorkspaceSource(file) {
  return /\.(ts|tsx|mts|cts)$/.test(file) && (file.includes(`${sep}apps${sep}`) || file.includes(`${sep}packages${sep}`));
}

function importSpecifiers(source) {
  const out = [];
  const pattern = /\bimport\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+(?:type\s+)?[^'";]*?\s+from\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

function findWorkspace(file) {
  const absolute = resolve(file);
  return workspaces.find((workspace) => absolute === workspace.dir || absolute.startsWith(`${workspace.dir}${sep}`));
}

function checkRelativeImport(owner, file, specifier) {
  const target = resolve(dirname(file), specifier);
  const targetWorkspace = findWorkspace(target);
  if (!targetWorkspace || targetWorkspace.name === owner.name) return;
  findings.push(`${display(file)} imports ${specifier}, crossing into ${targetWorkspace.name}; use the package entrypoint`);
}

function checkWorkspaceImport(owner, file, specifier) {
  const importedName = packageNameFromSpecifier(specifier);
  const imported = workspaceByName.get(importedName);
  if (!imported || imported.name === owner.name) return;
  const testImport = isTestFile(file);

  const declared = {
    ...owner.manifest.dependencies,
    ...owner.manifest.devDependencies,
    ...owner.manifest.peerDependencies
  };
  if (testImport) {
    if (declared[imported.name] !== "workspace:*") {
      findings.push(`${display(file)} imports ${imported.name}, but ${display(join(owner.dir, "package.json"))} does not declare workspace:*`);
    }
  } else if (owner.manifest.dependencies?.[imported.name] !== "workspace:*") {
    findings.push(`${display(file)} imports ${imported.name}, but ${display(join(owner.dir, "package.json"))} does not declare it in dependencies`);
  }

  if (!testImport && owner.name === "@archcontext/contracts") {
    findings.push(`${display(file)} is in contracts and must not import ${imported.name}`);
  }

  if (!testImport && !APP_PACKAGES.has(owner.name) && APP_PACKAGES.has(imported.name)) {
    findings.push(`${display(file)} imports app package ${imported.name}; package code must not depend on deployable apps`);
  }

  if (!testImport && CORE_PACKAGES.has(owner.name) && ADAPTER_AND_RUNTIME_PACKAGES.has(imported.name)) {
    findings.push(`${display(file)} is core package ${owner.name} importing adapter/runtime package ${imported.name}`);
  }
}

function isTestFile(file) {
  return file.includes(`${sep}test${sep}`) || /\.test\.(ts|tsx|mts|cts)$/.test(file);
}

function packageNameFromSpecifier(specifier) {
  const [scope, name] = specifier.split("/");
  return `${scope}/${name}`;
}

function display(file) {
  return relative(root, file).split(sep).join("/");
}
