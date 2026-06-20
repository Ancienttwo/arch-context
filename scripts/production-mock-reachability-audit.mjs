import { builtinModules } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".json"];
const blockedSourceTokens = [
  "MockCodeGraphProvider",
  "TestLocalStore",
  "InMemoryLocalStore"
];
const blockedBundleMarkers = [
  ...blockedSourceTokens,
  "@archcontext/local-runtime/test",
  "codegraph-adapter/test",
  "local-store-sqlite/test",
  "/test/factories"
];
const productionBundleEntry = "packages/surfaces/cli/src/main.ts";
const findings = [];

const workspaces = discoverWorkspaces();
const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
const productionEntries = collectProductionExports(workspaces);
const graph = buildDependencyGraph(productionEntries.map((entry) => entry.file));
const bundle = buildAndScanProductionBundle();
const runtime = runRuntimeProductionAssertion();

if (findings.length > 0) {
  console.error("Production mock reachability audit failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(JSON.stringify({
  schemaVersion: "archcontext.production-mock-reachability-audit/v1",
  workspaceCount: workspaces.length,
  productionExports: productionEntries.length,
  graphFiles: graph.files.length,
  bundle,
  runtime
}, null, 2));

function discoverWorkspaces() {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return manifest.workspaces.map((workspacePath) => {
    const dir = resolve(root, workspacePath);
    const packageJsonPath = join(dir, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return { dir, packageJsonPath, packageJson, name: packageJson.name };
  }).sort((a, b) => b.dir.length - a.dir.length);
}

function collectProductionExports(workspaces) {
  const entries = [];
  for (const workspace of workspaces) {
    for (const exported of exportEntries(workspace.packageJson.exports)) {
      const exportPath = exported.key;
      const targets = exportTargets(exported.value);
      for (const target of targets) {
        if (isTestExport(exportPath, target)) {
          findings.push(`${display(workspace.packageJsonPath)} exports test-only subpath ${exportPath} -> ${target}`);
          continue;
        }
        const file = resolveFile(resolve(workspace.dir, target));
        if (!file) {
          findings.push(`${display(workspace.packageJsonPath)} export ${exportPath} target ${target} does not resolve`);
          continue;
        }
        entries.push({ workspace: workspace.name, exportPath, file });
      }
    }
  }
  return entries;
}

function exportEntries(exportsValue) {
  if (!exportsValue) return [];
  if (typeof exportsValue === "string") return [{ key: ".", value: exportsValue }];
  if (Array.isArray(exportsValue)) return exportsValue.map((value, index) => ({ key: `[${index}]`, value }));
  return Object.entries(exportsValue).map(([key, value]) => ({ key, value }));
}

function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (value && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}

function isTestExport(exportPath, target) {
  return exportPath.includes("/test") || exportPath === "./test" || target.includes("/test/");
}

function buildDependencyGraph(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (isTestFile(file)) findings.push(`production dependency graph reaches test file ${display(file)}`);
    const source = readFileSync(file, "utf8");
    for (const token of blockedSourceTokens) {
      if (source.includes(token)) findings.push(`production dependency graph reaches ${token} in ${display(file)}`);
    }
    for (const specifier of importSpecifiers(source)) {
      const target = resolveImport(file, specifier);
      if (target) stack.push(target);
    }
  }
  return { files: [...seen].sort().map(display) };
}

function importSpecifiers(source) {
  const out = [];
  const pattern = /\bimport\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+(?:type\s+)?[^'";]*?\s+from\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

function resolveImport(fromFile, specifier) {
  if (specifier.startsWith("node:") || builtinModules.includes(specifier)) return undefined;
  if (specifier.startsWith(".")) {
    const target = resolveFile(resolve(dirname(fromFile), specifier));
    if (!target) findings.push(`${display(fromFile)} imports unresolved relative specifier ${specifier}`);
    return target;
  }
  if (!specifier.startsWith("@archcontext/")) return undefined;
  const packageName = packageNameFromSpecifier(specifier);
  const workspace = workspaceByName.get(packageName);
  if (!workspace) return undefined;
  const subpath = specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;
  const exported = exportEntries(workspace.packageJson.exports).find((entry) => entry.key === subpath);
  if (!exported) {
    findings.push(`${display(fromFile)} imports non-exported workspace subpath ${specifier}`);
    return undefined;
  }
  const targets = exportTargets(exported.value).filter((target) => !isTestExport(exported.key, target));
  if (targets.length === 0) {
    findings.push(`${display(fromFile)} imports test-only workspace subpath ${specifier}`);
    return undefined;
  }
  const resolvedTargets = targets.map((target) => resolveFile(resolve(workspace.dir, target))).filter(Boolean);
  if (resolvedTargets.length === 0) findings.push(`${display(fromFile)} imports unresolved workspace specifier ${specifier}`);
  return resolvedTargets[0];
}

function resolveFile(target) {
  const candidates = [
    target,
    ...sourceExtensions.map((extension) => `${target}${extension}`),
    ...sourceExtensions.map((extension) => join(target, `index${extension}`))
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function buildAndScanProductionBundle() {
  const dir = mkdtempSync(join(tmpdir(), "archctx-production-bundle-"));
  const outfile = join(dir, "archctx.mjs");
  try {
    const result = spawnSync("bun", [
      "build",
      productionBundleEntry,
      "--target=node",
      "--format=esm",
      "--outfile",
      outfile
    ], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.status !== 0) {
      findings.push(`production bundle build failed: ${trimOutput(result.stderr || result.stdout)}`);
      return { entry: productionBundleEntry, bytes: 0 };
    }
    const source = readFileSync(outfile, "utf8");
    for (const marker of blockedBundleMarkers) {
      if (source.includes(marker)) findings.push(`production bundle contains blocked marker ${marker}`);
    }
    return { entry: productionBundleEntry, bytes: Buffer.byteLength(source) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runRuntimeProductionAssertion() {
  const source = `
    import { mkdtempSync, rmSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { createStartedProductionDaemon, assertProductionRuntimeDeps } from "@archcontext/local-runtime/runtime-daemon";
    const root = mkdtempSync(join(tmpdir(), "archctx-production-runtime-"));
    let daemon;
    try {
      daemon = await createStartedProductionDaemon({ root, localStorePath: join(root, ".archcontext", "runtime.sqlite") });
      const report = daemon.compositionReport();
      if (report.mode !== "production") throw new Error("expected production composition mode");
      if (report.productionSafe !== true) throw new Error("expected productionSafe=true");
      const expectedAdapters = {
        codeFacts: "codegraph-cli",
        codeGraphProviderFactory: "codegraph-cli",
        modelStore: "yaml",
        localStore: "sqlite",
        changeSetEngine: "default"
      };
      for (const [key, value] of Object.entries(expectedAdapters)) {
        if (report.adapters[key] !== value) throw new Error("unexpected adapter " + key + "=" + report.adapters[key]);
      }
      const blockedKeys = ["codeFacts", "codeGraphProviderFactory", "modelStore", "localStore", "changeSetEngine", "clock"];
      for (const key of blockedKeys) {
        const injected = key === "clock" ? (() => "2026-06-20T00:00:00.000Z") : key === "codeGraphProviderFactory" ? (() => ({})) : {};
        try {
          assertProductionRuntimeDeps({ [key]: injected });
          throw new Error("accepted production injection " + key);
        } catch (error) {
          if (!String(error?.message ?? error).includes(key)) throw error;
        }
      }
      console.log(JSON.stringify({ report, blockedKeys }));
    } finally {
      if (daemon) await daemon.stop();
      rmSync(root, { recursive: true, force: true });
    }
  `;
  const result = spawnSync("bun", ["--eval", source], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    findings.push(`runtime production assertion failed: ${trimOutput(result.stderr || result.stdout)}`);
    return { ok: false };
  }
  try {
    return { ok: true, ...JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") };
  } catch {
    findings.push(`runtime production assertion emitted invalid JSON: ${trimOutput(result.stdout)}`);
    return { ok: false };
  }
}

function packageNameFromSpecifier(specifier) {
  const [scope, name] = specifier.split("/");
  return `${scope}/${name}`;
}

function isTestFile(file) {
  return file.split(sep).includes("test") || /\.test\.(ts|tsx|mts|cts|js|mjs)$/.test(file);
}

function trimOutput(output) {
  return output.trim().split("\n").slice(-6).join(" | ");
}

function display(file) {
  return relative(root, file).split(sep).join("/");
}
