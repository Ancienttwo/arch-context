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
const forbiddenGitHubApiEndpointPatterns = [
  { name: "github.pr-files", pattern: /^\/(?:repos\/[^/]+\/[^/]+|repositories\/[^/]+)\/pulls\/[^/?#]+\/files(?:[?#].*)?$/ },
  { name: "github.contents", pattern: /^\/(?:repos\/[^/]+\/[^/]+|repositories\/[^/]+)\/contents(?:\/[^?#]*)?(?:[?#].*)?$/ },
  { name: "github.blob", pattern: /^\/(?:repos\/[^/]+\/[^/]+|repositories\/[^/]+)\/git\/blobs\/[^/?#]+(?:[?#].*)?$/ },
  { name: "github.tree", pattern: /^\/(?:repos\/[^/]+\/[^/]+|repositories\/[^/]+)\/git\/trees\/[^/?#]+(?:[?#].*)?$/ }
];
const forbiddenGitHubAcceptMediaTypes = [
  "application/vnd.github.diff",
  "application/vnd.github.patch",
  "application/vnd.github.v3.diff",
  "application/vnd.github.v3.patch"
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
      for (const finding of auditGitHubPrivacyContractSource(root, file, productionSource)) findings.push(finding);
    }
  }
  return {
    ok: findings.length === 0,
    scannedFiles,
    findings
  };
}

function auditGitHubPrivacyContractSource(root, file, source) {
  const findings = [];
  const path = display(root, file);

  for (const literal of stringLiterals(source)) {
    const value = literal.value.trim();
    const lower = value.toLowerCase();
    for (const endpoint of forbiddenGitHubApiEndpointPatterns) {
      if (endpoint.pattern.test(value)) {
        findings.push(`${path} references forbidden GitHub API endpoint ${endpoint.name}`);
      }
    }
    for (const mediaType of forbiddenGitHubAcceptMediaTypes) {
      if (acceptLiteralContainsMediaType(lower, mediaType)) {
        findings.push(`${path} references forbidden GitHub API media type ${mediaType}`);
      }
    }
  }

  return findings;
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

function stringLiterals(source) {
  const out = [];
  const pattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of source.matchAll(pattern)) out.push({ value: match[2] ?? "", index: match.index ?? 0 });
  return out;
}

function acceptLiteralContainsMediaType(value, mediaType) {
  return value
    .split(",")
    .map((part) => part.trim().split(";")[0])
    .some((part) => part === mediaType);
}

function isTestFile(file) {
  return file.includes(`${sep}test${sep}`) || /\.test\.(ts|tsx|mts|cts|js|mjs)$/.test(file);
}

function display(root, file) {
  return relative(root, file).split(sep).join("/");
}
