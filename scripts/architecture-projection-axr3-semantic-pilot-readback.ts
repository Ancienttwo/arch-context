import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileSemanticCapabilityDiagrams,
  loadNativeModelFromArchContext,
  type ArchitectureSelectorEvidenceV1
} from "../packages/core/projection-engine/src/index";
import { loadCapabilityCodeGraphProjectionInputs } from "../packages/local-runtime/codegraph-adapter/src/index";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = join(root, "packages/core/projection-engine/test/fixtures/repo-harness-semantic-pilot");
const mermaidPackagePath = join(root, "node_modules/@mermaid-js/mermaid-cli/package.json");
const expectedMermaidVersion = "11.16.0";
const capabilityIds = [
  "capability.runtime-harness.hook-adapters",
  "capability.verification.codegraph-readiness"
];

const args = parseArgs(process.argv.slice(2));
const repoHarnessRoot = resolve(args.repo ?? "/Users/ancienttwo/Projects/repo-harness");
const declared = JSON.parse(readFileSync(join(fixtureRoot, "evidence.json"), "utf8")) as {
  repository: string;
  revision: string;
  evidence: ArchitectureSelectorEvidenceV1[];
};
const actualRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoHarnessRoot, encoding: "utf8" }).trim();
if (!actualRevision.startsWith(declared.revision)) {
  throw new Error(`repo-harness revision mismatch: expected ${declared.revision}, got ${actualRevision}`);
}

const model = loadNativeModelFromArchContext(fixtureRoot);
const measured = loadCapabilityCodeGraphProjectionInputs(repoHarnessRoot, model, {
  binary: args.codegraph ?? "codegraph",
  importNodeLimit: 1
}).selectorEvidence;
if (JSON.stringify(sortEvidence(measured)) !== JSON.stringify(sortEvidence(declared.evidence))) {
  throw new Error("pinned semantic-pilot evidence does not match the current exact CodeGraph readback");
}

const outputRoot = args.outDir ? resolve(args.outDir) : mkdtempSync(join(tmpdir(), "archctx-axr3-pilot-"));
const removeOutput = !args.outDir;
const mermaidPackage = JSON.parse(readFileSync(mermaidPackagePath, "utf8")) as { version?: string };
if (mermaidPackage.version !== expectedMermaidVersion) {
  throw new Error(`expected @mermaid-js/mermaid-cli@${expectedMermaidVersion}, found ${String(mermaidPackage.version)}`);
}

try {
  const compilations = capabilityIds.map((capabilityId) => compileSemanticCapabilityDiagrams({
    capabilityId,
    nodes: model.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      name: node.name,
      ...(node.parent ? { parent: node.parent } : {}),
      ...(node.source ? { source: node.source as never } : {})
    })),
    relations: model.relations,
    flows: model.flows ?? [],
    evidence: measured
  }));
  for (const compilation of compilations) {
    if (compilation.p1.status !== "proven" || compilation.p2.status !== "proven") {
      throw new Error(`${compilation.capabilityId} is not proven: ${JSON.stringify({ p1: compilation.p1.diagnostics, p2: compilation.p2.diagnostics })}`);
    }
    if (compilation.evidenceCoverage.unboundSelectors.length > 0
      || compilation.evidenceCoverage.provenSelectors !== compilation.evidenceCoverage.requiredSelectors) {
      throw new Error(`${compilation.capabilityId} selector coverage is incomplete`);
    }
  }

  const rendered = compilations.flatMap((compilation) => [
    renderMermaid(outputRoot, `${safeStem(compilation.capabilityId)}-p1`, compilation.p1.mermaid!),
    ...compilation.p2.mermaid.map((mermaid, index) => renderMermaid(outputRoot, `${safeStem(compilation.capabilityId)}-p2-${index + 1}`, mermaid))
  ]);
  const declarationFiles = walk(join(fixtureRoot, ".archcontext/model"));
  const declarationLoc = declarationFiles.reduce((total, path) => total + readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#")).length, 0);
  const humanReviewMinutes = Number(args.humanReviewMinutes ?? "0");
  if (!Number.isFinite(humanReviewMinutes) || humanReviewMinutes < 0) throw new Error("--human-review-minutes must be a non-negative number");
  const result = {
    schemaVersion: "archcontext.axr3-semantic-pilot-readback/v1",
    repository: declared.repository,
    revision: actualRevision,
    codeGraphVersion: execFileSync(args.codegraph ?? "codegraph", ["--version"], { encoding: "utf8" }).trim(),
    mermaidCliVersion: mermaidPackage.version,
    declarationLoc,
    humanReviewMinutes,
    pilots: compilations.map((compilation) => ({
      capabilityId: compilation.capabilityId,
      p1Status: compilation.p1.status,
      p2Status: compilation.p2.status,
      evidenceCoverage: compilation.evidenceCoverage,
      proofDigest: compilation.proofDigest
    })),
    rendered
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (removeOutput) rmSync(outputRoot, { recursive: true, force: true });
}

function renderMermaid(outputRoot: string, stem: string, markdown: string): { source: string; svg: string; png: string; svgBytes: number; pngBytes: number } {
  const source = join(outputRoot, `${stem}.mmd`);
  const svg = join(outputRoot, `${stem}.svg`);
  const png = join(outputRoot, `${stem}.png`);
  writeFileSync(source, `${markdown.replace(/^```mermaid\n/, "").replace(/\n```$/, "").trimEnd()}\n`, "utf8");
  for (const output of [svg, png]) {
    const rendered = spawnSync(join(root, "node_modules/.bin/mmdc"), ["--input", source, "--output", output, "--quiet"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024
    });
    if (rendered.error || rendered.status !== 0) {
      throw new Error(`Mermaid render failed for ${stem}: ${rendered.error?.message || rendered.stderr.trim() || rendered.stdout.trim()}`);
    }
  }
  return {
    source: relative(root, source).replaceAll("\\", "/"),
    svg: relative(root, svg).replaceAll("\\", "/"),
    png: relative(root, png).replaceAll("\\", "/"),
    svgBytes: statSync(svg).size,
    pngBytes: statSync(png).size
  };
}

function walk(directory: string): string[] {
  return readdirSync(directory)
    .map((name) => join(directory, name))
    .flatMap((path) => statSync(path).isDirectory() ? walk(path) : [path])
    .filter((path) => /\.ya?ml$/.test(path))
    .sort();
}

function safeStem(value: string): string {
  return basename(value).replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function sortEvidence(values: ArchitectureSelectorEvidenceV1[]): ArchitectureSelectorEvidenceV1[] {
  return [...values].sort((left, right) => [left.nodeId, left.entrypointId, left.sourceSymbol, left.sinkId]
    .join("\0").localeCompare([right.nodeId, right.entrypointId, right.sourceSymbol, right.sinkId].join("\0")));
}

function parseArgs(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    out[key.slice(2).replace(/-([a-z])/g, (_, character: string) => character.toUpperCase())] = value;
    index += 1;
  }
  return out;
}
