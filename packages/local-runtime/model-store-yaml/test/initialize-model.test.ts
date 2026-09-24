import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchContextInitRefusedError, initializeArchContextModel, rebuildGeneratedProjection } from "../src/index";

const INIT_FILES = [
  ".archcontext/manifest.yaml",
  ".archcontext/product.yaml",
  ".archcontext/model/nodes/capability.architecture-context.yaml",
  ".archcontext/policies/review.yaml",
  ".archcontext/projections/targets.json"
];

function tempRoots(): { base: string; root: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), "archctx-init-"));
  const root = join(base, "repo");
  const outside = join(base, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { base, root, outside };
}

function snapshot(root: string): Record<string, string | null> {
  return Object.fromEntries(INIT_FILES.map((path) => {
    const absolute = join(root, path);
    return [path, existsSync(absolute) ? readFileSync(absolute, "utf8") : null];
  }));
}

describe("initializeArchContextModel is create-only (#167)", () => {
  test("creates every initial model file on a fresh repository", () => {
    const { base, root } = tempRoots();
    try {
      initializeArchContextModel(root, "Fresh App");
      for (const path of INIT_FILES) expect(existsSync(join(root, path))).toBe(true);
      // Model files are ordinary repository files: readable and writable under the process umask.
      if (process.platform !== "win32") {
        const expectedMode = 0o666 & ~process.umask();
        for (const path of [...INIT_FILES, ".archcontext/generated/ARCHITECTURE.md"]) {
          expect(statSync(join(root, path)).mode & 0o777).toBe(expectedMode);
        }
      }
      expect(existsSync(join(root, ".archcontext/generated/ARCHITECTURE.md"))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("a second init refuses and leaves the existing model byte-identical", () => {
    const { base, root } = tempRoots();
    try {
      initializeArchContextModel(root, "First App");
      writeFileSync(join(root, ".archcontext/policies/review.yaml"), "schemaVersion: archcontext.policy/v1\nid: policy.review\nfailOn: [\"invalid-schema\"]\n", "utf8");
      const before = snapshot(root);

      expect(() => initializeArchContextModel(root, "Second App")).toThrow(ArchContextInitRefusedError);
      expect(snapshot(root)).toEqual(before);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("a partially initialized model is refused without completing or changing it", () => {
    const { base, root } = tempRoots();
    try {
      mkdirSync(join(root, ".archcontext"), { recursive: true });
      writeFileSync(join(root, ".archcontext/product.yaml"), "schemaVersion: archcontext.product/v1\nid: product.kept\n", "utf8");

      let refused: unknown;
      try {
        initializeArchContextModel(root, "Partial App");
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(ArchContextInitRefusedError);
      expect((refused as ArchContextInitRefusedError).existingPaths).toEqual([".archcontext/product.yaml"]);
      expect(readFileSync(join(root, ".archcontext/product.yaml"), "utf8")).toBe("schemaVersion: archcontext.product/v1\nid: product.kept\n");
      expect(existsSync(join(root, ".archcontext/manifest.yaml"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("a symlinked model file is refused and its target outside the repository is untouched", () => {
    const { base, root, outside } = tempRoots();
    try {
      const victim = join(outside, "victim.yaml");
      writeFileSync(victim, "do-not-touch\n", "utf8");
      mkdirSync(join(root, ".archcontext"), { recursive: true });
      symlinkSync(victim, join(root, ".archcontext/manifest.yaml"));

      expect(() => initializeArchContextModel(root, "Symlink App")).toThrow("symlink");
      expect(readFileSync(victim, "utf8")).toBe("do-not-touch\n");
      expect(existsSync(join(root, ".archcontext/product.yaml"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("a dangling symlinked model file is refused instead of materializing its target", () => {
    const { base, root, outside } = tempRoots();
    try {
      const target = join(outside, "not-created-yet.yaml");
      mkdirSync(join(root, ".archcontext"), { recursive: true });
      symlinkSync(target, join(root, ".archcontext/manifest.yaml"));

      expect(() => initializeArchContextModel(root, "Dangling App")).toThrow("symlink");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("a symlinked parent directory is refused and nothing is written through it", () => {
    const { base, root, outside } = tempRoots();
    try {
      mkdirSync(join(root, ".archcontext"), { recursive: true });
      symlinkSync(outside, join(root, ".archcontext/policies"));

      expect(() => initializeArchContextModel(root, "Parent Symlink App")).toThrow("symlink");
      expect(existsSync(join(outside, "review.yaml"))).toBe(false);
      expect(existsSync(join(root, ".archcontext/manifest.yaml"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("generated rebuild never follows a symlinked generated entry, and refuses a symlinked generated directory", () => {
    const { base, root, outside } = tempRoots();
    try {
      initializeArchContextModel(root, "Generated App");
      const victim = join(outside, "victim.md");
      writeFileSync(victim, "do-not-touch\n", "utf8");
      symlinkSync(victim, join(root, ".archcontext/generated/stale.md"));

      // Only regular files are generated output; a link is neither read, rewritten, nor followed.
      rebuildGeneratedProjection(root);
      expect(lstatSync(join(root, ".archcontext/generated/stale.md")).isSymbolicLink()).toBe(true);
      expect(readFileSync(victim, "utf8")).toBe("do-not-touch\n");

      rmSync(join(root, ".archcontext/generated"), { recursive: true, force: true });
      symlinkSync(outside, join(root, ".archcontext/generated"));
      expect(() => rebuildGeneratedProjection(root)).toThrow("symlink");
      expect(existsSync(join(outside, "ARCHITECTURE.md"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("a failure part-way removes the files that init created", () => {
    const { base, root } = tempRoots();
    try {
      // The last file's parent is a regular file, so its write fails after the others were created.
      mkdirSync(join(root, ".archcontext"), { recursive: true });
      writeFileSync(join(root, ".archcontext/projections"), "not a directory", "utf8");

      expect(() => initializeArchContextModel(root, "Rollback App")).toThrow();
      for (const path of INIT_FILES.slice(0, -1)) expect(existsSync(join(root, path))).toBe(false);
      expect(lstatSync(join(root, ".archcontext/projections")).isFile()).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
