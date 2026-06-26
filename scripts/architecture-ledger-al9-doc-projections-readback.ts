#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  digestJson,
  type Json
} from "@archcontext/contracts";
import {
  loadArchitectureDocumentationInputs,
  renderArchitectureDocumentationProjection
} from "@archcontext/surfaces/renderer";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_OUT = "docs/verification/architecture-ledger-al9-doc-projections-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al9-doc-projections.md";
const CLI = resolve(REPO_ROOT, "packages/surfaces/cli/src/main.ts");

const command = process.argv[2] ?? "inspect";
const out = readFlag("--out") ?? DEFAULT_OUT;
const report = readFlag("--report") ?? DEFAULT_REPORT;
const evidence = readFlag("--evidence") ?? out;
const json = process.argv.includes("--json");

if (import.meta.main) {
  const result = command === "run"
    ? await runArchitectureLedgerAl9DocProjectionsReadback({ out, report })
    : inspectArchitectureLedgerAl9DocProjectionsReadback(JSON.parse(readFileSync(resolve(REPO_ROOT, evidence), "utf8")));
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl9DocProjectionsReadback({ out = DEFAULT_OUT, report = DEFAULT_REPORT } = {}) {
  const current = currentRepoProjectionReadback();
  const integration = runTempRepoProjectionReadback();
  const packet = {
    schemaVersion: "archcontext.architecture-ledger-al9-doc-projections-readback/v1",
    generatedAt: new Date(0).toISOString(),
    gates: ["AL9-01", "AL9-02", "AL9-03", "AL9-04", "AL9-05", "AL9-06", "AL9-07", "AL9-08", "AL9-11", "AL9-12", "AL9-13", "AL9-15"],
    current,
    integration,
    privacy: {
      rawSourcePersisted: forbiddenRawKeys(packetSafe({ current, integration })).length > 0,
      forbiddenKeys: forbiddenRawKeys(packetSafe({ current, integration }))
    },
    assertions: {
      "AL9-01": current.projectionTargetSchemaPresent,
      "AL9-02": current.repoProjectionManifestPresent && current.placementRuleCount >= 8,
      "AL9-03": current.docs.indexPresent && current.docs.entitySummaryPresent && current.docs.decisionIndexPresent && current.docs.changelogPresent,
      "AL9-04": current.docs.mermaidPresent && current.docs.structurizrPresent && current.docs.likec4Present,
      "AL9-05": integration.humanTextPreserved && integration.ambiguousOwnershipRejected,
      "AL9-06": current.projectionManifestTracksDigests,
      "AL9-07": integration.manualEditDetected && integration.orphanDetected && integration.missingDetected,
      "AL9-08": integration.changeSetPreviewAllowed && integration.changeSetApplySucceeded,
      "AL9-11": current.placementRuleScopes.includes("entity:*") && current.placementRuleScopes.includes("relation"),
      "AL9-12": integration.cleanReportsOrphan,
      "AL9-13": integration.cliCommands.every((entry) => entry.ok),
      "AL9-15": integration.deterministicProjectionDigest && integration.humanTextPreserved && integration.manualEditDetected
    }
  };
  const inspected = inspectArchitectureLedgerAl9DocProjectionsReadback(packet);
  const finalPacket = { ...packet, status: inspected.ok ? "verified" : "failed", failures: inspected.failures };
  writeJson(out, finalPacket);
  writeText(report, renderReport(inspected));
  return inspectArchitectureLedgerAl9DocProjectionsReadback(finalPacket);
}

export function inspectArchitectureLedgerAl9DocProjectionsReadback(packet: any) {
  const failures: string[] = [];
  if (packet?.schemaVersion !== "archcontext.architecture-ledger-al9-doc-projections-readback/v1") failures.push("schemaVersion mismatch");
  for (const gate of ["AL9-01", "AL9-02", "AL9-03", "AL9-04", "AL9-05", "AL9-06", "AL9-07", "AL9-08", "AL9-11", "AL9-12", "AL9-13", "AL9-15"]) {
    if (packet?.assertions?.[gate] !== true) failures.push(`${gate} assertion failed`);
  }
  if (packet?.current?.driftOk !== true) failures.push("current repo docs projection drift must be clean");
  if (packet?.integration?.postApplyDriftOk !== true) failures.push("temp repo docs projection drift must be clean after apply");
  if (packet?.privacy?.rawSourcePersisted === true) failures.push(`privacy forbidden keys present: ${packet.privacy.forbiddenKeys?.join(",")}`);
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    current: packet.current,
    integration: packet.integration,
    assertions: packet.assertions
  };
}

function currentRepoProjectionReadback() {
  const loaded = loadArchitectureDocumentationInputs(REPO_ROOT);
  const sourceDigest = projectionSourceDigest(loaded);
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    decisions: loaded.decisions,
    existingFiles: loaded.existingFiles,
    sourceDigest
  });
  const projectionManifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/architecture/.projection-manifest.json"), "utf8"));
  const targetManifest = JSON.parse(readFileSync(resolve(REPO_ROOT, ".archcontext/projections/targets.json"), "utf8"));
  const placementRuleScopes = (targetManifest.placementRules as any[]).map((rule) => {
    if (rule.scope?.kind === "entity") return `entity:${rule.scope.entityKind ?? "*"}`;
    return String(rule.scope?.kind ?? "unknown");
  });
  return {
    projectionTargetSchemaPresent: existsSync(resolve(REPO_ROOT, "schemas/runtime/projection-target.schema.json")),
    repoProjectionManifestPresent: targetManifest.schemaVersion === "archcontext.projection-target-manifest/v1",
    placementRuleCount: Array.isArray(targetManifest.placementRules) ? targetManifest.placementRules.length : 0,
    placementRuleScopes,
    driftOk: plan.drift.ok,
    driftReasonCodes: plan.drift.reasonCodes,
    projectionDigest: plan.projectionDigest,
    sourceDigest: plan.sourceDigest,
    projectionManifestTracksDigests:
      projectionManifest.schemaVersion === "archcontext.architecture-docs-projection-manifest/v1"
      && projectionManifest.sourceDigest === plan.sourceDigest
      && projectionManifest.projectionDigest === plan.projectionDigest
      && projectionManifest.targets.every((target: any) => typeof target.outputDigest === "string" && target.outputDigest.startsWith("sha256:")),
    docs: {
      indexPresent: existsSync(resolve(REPO_ROOT, "docs/architecture/index.md")),
      entitySummaryPresent: existsSync(resolve(REPO_ROOT, "docs/architecture/modules/capability-architecture-context.md")),
      decisionIndexPresent: existsSync(resolve(REPO_ROOT, "docs/architecture/decisions/index.md")),
      changelogPresent: existsSync(resolve(REPO_ROOT, "docs/architecture/changelog.md")),
      mermaidPresent: existsSync(resolve(REPO_ROOT, "docs/architecture/diagrams/architecture.mmd")),
      structurizrPresent: existsSync(resolve(REPO_ROOT, "docs/architecture/diagrams/architecture.structurizr.json")),
      likec4Present: existsSync(resolve(REPO_ROOT, "docs/architecture/diagrams/architecture.likec4"))
    }
  };
}

function runTempRepoProjectionReadback() {
  const root = mkdtempSync(join(tmpdir(), "archctx-al9-docs-"));
  const state = mkdtempSync(join(tmpdir(), "archctx-al9-docs-state-"));
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "archctx@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "ArchContext"], { cwd: root });
    writeFileSync(join(root, "README.md"), "# Docs Projection Test\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" });

    const env = { ...process.env, ARCHCONTEXT_STATE_DIR: state };
    const init = runCli(root, env, ["init", "--name", "Docs Projection Test"]);
    execFileSync("mkdir", ["-p", resolve(root, "docs/architecture")]);
    writeFileSync(resolve(root, "docs/architecture/index.md"), "# Architecture Index\n\nHuman note before generated region.\n", "utf8");
    const firstPlan = runCli(root, env, ["docs", "plan", "--id", "changeset.docs-projection-al9"]);
    const secondPlan = runCli(root, env, ["docs", "preview", "--id", "changeset.docs-projection-al9-preview"]);
    const beforeApplyDrift = runCli(root, env, ["docs", "drift"]);
    const apply = runCli(root, env, ["docs", "apply", "--approved", "--id", "changeset.docs-projection-al9"]);
    const afterApplyDrift = runCli(root, env, ["docs", "drift"]);
    const index = readFileSync(resolve(root, "docs/architecture/index.md"), "utf8");
    const editedIndex = index.replace("Architecture Context", "Manual Generated Region Edit");
    writeFileSync(resolve(root, "docs/architecture/index.md"), editedIndex, "utf8");
    const manualEditDrift = runCli(root, env, ["docs", "drift"]);
    writeFileSync(resolve(root, "docs/architecture/index.md"), index, "utf8");
    writeFileSync(resolve(root, "docs/architecture/modules/obsolete.md"), [
      "<!-- BEGIN ARCHCONTEXT:generated target=\"projection_target.entity.obsolete\" sourceDigest=\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\" rendererVersion=\"archcontext.docs-renderer/v1\" outputDigest=\"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\" -->",
      "# Obsolete",
      "<!-- END ARCHCONTEXT:generated target=\"projection_target.entity.obsolete\" -->",
      ""
    ].join("\n"), "utf8");
    const clean = runCli(root, env, ["docs", "clean"]);

    return {
      initOk: init.ok === true,
      deterministicProjectionDigest: firstPlan.data?.projectionDigest === secondPlan.data?.projectionDigest,
      missingDetected: beforeApplyDrift.data?.drift?.reasonCodes?.includes("projection-file-missing") === true,
      changeSetPreviewAllowed: firstPlan.data?.preview?.allowed === true,
      changeSetApplySucceeded: apply.ok === true && apply.data?.status === "applied",
      postApplyDriftOk: afterApplyDrift.data?.ok === true,
      humanTextPreserved: index.includes("Human note before generated region."),
      manualEditDetected: manualEditDrift.data?.drift?.reasonCodes?.includes("projection-generated-region-manually-edited") === true,
      orphanDetected: clean.data?.orphanedCount === 1,
      cleanReportsOrphan: clean.data?.action === "manual-review-required-before-tombstone",
      ambiguousOwnershipRejected: ambiguousOwnershipIsRejected(root),
      cliCommands: [
        { command: "docs plan", ok: firstPlan.ok === true },
        { command: "docs preview", ok: secondPlan.ok === true },
        { command: "docs apply", ok: apply.ok === true },
        { command: "docs drift", ok: afterApplyDrift.ok === true },
        { command: "docs clean", ok: clean.ok === true }
      ],
      targetCount: firstPlan.data?.targetCount,
      fileCount: firstPlan.data?.fileCount
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
}

function ambiguousOwnershipIsRejected(root: string): boolean {
  const loaded = loadArchitectureDocumentationInputs(root);
  const generatedDiagramPath = "docs/architecture/diagrams/architecture.mmd";
  const withoutMarker = loaded.existingFiles.map((file) =>
    file.path === generatedDiagramPath ? { ...file, body: "flowchart LR\n  A-->B\n" } : file
  );
  const plan = renderArchitectureDocumentationProjection({
    model: loaded.model,
    decisions: loaded.decisions,
    existingFiles: withoutMarker,
    sourceDigest: projectionSourceDigest(loaded)
  });
  return plan.rejected.some((diff) => diff.path === generatedDiagramPath && diff.reasonCode === "projection-ambiguous-ownership");
}

function runCli(root: string, env: NodeJS.ProcessEnv, args: string[]) {
  const stdout = execFileSync("bun", [CLI, ...args], { cwd: root, env, encoding: "utf8" });
  return JSON.parse(stdout);
}

function projectionSourceDigest(loaded: ReturnType<typeof loadArchitectureDocumentationInputs>): string {
  return digestJson({
    model: loaded.model,
    decisions: loaded.decisions.map((decision) => ({
      id: decision.id,
      path: decision.path,
      title: decision.title,
      status: decision.status
    }))
  } as unknown as Json);
}

function forbiddenRawKeys(value: Json): string[] {
  const forbidden = new Set(["sourceCode", "rawDiff", "prompt", "completion", "privateKey", "secret"]);
  const found = new Set<string>();
  const visit = (item: Json) => {
    if (item === null || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key)) found.add(key);
      visit(child);
    }
  };
  visit(value);
  return [...found].sort();
}

function packetSafe(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function writeJson(path: string, value: unknown) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, body: string) {
  const absolute = resolve(REPO_ROOT, path);
  execFileSync("mkdir", ["-p", dirname(absolute)]);
  writeFileSync(absolute, body, "utf8");
}

function readFlag(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function renderReport(result: ReturnType<typeof inspectArchitectureLedgerAl9DocProjectionsReadback>): string {
  return [
    "# AL9 Documentation Projection Readback",
    "",
    `Status: ${result.status}`,
    "",
    "## P1 Map",
    "",
    "Contracts define `ProjectionTarget/v1`; model-store YAML owns `.archcontext/projections/targets.json`; renderer produces docs/architecture Markdown and diagram projections; ChangeSet applies bounded `render_projection` files; CLI exposes `archctx docs plan|preview|apply|drift|clean`.",
    "",
    "## P2 Trace",
    "",
    "The traced path is `.archcontext/model` plus ADR files -> documentation projection source digest -> generated region targets -> ChangeSet preview/apply -> docs/architecture files -> drift readback.",
    "",
    "## P3 Decision",
    "",
    "Human-authored prose is outside generated markers and preserved. Generated-only diagram paths without ArchContext markers are rejected as ambiguous ownership. Drift separates missing, stale, manual edit and orphaned projections.",
    "",
    "## Verification",
    "",
    `- Current projection drift clean: ${result.current?.driftOk}`,
    `- Temp repo apply drift clean: ${result.integration?.postApplyDriftOk}`,
    `- Human text preserved: ${result.integration?.humanTextPreserved}`,
    `- CLI commands ok: ${result.integration?.cliCommands?.every((entry: any) => entry.ok)}`,
    "",
    result.failures.length === 0 ? "Failures: none" : `Failures:\n${result.failures.map((failure) => `- ${failure}`).join("\n")}`,
    ""
  ].join("\n");
}

function renderHuman(result: ReturnType<typeof inspectArchitectureLedgerAl9DocProjectionsReadback>): string {
  return `${JSON.stringify({ ok: result.ok, status: result.status, failures: result.failures }, null, 2)}\n`;
}
