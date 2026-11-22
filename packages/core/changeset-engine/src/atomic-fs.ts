import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { FailureError, digestJson } from "@archcontext/contracts";
import { assertAllowedArchContextPath, type ArchContextPathScope } from "@archcontext/core/policy-engine";

export function assertSafeTarget(root: string, path: string, scope?: ArchContextPathScope): void {
  assertAllowedArchContextPath(root, path, scope);
  const absolute = resolve(root, path);
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`Refusing to write symlink target: ${path}`);
  }
}

/**
 * Containment plus no-follow validation for a repository-relative path, returning its absolute form.
 *
 * Exported so readers of the same fail-closed files apply the identical rule: a path that is unsafe
 * to write is also unsafe to parse, because following it hands an attacker-chosen file to a parser
 * that was only ever meant to see repository state.
 */
export function assertPathHasNoSymlinkSegments(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, path);
  const contained = relative(absoluteRoot, absolute);
  if (contained === "" || contained === ".." || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    throw new Error(`Path escapes repository: ${path}`);
  }
  assertNoSymlinkSegments(absoluteRoot, contained.split(sep), path);
  return absolute;
}

/**
 * `lstat` every existing component, destination included. `existsSync` is deliberately not used to
 * decide whether a component is there: it follows links, so a dangling symlink would read as absent
 * and be silently accepted as a path to create.
 */
function assertNoSymlinkSegments(absoluteRoot: string, segments: string[], displayPath: string): void {
  let current = absoluteRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${displayPath}`);
  }
}

/** Keep the existing local preview diagnostic; public adapters publish only `.failure`. */
export function preimageFailure(diagnostic: string): FailureError<"AC_PRECONDITION_FAILED"> {
  const error = new FailureError("AC_PRECONDITION_FAILED", "apply-preimage-changed", { issueCount: 1 });
  error.message = diagnostic;
  return error;
}

export function assertExpectedHash(path: string, expectedHash: string): void {
  const actual = digestJson({ body: readFileSync(path, "utf8") });
  if (expectedHash !== actual) throw preimageFailure(`Expected hash mismatch: ${path}`);
}

export function atomicWriteFile(path: string, tempPath: string, body: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, body, mode === undefined ? "utf8" : { encoding: "utf8", mode, flag: "wx" });
  // The mode is forced on the temp name, which only this process can reach. Doing it on the
  // destination after the rename would leave a window where a swapped path receives the chmod.
  if (mode !== undefined) chmodSync(tempPath, mode);
  fsyncFile(tempPath);
  renameSync(tempPath, path);
  fsyncDirectory(dirname(path));
}

export function fsyncFile(path: string): void {
  const fd = openSync(path, process.platform === "win32" ? "r+" : "r");
  try {
    try {
      fsyncSync(fd);
    } catch (error) {
      if (!isIgnorableWindowsFsyncError(error)) throw error;
    }
  } finally {
    closeSync(fd);
  }
}

export function fsyncDirectory(path: string): void {
  try {
    const fd = openSync(path, "r");
    try {
      try {
        fsyncSync(fd);
      } catch (error) {
        if (!isIgnorableDirectoryFsyncError(error)) throw error;
      }
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (!isIgnorableDirectoryFsyncError(error)) throw error;
  }
}

function isIgnorableWindowsFsyncError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return process.platform === "win32" && (code === "EPERM" || code === "EINVAL");
}

function isIgnorableDirectoryFsyncError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "EINVAL" || code === "EISDIR" || (process.platform === "win32" && code === "EPERM");
}

export function rollback(backups: { path: string; backupPath: string; tempPath?: string; existed: boolean; manifestBodyHash?: string }[]): boolean {
  let complete = true;
  for (const backup of [...backups].reverse()) {
    // An await after the manifest write may let another writer raise its floor. Never erase
    // external bytes or unreadable replacements. A missing target can be restored from its backup.
    if (backup.manifestBodyHash !== undefined) {
      let current = "unreadable";
      try {
        const stat=lstatSync(backup.path);
        if(stat.isFile() && !stat.isSymbolicLink()) {
          const bytes=readFileSync(backup.path),body=bytes.toString("utf8");
          if(Buffer.from(body,"utf8").equals(bytes)) current=digestJson({body});
        }
      } catch(error) { if((error as NodeJS.ErrnoException).code === "ENOENT") current="missing"; }
      if (current !== "missing" && current !== backup.manifestBodyHash) { complete = false; continue; }
    }
    if (backup.tempPath) rmSync(backup.tempPath, { recursive: true, force: true });
    if (backup.existed) {
      if (existsSync(backup.backupPath)) {
        rmSync(backup.path, { recursive: true, force: true });
        renameSync(backup.backupPath, backup.path);
      }
    } else {
      rmSync(backup.path, { recursive: true, force: true });
    }
    fsyncDirectory(dirname(backup.path));
  }
  return complete;
}

export function cleanupBackups(backups: { backupPath: string; tempPath?: string }[]): void {
  for (const backup of backups) {
    if (backup.tempPath) rmSync(backup.tempPath, { recursive: true, force: true });
    rmSync(backup.backupPath, { recursive: true, force: true });
  }
}
