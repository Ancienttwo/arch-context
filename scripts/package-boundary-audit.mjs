import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = process.cwd();

const REQUIRED_BOUNDARIES = new Set([
  "@archcontext/contracts",
  "@archcontext/core",
  "@archcontext/local-runtime",
  "@archcontext/surfaces",
  "@archcontext/cloud"
]);

const workspaces = discoverWorkspaces();
const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
const findings = [];

for (const file of listFiles(root)) {
  if (!isWorkspaceSource(file)) continue;
  const owner = findWorkspace(file);
  if (!owner) continue;
  const source = readFileSync(file, "utf8");
  checkProductionFallbacks(file, source);
  checkArchitectureLedgerBypass(file, source);
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
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const out = rootManifest.workspaces.map((workspacePath) => {
    const dir = resolve(root, workspacePath);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { dir, manifest, name: manifest.name };
  });
  const names = new Set(out.map((workspace) => workspace.name));
  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!names.has(boundary)) findings.push(`root workspaces must include ${boundary}`);
  }
  if (out.length !== REQUIRED_BOUNDARIES.size) {
    findings.push(`root workspaces must collapse to ${REQUIRED_BOUNDARIES.size} packages, got ${out.length}`);
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
  return /\.(ts|tsx|mts|cts)$/.test(file) && file.includes(`${sep}packages${sep}`);
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
  if (isTestFile(file)) return;
  findings.push(`${display(file)} imports ${specifier}, crossing into ${targetWorkspace.name}; use the package entrypoint`);
}

function checkWorkspaceImport(owner, file, specifier) {
  const importedName = packageNameFromSpecifier(specifier);
  const imported = workspaceByName.get(importedName);
  if (!imported || imported.name === owner.name) return;
  const testImport = isTestFile(file);
  const testFactoryImport = specifier.includes("/test/");

  const declared = {
    ...owner.manifest.dependencies,
    ...owner.manifest.devDependencies,
    ...owner.manifest.peerDependencies
  };
  if (declared[imported.name] !== "workspace:*") {
    findings.push(`${display(file)} imports ${imported.name}, but ${display(join(owner.dir, "package.json"))} does not declare workspace:*`);
  }

  if (!testImport && testFactoryImport) {
    findings.push(`${display(file)} imports test-only factory ${specifier}`);
  }

  if (!testImport && owner.name === "@archcontext/contracts") {
    findings.push(`${display(file)} is in contracts and must not import ${imported.name}`);
  }
  if (!testImport && owner.name === "@archcontext/core" && !["@archcontext/contracts", "@archcontext/core"].includes(imported.name)) {
    findings.push(`${display(file)} is core importing ${imported.name}; core must stay pure`);
  }
  if (!testImport && owner.name === "@archcontext/local-runtime" && ["@archcontext/surfaces", "@archcontext/cloud"].includes(imported.name)) {
    findings.push(`${display(file)} is local-runtime importing ${imported.name}; runtime must not depend on surfaces/cloud`);
  }
  if (!testImport && owner.name === "@archcontext/cloud" && imported.name === "@archcontext/surfaces") {
    findings.push(`${display(file)} is cloud importing surfaces; cloud must stay transport/UI independent`);
  }
}

function checkProductionFallbacks(file, source) {
  if (isTestFile(file)) return;
  if (source.includes("MockCodeGraphProvider")) findings.push(`${display(file)} references MockCodeGraphProvider outside tests`);
  if (source.includes("TestLocalStore") || source.includes("InMemoryLocalStore")) findings.push(`${display(file)} references test local store outside tests`);
  if (source.includes("sha256:0000000000000000000000000000000000000000000000000000000000000000")) findings.push(`${display(file)} contains zero digest fallback`);
  if (/\bheadSha:\s*["']local["']/.test(source)) findings.push(`${display(file)} contains local headSha fallback`);
}

function checkArchitectureLedgerBypass(file, source) {
  if (isTestFile(file)) return;
  if (!display(file).startsWith("packages/surfaces/")) return;
  const forbidden = [
    [/\.(appendArchitectureEvents|recordChangeSetLedgerPlan|recordChangeSetLedgerAppend|rebuildArchitectureLedgerCurrentState)\s*\(/, "mutates the architecture ledger store directly"],
    [/(writeFileSync|rmSync|renameSync|cpSync)\s*\([^)]*["']\.archcontext\/model\//s, "mutates the Git architecture model projection directly"]
  ];
  for (const [pattern, reason] of forbidden) {
    if (pattern.test(source)) findings.push(`${display(file)} ${reason}; route ledger writes through runtime-daemon`);
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
