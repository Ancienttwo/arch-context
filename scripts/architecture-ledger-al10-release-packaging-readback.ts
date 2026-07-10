#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { digestJson, type Json } from "@archcontext/contracts";
import { LOCAL_SQLITE_MIGRATIONS, SqliteLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import { buildNpmReleaseDryRunConfig, runNpmReleaseDryRun } from "./fg6-npm-release-dry-run";

const ROOT = resolve(import.meta.dir, "..");
const SCHEMA_VERSION = "archcontext.architecture-ledger-al10-release-packaging-readback/v1";
const DEFAULT_OUT = "docs/verification/architecture-ledger-al10-release-packaging-readback.json";
const DEFAULT_REPORT = "docs/verification/architecture-ledger-al10-release-packaging.md";
const DEFAULT_ARTIFACT_DIR = "_ops/npm/al10-release-packaging";
const GATES = ["AL10-10", "AL10-11"] as const;
const EXPLICITLY_OPEN = [
  "AL10-12",
  "AL10-13",
  "AL10-14",
  "AL10-15",
  "AL10-16",
  "AL10-GA-1",
  "AL10-GA-2",
  "AL10-GA-3",
  "AL10-GA-4",
  "AL10-GA-5",
  "AL10-GA-6",
  "AL10-GA-7"
] as const;

const REQUIRED_LEDGER_TABLES = [
  "schema_migrations",
  "architecture_events",
  "architecture_snapshots",
  "architecture_entities_current",
  "architecture_relations_current",
  "architecture_constraints_current",
  "architecture_ledger_operations",
  "architecture_ledger_fts",
  "architecture_ledger_search_fts"
] as const;

const MIGRATION_CASES = [
  { id: "fresh-empty", from: "empty local store", applyCount: 0 },
  { id: "pre-ledger-0005", from: "0005_external_docs_cache", applyCount: 5 },
  { id: "ledger-v1-0006", from: "0006_architecture_ledger", applyCount: 6 },
  { id: "pre-search-fts-0008", from: "0008_runtime_job_queue_hardening", applyCount: 8 },
  { id: "current-0011", from: "0011_changeset_cleanup_cursor", applyCount: LOCAL_SQLITE_MIGRATIONS.length }
] as const;

const BUNDLE_SIGNATURES = [
  {
    id: "migrations",
    description: "SQLite architecture ledger migrations and current tables",
    required: [
      "0006_architecture_ledger",
      "0009_architecture_ledger_search_fts",
      "architecture_events",
      "architecture_ledger_search_fts",
      "schema_migrations"
    ]
  },
  {
    id: "hooks",
    description: "hook enqueue/checkpoint contracts and fail-open output",
    required: [
      "hook.enqueue",
      "hook.checkpoint",
      "archcontext.hook-enqueue-fail-open/v1",
      "archcontext.hook-log/v1",
      "jobsEnqueueGitHook"
    ]
  },
  {
    id: "renderers",
    description: "architecture docs projection renderer and manifest contract",
    required: [
      "docs.drift",
      "render_projection",
      "archcontext.docs-projection-change-set/v1",
      "docs/architecture/.projection-manifest.json",
      "rendererVersion"
    ]
  },
  {
    id: "agent-adapter-contracts",
    description: "agent enqueue/status/budget contracts and runner-port validation",
    required: [
      "archcontext.investigate-enqueue/v1",
      "archcontext.agent-status/v1",
      "archcontext.agent-budget/v1",
      "runnerPort",
      "codex",
      "claude-code",
      "fake-provider"
    ]
  }
] as const;

if (import.meta.main) {
  const [command = "inspect", ...args] = process.argv.slice(2);
  if (!["run", "inspect"].includes(command)) {
    console.error("[architecture-ledger-al10-release-packaging-readback] usage: run|inspect [--out path] [--report path] [--evidence path] [--json]");
    process.exit(2);
  }
  const result = command === "run"
    ? await runArchitectureLedgerAl10ReleasePackagingReadback({
        outPath: readFlag(args, "--out") ?? DEFAULT_OUT,
        reportPath: readFlag(args, "--report") ?? DEFAULT_REPORT
      })
    : inspectArchitectureLedgerAl10ReleasePackagingReadback(
        JSON.parse(readFileSync(resolve(ROOT, readFlag(args, "--evidence") ?? DEFAULT_OUT), "utf8"))
      );
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else console.log(renderHuman(result));
  if (!result.ok) process.exit(1);
}

export async function runArchitectureLedgerAl10ReleasePackagingReadback({
  outPath = DEFAULT_OUT,
  reportPath = DEFAULT_REPORT
} = {}) {
  const packet = await buildArchitectureLedgerAl10ReleasePackagingPacket();
  const inspected = inspectArchitectureLedgerAl10ReleasePackagingReadback(packet);
  const finalPacket = {
    ...packet,
    status: inspected.ok ? "verified" : "failed",
    failures: inspected.failures
  };
  writeJson(outPath, finalPacket);
  writeText(reportPath, renderReport(finalPacket));
  return inspectArchitectureLedgerAl10ReleasePackagingReadback(finalPacket);
}

export async function buildArchitectureLedgerAl10ReleasePackagingPacket() {
  const migrationMatrix = await buildMigrationCompatibilityMatrix();
  const releasePackage = await inspectPackagedRelease();
  const assertions = {
    "AL10-10": migrationMatrix.every((item) => item.passed === true),
    "AL10-11": releasePackage.assertions.packagedCliIncludesRequiredFiles
      && releasePackage.assertions.bundleIncludesMigrations
      && releasePackage.assertions.bundleIncludesHooks
      && releasePackage.assertions.bundleIncludesRenderers
      && releasePackage.assertions.bundleIncludesAgentAdapterContracts,
    migrationMatrixCoversFreshAndIncremental: coversMigrationCases(migrationMatrix),
    currentMigrationIsLatest: migrationMatrix.every((item) => item.toLatestMigrationId === latestMigrationId()),
    sqliteIntegrityClean: migrationMatrix.every((item) => item.integrity === "ok"),
    releaseDryRunVerified: releasePackage.fg6.ok === true,
    nodeOnlyPackagedCli: releasePackage.assertions.nodeOnlyRuntime === true,
    packageContentsBounded: releasePackage.assertions.packageContentsBounded === true,
    noSourceFilesPackaged: releasePackage.assertions.noSourceFilesPackaged === true
  };
  const readbackDigest = digestJson({
    schemaVersion: SCHEMA_VERSION,
    migrationMatrix,
    releasePackage: {
      package: releasePackage.package,
      artifact: releasePackage.artifact,
      packageFiles: releasePackage.packageFiles,
      bundleSignatures: releasePackage.bundleSignatures
    },
    assertions
  } as unknown as Json);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    gates: [...GATES],
    status: "verified",
    scope: {
      repo: "release-packaging",
      authority: "local SQLite migration sequence plus FG6 one-package npm dry-run tarball",
      closedGates: [...GATES],
      explicitlyOpen: [...EXPLICITLY_OPEN]
    },
    supportedMigrationStates: MIGRATION_CASES.map(({ id, from, applyCount }) => ({ id, from, applyCount })),
    migrationIds: LOCAL_SQLITE_MIGRATIONS.map((migration) => migration.id),
    migrationMatrix,
    releasePackage,
    readbackDigest,
    assertions,
    readback: {
      command: `bun scripts/architecture-ledger-al10-release-packaging-readback.ts inspect --evidence ${DEFAULT_OUT} --json`,
      recordCommand: `bun scripts/architecture-ledger-al10-release-packaging-readback.ts run --out ${DEFAULT_OUT} --report ${DEFAULT_REPORT} --json`,
      reportPath: DEFAULT_REPORT
    },
    failures: [] as string[]
  };
}

export function inspectArchitectureLedgerAl10ReleasePackagingReadback(packet: any) {
  const failures: string[] = [];
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, status: "failed", failures: ["packet must be an object"], gates: {} };
  }
  if (packet.schemaVersion !== SCHEMA_VERSION) failures.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (packet.status !== undefined && packet.status !== "verified") failures.push("status must be verified");
  if (!sameStringSet(packet.gates, GATES)) failures.push("gates must be exactly AL10-10 and AL10-11");
  if (!sameStringSet(packet.scope?.closedGates, GATES)) failures.push("scope.closedGates must be exactly AL10-10 and AL10-11");
  if (!Array.isArray(packet.scope?.explicitlyOpen) || !packet.scope.explicitlyOpen.includes("AL10-12")) failures.push("scope.explicitlyOpen must keep AL10-12 open");
  if (!packet.readbackDigest || typeof packet.readbackDigest !== "string") failures.push("readbackDigest must be present");

  inspectMigrationMatrix(packet.migrationMatrix, failures);
  inspectReleasePackage(packet.releasePackage, failures);
  inspectAssertions(packet.assertions, failures);

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "verified" : "failed",
    failures,
    gates: Object.fromEntries(GATES.map((gate) => [gate, packet.assertions?.[gate] === true ? "verified" : "blocked"])),
    migrationCases: Array.isArray(packet.migrationMatrix) ? packet.migrationMatrix.length : 0,
    packageFileCount: Array.isArray(packet.releasePackage?.packageFiles) ? packet.releasePackage.packageFiles.length : 0,
    bundleSignatureGroups: Array.isArray(packet.releasePackage?.bundleSignatures) ? packet.releasePackage.bundleSignatures.length : 0
  };
}

async function buildMigrationCompatibilityMatrix() {
  const rows = [];
  for (const item of MIGRATION_CASES) rows.push(await inspectMigrationCase(item));
  return rows;
}

async function inspectMigrationCase(input: typeof MIGRATION_CASES[number]) {
  const tempDir = mkdtempSync(join(tmpdir(), "archctx-al10-migration-"));
  const databasePath = join(tempDir, "runtime.sqlite");
  try {
    await seedMigrationState(databasePath, input.applyCount);
    const before = inspectSqliteDatabase(databasePath);
    const store = new SqliteLocalStore(databasePath);
    await store.migrate();
    store.close();
    const after = inspectSqliteDatabase(databasePath);
    const missingTables = REQUIRED_LEDGER_TABLES.filter((table) => !after.tables.includes(table));
    const missingMigrations = LOCAL_SQLITE_MIGRATIONS.map((migration) => migration.id).filter((id) => !after.migrations.includes(id));
    return {
      id: input.id,
      from: input.from,
      fromAppliedCount: before.migrations.length,
      toAppliedCount: after.migrations.length,
      fromLatestMigrationId: before.migrations.at(-1) ?? null,
      toLatestMigrationId: after.migrations.at(-1) ?? null,
      fromHasLedgerTables: REQUIRED_LEDGER_TABLES.every((table) => before.tables.includes(table)),
      toHasLedgerTables: missingTables.length === 0,
      missingTables,
      missingMigrations,
      integrity: after.integrity,
      passed: after.integrity === "ok" && missingTables.length === 0 && missingMigrations.length === 0
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function seedMigrationState(databasePath: string, applyCount: number) {
  if (applyCount === 0) return;
  const db = new Database(databasePath);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    for (const migration of LOCAL_SQLITE_MIGRATIONS.slice(0, applyCount)) {
      for (const statement of migration.statements) db.exec(statement);
      db.query("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, new Date(0).toISOString());
    }
  } finally {
    db.close();
  }
}

function inspectSqliteDatabase(databasePath: string) {
  if (!existsSync(databasePath)) return { integrity: "missing", tables: [] as string[], migrations: [] as string[] };
  const db = new Database(databasePath);
  try {
    const integrityRow = db.query("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    const integrity = String(Object.values(integrityRow ?? {})[0] ?? "");
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as Record<string, unknown>[])
      .map((row) => String(row.name))
      .sort();
    const migrations = tables.includes("schema_migrations")
      ? (db.query("SELECT id FROM schema_migrations ORDER BY id ASC").all() as Record<string, unknown>[]).map((row) => String(row.id))
      : [];
    return { integrity, tables, migrations };
  } finally {
    db.close();
  }
}

async function inspectPackagedRelease() {
  mkdirSync(resolve(ROOT, DEFAULT_ARTIFACT_DIR), { recursive: true });
  const fg6 = await runNpmReleaseDryRun({
    ...buildNpmReleaseDryRunConfig(process.env, [
      "--root",
      ROOT,
      "--out",
      join(DEFAULT_ARTIFACT_DIR, "fg6-npm-release-dry-run.json"),
      "--artifact-dir",
      DEFAULT_ARTIFACT_DIR
    ]),
    generatedAt: () => new Date(0).toISOString()
  });
  const tarballPath = resolve(ROOT, DEFAULT_ARTIFACT_DIR, String((fg6 as any).artifact?.tarball ?? ""));
  const extractDir = mkdtempSync(join(tmpdir(), "archctx-al10-release-package-"));
  try {
    runCommand("tar", ["-xzf", tarballPath, "-C", extractDir], ROOT);
    const packageDir = join(extractDir, "package");
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as Record<string, unknown>;
    const binPath = join(packageDir, "bin", "archctx.mjs");
    const bin = readFileSync(binPath, "utf8");
    const packageFiles = ((fg6 as any).artifact?.files ?? []) as string[];
    const bundleSignatures = BUNDLE_SIGNATURES.map((group) => inspectBundleSignatureGroup(bin, group));
    const assertions = {
      packagedCliIncludesRequiredFiles: packageFiles.includes("bin/archctx.mjs")
        && packageFiles.includes("package.json")
        && !packageFiles.includes("bin/codegraph.mjs"),
      bundleIncludesMigrations: bundleGroupPassed(bundleSignatures, "migrations"),
      bundleIncludesHooks: bundleGroupPassed(bundleSignatures, "hooks"),
      bundleIncludesRenderers: bundleGroupPassed(bundleSignatures, "renderers"),
      bundleIncludesAgentAdapterContracts: bundleGroupPassed(bundleSignatures, "agent-adapter-contracts"),
      nodeOnlyRuntime: bin.startsWith("#!/usr/bin/env node\n")
        && !("packageManager" in manifest)
        && !("bun" in readRecord(manifest.engines)),
      packageContentsBounded: packageFiles.length > 0
        && !packageFiles.some((path) => path.includes("_ops") || path.includes(".git") || path.endsWith(".sqlite") || path.endsWith(".db")),
      noSourceFilesPackaged: !packageFiles.some((path) => path.includes("packages/") || path.includes("/src/") || path.endsWith(".ts"))
    };
    return {
      fg6: {
        ok: (fg6 as any).ok === true,
        schemaVersion: String((fg6 as any).schemaVersion ?? ""),
        taskId: String((fg6 as any).taskId ?? ""),
        status: String((fg6 as any).status ?? "")
      },
      package: {
        name: String(manifest.name ?? ""),
        version: String(manifest.version ?? ""),
        private: manifest.private === true,
        bin: readRecord(manifest.bin),
        engines: readRecord(manifest.engines),
        dependencies: readRecord(manifest.dependencies)
      },
      artifact: {
        artifactDir: DEFAULT_ARTIFACT_DIR,
        tarball: String((fg6 as any).artifact?.tarball ?? ""),
        tarballSha256: sha256File(tarballPath),
        tarballBytes: Number((fg6 as any).artifact?.size ?? 0),
        unpackedBytes: Number((fg6 as any).artifact?.unpackedSize ?? 0)
      },
      bin: {
        path: "bin/archctx.mjs",
        bytes: Buffer.byteLength(bin, "utf8"),
        sha256: sha256Text(bin),
        shebang: bin.split("\n", 1)[0] ?? ""
      },
      packageFiles,
      bundleSignatures,
      assertions
    };
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

function inspectBundleSignatureGroup(bin: string, group: typeof BUNDLE_SIGNATURES[number]) {
  const checks = group.required.map((value) => ({ value, present: bin.includes(value) }));
  return {
    id: group.id,
    description: group.description,
    requiredCount: group.required.length,
    presentCount: checks.filter((check) => check.present).length,
    missing: checks.filter((check) => !check.present).map((check) => check.value),
    passed: checks.every((check) => check.present)
  };
}

function inspectMigrationMatrix(matrix: any, failures: string[]): void {
  if (!Array.isArray(matrix)) {
    failures.push("migrationMatrix must be an array");
    return;
  }
  if (matrix.length !== MIGRATION_CASES.length) failures.push(`migrationMatrix must include ${MIGRATION_CASES.length} supported states`);
  for (const expected of MIGRATION_CASES) {
    const row = matrix.find((item: any) => item?.id === expected.id);
    if (!row) {
      failures.push(`migrationMatrix missing ${expected.id}`);
      continue;
    }
    if (row.passed !== true) failures.push(`${expected.id}: migration must pass`);
    if (row.integrity !== "ok") failures.push(`${expected.id}: integrity must be ok`);
    if (row.toLatestMigrationId !== latestMigrationId()) failures.push(`${expected.id}: latest migration mismatch`);
    if (row.toAppliedCount !== LOCAL_SQLITE_MIGRATIONS.length) failures.push(`${expected.id}: applied migration count mismatch`);
    if (Array.isArray(row.missingTables) && row.missingTables.length > 0) failures.push(`${expected.id}: missing tables ${row.missingTables.join(",")}`);
    if (Array.isArray(row.missingMigrations) && row.missingMigrations.length > 0) failures.push(`${expected.id}: missing migrations ${row.missingMigrations.join(",")}`);
  }
}

function inspectReleasePackage(releasePackage: any, failures: string[]): void {
  if (!releasePackage || typeof releasePackage !== "object" || Array.isArray(releasePackage)) {
    failures.push("releasePackage must be an object");
    return;
  }
  if (releasePackage.fg6?.ok !== true) failures.push("FG6 npm release dry-run must be ok");
  if (releasePackage.package?.name !== "archctx") failures.push("release package name must be archctx");
  if (releasePackage.package?.private !== false) failures.push("release package must be publishable");
  if (releasePackage.bin?.shebang !== "#!/usr/bin/env node") failures.push("packaged CLI must use node shebang");
  const packageFiles = Array.isArray(releasePackage.packageFiles) ? releasePackage.packageFiles : [];
  for (const file of ["bin/archctx.mjs", "package.json"]) {
    if (!packageFiles.includes(file)) failures.push(`package missing ${file}`);
  }
  const packageBin = readRecord(releasePackage.package?.bin);
  if (Object.keys(packageBin).length !== 1 || packageBin.archctx !== "./bin/archctx.mjs") {
    failures.push("release package bin must expose only archctx");
  }
  if (packageFiles.includes("bin/codegraph.mjs")) failures.push("package must not include bin/codegraph.mjs");
  if (packageFiles.some((path: string) => path.includes("packages/") || path.includes("/src/") || path.endsWith(".ts"))) {
    failures.push("package must not include workspace source files");
  }
  const groups = Array.isArray(releasePackage.bundleSignatures) ? releasePackage.bundleSignatures : [];
  for (const group of BUNDLE_SIGNATURES) {
    const actual = groups.find((item: any) => item?.id === group.id);
    if (!actual) failures.push(`bundle signature group missing: ${group.id}`);
    else if (actual.passed !== true) failures.push(`bundle signature group failed: ${group.id}: ${(actual.missing ?? []).join(",")}`);
  }
}

function inspectAssertions(assertions: Record<string, unknown> | undefined, failures: string[]): void {
  if (!assertions || typeof assertions !== "object") {
    failures.push("assertions must be present");
    return;
  }
  const allowed = new Set([
    ...GATES,
    "migrationMatrixCoversFreshAndIncremental",
    "currentMigrationIsLatest",
    "sqliteIntegrityClean",
    "releaseDryRunVerified",
    "nodeOnlyPackagedCli",
    "packageContentsBounded",
    "noSourceFilesPackaged"
  ]);
  for (const key of Object.keys(assertions)) {
    if (!allowed.has(key)) failures.push(`unexpected gate assertion: ${key}`);
  }
  for (const key of allowed) {
    if (assertions[key] !== true) failures.push(`assertions.${key} must be true`);
  }
}

function renderReport(packet: any): string {
  return [
    "# Architecture Ledger AL10 Release Packaging Readback",
    "",
    "## Scope",
    "",
    "- Closes: AL10-10 and AL10-11 only.",
    "- Keeps open: runbooks, telemetry, product interviews, governance, Go/No-Go and GA gates.",
    "- Authority: local SQLite migration sequence and FG6 one-package npm dry-run tarball.",
    "",
    "## Migration Compatibility Matrix",
    "",
    "| State | From applied | To applied | Latest migration | Integrity | Result |",
    "| --- | ---: | ---: | --- | --- | --- |",
    ...packet.migrationMatrix.map((row: any) => `| ${row.id} | ${row.fromAppliedCount} | ${row.toAppliedCount} | ${row.toLatestMigrationId} | ${row.integrity} | ${row.passed ? "pass" : "fail"} |`),
    "",
    "## Package Bundle",
    "",
    `- Package: ${packet.releasePackage.package.name}@${packet.releasePackage.package.version}`,
    `- Tarball: ${packet.releasePackage.artifact.tarball}`,
    `- Package files: ${packet.releasePackage.packageFiles.length}`,
    `- CLI bytes: ${packet.releasePackage.bin.bytes}`,
    `- CLI digest: ${packet.releasePackage.bin.sha256}`,
    "",
    "## Bundle Signatures",
    "",
    "| Group | Present | Required | Missing |",
    "| --- | ---: | ---: | --- |",
    ...packet.releasePackage.bundleSignatures.map((group: any) => `| ${group.id} | ${group.presentCount} | ${group.requiredCount} | ${group.missing.join(", ") || "-"} |`),
    "",
    "## Readback",
    "",
    "```bash",
    packet.readback.command,
    packet.readback.recordCommand,
    "```",
    ""
  ].join("\n");
}

function renderHuman(result: any): string {
  if (result.ok) return `[architecture-ledger-al10-release-packaging-readback] OK migrationCases=${result.migrationCases} packageFiles=${result.packageFileCount} bundleGroups=${result.bundleSignatureGroups}`;
  return `[architecture-ledger-al10-release-packaging-readback] FAILED\n${result.failures.map((failure: string) => `- ${failure}`).join("\n")}`;
}

function coversMigrationCases(matrix: Awaited<ReturnType<typeof buildMigrationCompatibilityMatrix>>): boolean {
  const ids = new Set(matrix.map((item) => item.id));
  return MIGRATION_CASES.every((item) => ids.has(item.id));
}

function bundleGroupPassed(groups: Array<{ id: string; passed: boolean }>, id: string): boolean {
  return groups.find((group) => group.id === id)?.passed === true;
}

function latestMigrationId(): string {
  return LOCAL_SQLITE_MIGRATIONS.at(-1)?.id ?? "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function runCommand(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? 1}): ${result.stderr || result.stdout}`);
}

function sha256File(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const resolved = resolve(ROOT, path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, value, "utf8");
}

function sameStringSet(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual)) return false;
  return [...new Set(actual)].sort().join(",") === [...expected].sort().join(",");
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
