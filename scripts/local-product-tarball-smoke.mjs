#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  assert,
  createSmokeHarness,
  displayPath,
  localRuntimeManifest,
  parseArgs,
  releasePackageName,
  resolveArchctxBin,
  resolveCodeGraphBin,
  rootManifest,
  run,
  runArchctx,
  runOptional
} from "./local-product-tarball-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const PROCESS_TIMEOUT_MS = Number(args["timeout-ms"] ?? 30_000);
const harness = createSmokeHarness(PROCESS_TIMEOUT_MS);

try {
  const artifactDir = resolve(String(args["artifact-dir"] ?? harness.mkdtempTracked("archctx-local-product-artifact-")));
  mkdirSync(artifactDir, { recursive: true });
  const { tarballPath, stageDir } = await harness.buildLocalProductTarball(artifactDir);
  const installDir = await harness.installTarball(tarballPath);
  const binDir = join(installDir, "node_modules", ".bin");
  const archctxBin = resolveArchctxBin(binDir);
  assert(existsSync(archctxBin), `installed archctx bin missing: ${archctxBin}`);
  const codeGraphBin = resolveCodeGraphBin(binDir);
  assert(existsSync(codeGraphBin), `installed CodeGraph dependency bin missing: ${codeGraphBin}`);

  const repo = harness.createGitFixture();
  const stateRoot = harness.mkdtempTracked("archctx-local-product-state-");
  const env = harness.nodeOnlyRuntimeEnv(stateRoot, harness.mkdtempTracked("archctx-local-product-home-"));
  const bunProbe = await runOptional("bun", ["--version"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(bunProbe.code !== 0, "tarball smoke runtime PATH must not expose bun");
  const codeGraphProbe = await runOptional("codegraph", ["--version"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(codeGraphProbe.code !== 0, "tarball smoke runtime PATH must not expose codegraph");

  await run(codeGraphBin, ["init", repo], { cwd: repo, env }, PROCESS_TIMEOUT_MS);

  const doctor = await runArchctx(archctxBin, ["doctor"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(doctor.ok === true, "doctor must succeed from installed tarball");
  assert(doctor.data?.runtime?.mode === "in-process", "doctor must report in-process runtime mode");
  assert(doctor.data?.product?.product?.distribution === "one-package", "doctor must report one-package distribution");
  assert(doctor.data?.egress?.cloudContentUpload === "deny", "doctor must preserve local-only cloud content policy");

  const init = await runArchctx(archctxBin, ["init", "--name", "Tarball Smoke"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(init.ok === true, "init must succeed from installed tarball");

  const docsPin = await runArchctx(archctxBin, ["docs", "pin", "--library-id", "/facebook/react", "--version", "18.2.0", "--approved"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(docsPin.ok === true && docsPin.data?.approved === true, "installed Node-only runtime must execute descriptor-relative docs pin");
  const docsLockPath = join(repo, ".archcontext", "integrations", "context7.lock.yaml");
  assert(existsSync(docsLockPath), "descriptor-relative docs pin must create the Context7 lockfile");
  if (process.platform !== "win32") {
    assert((lstatSync(docsLockPath).mode & 0o777) === 0o600, "descriptor-relative docs pin must preserve the private mode contract");
  }

  const indexSeed = await runArchctx(archctxBin, ["index", "seed", "--json"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(indexSeed.ok === true && indexSeed.data?.schemaVersion === "archcontext.index-seed/v1", "index seed must succeed with installed codegraph dependency");

  const sync = await runArchctx(archctxBin, ["sync", "--changed", "src/index.ts"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(sync.ok === true && sync.data?.schemaVersion === "archcontext.sync/v2", "sync must return archcontext.sync/v2");
  assert(/^sha256:/.test(String(sync.data?.modelDigest)), "sync must return a model digest");

  const practiceValidation = await runArchctx(archctxBin, ["practices", "validate", "--strict"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(practiceValidation.ok === true, "practices validate must succeed from installed tarball");
  assert(practiceValidation.data?.valid === true, "installed practice catalog must validate");
  assert(Number(practiceValidation.data?.practiceCount ?? 0) >= 40, "installed practice catalog must include S6 built-in assets");
  assert(Number(practiceValidation.data?.sourceCount ?? 0) >= 19, "installed practice catalog must include source registry");

  const prepared = await runArchctx(archctxBin, ["prepare", "--task", "inspect tarball smoke", "--max-items", "2"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(prepared.ok === true, "prepare must succeed in-process");

  const pathsBeforeUpgrade = await runArchctx(archctxBin, ["paths"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(pathsBeforeUpgrade.ok === true, "paths must succeed before reinstall upgrade");
  assert(existsSync(pathsBeforeUpgrade.data?.localStorePath), "runtime state must exist before reinstall upgrade");

  await run("npm", ["install", "--no-audit", "--no-fund", tarballPath], { cwd: installDir, env: process.env }, PROCESS_TIMEOUT_MS);
  const upgradedBin = resolveArchctxBin(binDir);
  assert(existsSync(upgradedBin), "archctx bin must remain available after reinstall upgrade");
  const upgradedValidation = await runArchctx(upgradedBin, ["practices", "validate", "--strict"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(upgradedValidation.ok === true && upgradedValidation.data?.valid === true, "practice catalog must validate after reinstall upgrade");
  const pathsAfterUpgrade = await runArchctx(upgradedBin, ["paths"], { cwd: repo, env }, PROCESS_TIMEOUT_MS);
  assert(pathsAfterUpgrade.data?.localStorePath === pathsBeforeUpgrade.data?.localStorePath, "reinstall upgrade must retain runtime store path");

  await run("npm", ["uninstall", "--no-audit", "--no-fund", releasePackageName], { cwd: installDir, env: process.env }, PROCESS_TIMEOUT_MS);
  assert(!existsSync(upgradedBin), "archctx bin must be removed after uninstall");
  assert(existsSync(pathsBeforeUpgrade.data?.localStorePath), "uninstall must retain user runtime state outside package install dir");

  const evidence = {
    schemaVersion: "archcontext.local-product-tarball-smoke/v1",
    package: { name: releasePackageName, version: rootManifest.version, tarball: basename(tarballPath), stageDir: displayPath(stageDir) },
    install: { installer: "npm install <local-tarball>", installDir: displayPath(installDir), bin: displayPath(archctxBin) },
    runtime: {
      cli: true,
      mode: "in-process",
      descriptorRelativeWrite: true,
      codeGraph: {
        dependency: rootManifest.dependencies?.["@colbymchenry/codegraph"],
        bin: displayPath(codeGraphBin),
        source: "dependency-provided-local-bin",
        indexSeedMode: indexSeed.data?.mode,
        indexDigest: indexSeed.data?.indexDigest
      },
      practices: {
        validation: "strict",
        valid: practiceValidation.data?.valid,
        practiceCount: practiceValidation.data?.practiceCount,
        sourceCount: practiceValidation.data?.sourceCount,
        profileCount: practiceValidation.data?.profileCount,
        catalogDigest: practiceValidation.data?.catalogDigest
      }
    },
    product: {
      distribution: doctor.data?.product?.product?.distribution,
      version: doctor.data?.product?.product?.version,
      schemaSetVersion: doctor.data?.version?.schemaSetVersion
    },
    lifecycle: {
      install: "passed",
      upgrade: "reinstall-retained-state",
      uninstall: "package-removed-state-retained",
      retainedStore: displayPath(pathsBeforeUpgrade.data?.localStorePath),
      stateRoot: displayPath(stateRoot)
    }
  };
  if (args.out) {
    const outPath = resolve(String(args.out));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (!args["keep-temp"]) harness.cleanupAll();
}
