#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_GITHUB_API_CONTRACT_SCAN_ROOTS = [
  "packages/cloud",
  "packages/contracts/src"
];

const sourceFilePattern = /\.(ts|tsx|mts|cts|js|mjs)$/;
const blockedImportSpecifiers = [
  /^octokit$/,
  /^@octokit\//
];
const blockedGenericClientIdentifiers = [
  { name: "Octokit", pattern: /\bOctokit\b/ },
  { name: "octokit", pattern: /\boctokit\b/ },
  { name: "GitHubClient", pattern: /\bGitHubClient\b/ },
  { name: "GithubClient", pattern: /\bGithubClient\b/ },
  { name: "githubClient", pattern: /\bgithubClient\b/ }
];

export async function auditGitHubApiContract({ root = process.cwd(), scanRoots = DEFAULT_GITHUB_API_CONTRACT_SCAN_ROOTS } = {}) {
  const findings = [];
  let scannedFiles = 0;
  for (const scanRoot of scanRoots) {
    for await (const file of walk(join(root, scanRoot))) {
      if (!sourceFilePattern.test(file) || isTestFile(file)) continue;
      scannedFiles += 1;
      const source = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        for (const pattern of blockedImportSpecifiers) {
          if (pattern.test(specifier)) {
            findings.push(`${display(root, file)} imports generic Octokit specifier ${specifier}`);
          }
        }
      }
      const productionSource = stripComments(source);
      for (const identifier of blockedGenericClientIdentifiers) {
        if (identifier.pattern.test(productionSource)) {
          findings.push(`${display(root, file)} references generic GitHub client identifier ${identifier.name}`);
        }
      }
    }
  }
  return {
    ok: findings.length === 0,
    scannedFiles,
    findings
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await auditGitHubApiContract();
  if (!result.ok) {
    console.error("[github-api-contract-audit] generic GitHub client usage found");
    for (const finding of result.findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log(`[github-api-contract-audit] OK scanned=${result.scannedFiles}`);
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (["node_modules", "dist", "coverage"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function importSpecifiers(source) {
  const out = [];
  const pattern = /\bimport\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+(?:type\s+)?[^'";]*?\s+from\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isTestFile(file) {
  return file.includes(`${sep}test${sep}`) || /\.test\.(ts|tsx|mts|cts|js|mjs)$/.test(file);
}

function display(root, file) {
  return relative(root, file).split(sep).join("/");
}
