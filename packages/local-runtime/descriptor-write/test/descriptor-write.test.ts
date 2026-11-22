import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson, FailureError, knownFailure } from "@archcontext/contracts";
import { setDescriptorRelativeWriteTestHook, writeFileWithoutFollowingSymlinks } from "../src/index";

describe("writeFileWithoutFollowingSymlinks", () => {
  const RELATIVE = ".archcontext/integrations/context7.lock.yaml";

  function tempWriteRoot(): { root: string; outside: string } {
    const base = mkdtempSync(join(tmpdir(), "archctx-nofollow-"));
    const root = join(base, "repo");
    const outside = join(base, "outside");
    mkdirSync(join(root, ".archcontext/integrations"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    return { root, outside };
  }

  function expectDescriptorPreimageRefusal(write: () => void): void {
    let refusal: unknown;
    try { write(); } catch (error) { refusal = error; }
    expect(refusal).toBeInstanceOf(FailureError);
    expect((refusal as FailureError).failure).toEqual(knownFailure("AC_PRECONDITION_FAILED", "apply-preimage-changed", { issueCount: 1 }));
    expect((refusal as Error).message).toContain("Expected hash mismatch");
  }

  function bodyHash(body: string): string {
    return digestJson({ body });
  }

  test("creates a private file and keeps the requested mode", () => {
    const { root } = tempWriteRoot();
    try {
      writeFileWithoutFollowingSymlinks({ root, path: RELATIVE, body: "{}\n", mode: 0o600, expectedHash: "missing" });

      expect(readFileSync(join(root, RELATIVE), "utf8")).toBe("{}\n");
      if (process.platform !== "win32") {
        expect(lstatSync(join(root, RELATIVE)).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("updates an existing file when the expected hash matches and rejects it when it does not", () => {
    const { root } = tempWriteRoot();
    try {
      writeFileWithoutFollowingSymlinks({ root, path: RELATIVE, body: "first\n", mode: 0o600, expectedHash: "missing" });
      writeFileWithoutFollowingSymlinks({ root, path: RELATIVE, body: "second\n", mode: 0o600, expectedHash: bodyHash("first\n") });
      expect(readFileSync(join(root, RELATIVE), "utf8")).toBe("second\n");

      expectDescriptorPreimageRefusal(() => writeFileWithoutFollowingSymlinks({
        root,
        path: RELATIVE,
        body: "third\n",
        mode: 0o600,
        expectedHash: bodyHash("first\n")
      }));
      expect(readFileSync(join(root, RELATIVE), "utf8")).toBe("second\n");

      expectDescriptorPreimageRefusal(() => writeFileWithoutFollowingSymlinks({
        root,
        path: RELATIVE,
        body: "third\n",
        mode: 0o600,
        expectedHash: "missing"
      }));
      expect(readFileSync(join(root, RELATIVE), "utf8")).toBe("second\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a symlinked destination and leaves the outside target byte-for-byte unchanged", () => {
    const { root, outside } = tempWriteRoot();
    try {
      const target = join(outside, "victim");
      writeFileSync(target, "do-not-touch\n", { encoding: "utf8", mode: 0o644 });
      const modeBefore = lstatSync(target).mode;
      symlinkSync(target, join(root, RELATIVE));

      expect(() => writeFileWithoutFollowingSymlinks({
        root,
        path: RELATIVE,
        body: "{}\n",
        mode: 0o600,
        expectedHash: "missing"
      })).toThrow("symlink");

      expect(readFileSync(target, "utf8")).toBe("do-not-touch\n");
      expect(lstatSync(target).mode).toBe(modeBefore);
      expect(lstatSync(join(root, RELATIVE)).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a dangling symlinked destination instead of materializing its target", () => {
    const { root, outside } = tempWriteRoot();
    try {
      const target = join(outside, "not-created-yet");
      symlinkSync(target, join(root, RELATIVE));

      expect(() => writeFileWithoutFollowingSymlinks({
        root,
        path: RELATIVE,
        body: "{}\n",
        mode: 0o600,
        expectedHash: "missing"
      })).toThrow("symlink");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a symlinked parent component", () => {
    const { root, outside } = tempWriteRoot();
    try {
      rmSync(join(root, ".archcontext/integrations"), { recursive: true, force: true });
      symlinkSync(outside, join(root, ".archcontext/integrations"));

      expect(() => writeFileWithoutFollowingSymlinks({
        root,
        path: RELATIVE,
        body: "{}\n",
        mode: 0o600,
        expectedHash: "missing"
      })).toThrow("symlink");
      expect(existsSync(join(outside, "context7.lock.yaml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects concurrent parent replacement without touching the outside target", () => {
    const { root, outside } = tempWriteRoot();
    const integrations = join(root, ".archcontext/integrations");
    const displaced = join(root, ".archcontext/integrations-displaced");
    const outsideTarget = join(outside, "context7.lock.yaml");
    writeFileSync(outsideTarget, "do-not-touch\n");
    setDescriptorRelativeWriteTestHook(() => {
      renameSync(integrations, displaced);
      symlinkSync(outside, integrations);
    });
    try {
      expect(() => writeFileWithoutFollowingSymlinks({
        root,
        path: RELATIVE,
        body: "redirected\n",
        mode: 0o600,
        expectedHash: "missing"
      })).toThrow();
      expect(readFileSync(outsideTarget, "utf8")).toBe("do-not-touch\n");
      if (process.platform !== "win32") expect(existsSync(join(displaced, "context7.lock.yaml"))).toBe(false);
    } finally {
      setDescriptorRelativeWriteTestHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a create-only write never replaces a file that appears after the missing-check", () => {
    const { root } = tempWriteRoot();
    const destination = join(root, RELATIVE);
    setDescriptorRelativeWriteTestHook(() => {
      writeFileSync(destination, "concurrent writer\n", "utf8");
    });
    try {
      expectDescriptorPreimageRefusal(() => writeFileWithoutFollowingSymlinks({
        root,
        path: RELATIVE,
        body: "late create\n",
        expectedHash: "missing"
      }));
      expect(readFileSync(destination, "utf8")).toBe("concurrent writer\n");
    } finally {
      setDescriptorRelativeWriteTestHook(undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a path that escapes the repository root", () => {
    const { root, outside } = tempWriteRoot();
    try {
      expect(() => writeFileWithoutFollowingSymlinks({
        root,
        path: "../outside/escaped.yaml",
        body: "{}\n",
        mode: 0o600,
        expectedHash: "missing"
      })).toThrow("escapes repository");
      expect(existsSync(join(outside, "escaped.yaml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("leaves no partial file behind when the write is rejected", () => {
    const { root } = tempWriteRoot();
    try {
      expect(() => writeFileWithoutFollowingSymlinks({
        root,
        path: RELATIVE,
        body: "{}\n",
        mode: 0o600,
        expectedHash: bodyHash("never-written\n")
      })).toThrow();
      expect(readdirSync(join(root, ".archcontext/integrations"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
