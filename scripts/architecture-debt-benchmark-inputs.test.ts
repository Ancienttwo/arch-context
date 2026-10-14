import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchmarkByteWitness } from "./architecture-debt-benchmark-inputs";

test("benchmark witness detects new ignored/untracked repo files and empty directories", () => {
  const root = mkdtempSync(join(tmpdir(), "d5-witness-"));
  const repo = join(root, "repo"); const state = join(root, "state");
  mkdirSync(repo); mkdirSync(state); writeFileSync(join(repo, ".gitignore"), "ignored/\n");
  try {
    const original = benchmarkByteWitness(repo, state);
    mkdirSync(join(repo, "ignored")); writeFileSync(join(repo, "ignored", "unexpected"), "new");
    expect(benchmarkByteWitness(repo, state)).not.toBe(original);
    rmSync(join(repo, "ignored"), { recursive: true });
    expect(benchmarkByteWitness(repo, state)).toBe(original);
    mkdirSync(join(repo, "unexpected-empty"));
    expect(benchmarkByteWitness(repo, state)).not.toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("benchmark witness detects changes and additions inside existing nested runtime state", () => {
  const root = mkdtempSync(join(tmpdir(), "d5-witness-state-"));
  const repo = join(root, "repo"); const state = join(root, "state");
  mkdirSync(repo); mkdirSync(join(state, "nested"), { recursive: true });
  writeFileSync(join(state, "nested", "existing"), "preserve");
  try {
    const original = benchmarkByteWitness(repo, state);
    writeFileSync(join(state, "nested", "existing"), "changed");
    expect(benchmarkByteWitness(repo, state)).not.toBe(original);
    writeFileSync(join(state, "nested", "existing"), "preserve");
    expect(benchmarkByteWitness(repo, state)).toBe(original);
    writeFileSync(join(state, "nested", "new"), "unexpected");
    expect(benchmarkByteWitness(repo, state)).not.toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

