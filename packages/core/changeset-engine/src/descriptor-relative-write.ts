import { chmodSync, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { digestJson } from "@archcontext/contracts";
import koffi from "koffi";

export interface DescriptorRelativeWriteRequest {
  root: string;
  path: string;
  body: string;
  mode?: number;
  expectedHash: string;
  tempName: string;
}

let beforeCommitTestHook: (() => void) | undefined;

/** @internal Deterministic synchronization seam for the no-follow adversarial regression test. */
export function setDescriptorRelativeWriteTestHook(hook: (() => void) | undefined): void {
  beforeCommitTestHook = hook;
}

interface PosixFlags {
  readonly create: number;
  readonly directory: number;
  readonly exclusive: number;
  readonly closeOnExec: number;
  readonly noFollow: number;
  readonly readOnly: number;
  readonly writeOnly: number;
}

const POSIX_FLAGS: Record<"darwin" | "linux", PosixFlags> = {
  darwin: {
    create: 0x0200,
    directory: 0x100000,
    exclusive: 0x0800,
    closeOnExec: 0x1000000,
    noFollow: 0x0100,
    readOnly: 0,
    writeOnly: 1
  },
  linux: {
    create: 0x0040,
    directory: 0x10000,
    exclusive: 0x0080,
    closeOnExec: 0x80000,
    noFollow: 0x20000,
    readOnly: 0,
    writeOnly: 1
  }
};

export function descriptorRelativeWrite(request: DescriptorRelativeWriteRequest): void {
  if (process.platform === "win32") {
    writeWithLockedWindowsParents(request);
    return;
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error(`Descriptor-relative writes are unsupported on ${process.platform}`);
  }
  writeWithPosixDirectoryDescriptor(request, POSIX_FLAGS[process.platform]);
}

function writeWithPosixDirectoryDescriptor(
  request: DescriptorRelativeWriteRequest,
  flags: PosixFlags
): void {
  const libc = koffi.load(null);
  const open = libc.func("open", "int", ["str", "int"]);
  const openat = libc.func("openat", "int", ["int", "str", "int", "uint"]);
  const mkdirat = libc.func("mkdirat", "int", ["int", "str", "uint"]);
  const read = libc.func("read", "int64", ["int", "void *", "uint64"]);
  const write = libc.func("write", "int64", ["int", "void *", "uint64"]);
  const fchmod = libc.func("fchmod", "int", ["int", "uint"]);
  const fsync = libc.func("fsync", "int", ["int"]);
  const renameat = libc.func("renameat", "int", ["int", "str", "int", "str"]);
  const unlinkat = libc.func("unlinkat", "int", ["int", "str", "int"]);
  const close = libc.func("close", "int", ["int"]);
  const errno = koffi.os.errno;
  const segments = request.path.split(/[\\/]/u);
  const leaf = segments.pop();
  if (!leaf || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid descriptor-relative path: ${request.path}`);
  }

  let directoryFd = checkedFd(open(resolve(request.root), flags.readOnly | flags.directory | flags.closeOnExec), "open trusted root");
  let tempCreated = false;
  try {
    for (const segment of segments) {
      let nextFd = openat(directoryFd, segment, flags.readOnly | flags.directory | flags.noFollow | flags.closeOnExec, 0);
      if (nextFd < 0 && koffi.errno() === errno.ENOENT) {
        checkedResult(mkdirat(directoryFd, segment, 0o777), `mkdirat ${segment}`);
        nextFd = openat(directoryFd, segment, flags.readOnly | flags.directory | flags.noFollow | flags.closeOnExec, 0);
      }
      nextFd = checkedFd(nextFd, `openat directory ${segment}`);
      checkedResult(close(directoryFd), "close parent directory");
      directoryFd = nextFd;
    }

    assertExpectedHashAt(directoryFd, leaf, request.expectedHash, flags, openat, read, close);
    const pinnedParent = fstatSync(directoryFd);
    beforeCommitTestHook?.();
    assertPinnedParentVisible(request, pinnedParent);

    const tempFd = checkedFd(
      openat(
        directoryFd,
        request.tempName,
        flags.writeOnly | flags.create | flags.exclusive | flags.noFollow | flags.closeOnExec,
        request.mode ?? 0o666
      ),
      `create temp ${request.tempName}`
    );
    tempCreated = true;
    try {
      writeAll(tempFd, Buffer.from(request.body, "utf8"), write);
      if (request.mode !== undefined) checkedResult(fchmod(tempFd, request.mode), `fchmod ${request.tempName}`);
      checkedResult(fsync(tempFd), `fsync ${request.tempName}`);
    } finally {
      checkedResult(close(tempFd), `close ${request.tempName}`);
    }

    checkedResult(renameat(directoryFd, request.tempName, directoryFd, leaf), `renameat ${leaf}`);
    tempCreated = false;
    checkedResult(fsync(directoryFd), `fsync parent for ${leaf}`);

    assertPinnedParentVisible(request, pinnedParent);
  } finally {
    if (tempCreated) unlinkat(directoryFd, request.tempName, 0);
    checkedResult(close(directoryFd), "close destination directory");
    libc.unload();
  }
}

function assertPinnedParentVisible(
  request: DescriptorRelativeWriteRequest,
  pinnedParent: { dev: number | bigint; ino: number | bigint }
): void {
  const visibleParent = statSync(dirname(join(resolve(request.root), request.path)));
  if (visibleParent.dev !== pinnedParent.dev || visibleParent.ino !== pinnedParent.ino) {
    throw new Error(`Refusing write because parent changed during write: ${request.path}`);
  }
}

function assertExpectedHashAt(
  directoryFd: number,
  leaf: string,
  expectedHash: string,
  flags: PosixFlags,
  openat: (...args: unknown[]) => number,
  read: (...args: unknown[]) => number | bigint,
  close: (...args: unknown[]) => number
): void {
  const fd = openat(directoryFd, leaf, flags.readOnly | flags.noFollow | flags.closeOnExec, 0);
  if (fd < 0) {
    if (koffi.errno() === koffi.os.errno.ENOENT && expectedHash === "missing") return;
    if (koffi.errno() === koffi.os.errno.ENOENT) throw new Error(`Expected missing file hash for new path: ${leaf}`);
    throw posixError(`openat destination ${leaf}`);
  }
  try {
    const actual = digestJson({ body: readUtf8(fd, read) });
    if (expectedHash !== actual) throw new Error(`Expected hash mismatch: ${leaf}`);
  } finally {
    checkedResult(close(fd), `close destination ${leaf}`);
  }
}

function readUtf8(fd: number, read: (...args: unknown[]) => number | bigint): string {
  const chunks: Buffer[] = [];
  for (;;) {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const count = Number(read(fd, chunk, chunk.byteLength));
    if (count < 0) throw posixError("read destination");
    if (count === 0) return Buffer.concat(chunks).toString("utf8");
    chunks.push(chunk.subarray(0, count));
  }
}

function writeAll(fd: number, body: Buffer, write: (...args: unknown[]) => number | bigint): void {
  let offset = 0;
  while (offset < body.byteLength) {
    const count = Number(write(fd, body.subarray(offset), body.byteLength - offset));
    if (count <= 0) throw posixError("write temp file");
    offset += count;
  }
}

function checkedFd(fd: number, action: string): number {
  if (fd < 0) throw posixError(action);
  return fd;
}

function checkedResult(result: number, action: string): void {
  if (result < 0) throw posixError(action);
}

function posixError(action: string): Error {
  return new Error(`${action} failed with errno ${koffi.errno()}`);
}

function writeWithLockedWindowsParents(request: DescriptorRelativeWriteRequest): void {
  const kernel32 = koffi.load("kernel32.dll");
  const createFileW = kernel32.func("CreateFileW", "void *", ["str16", "uint32", "uint32", "void *", "uint32", "uint32", "void *"]);
  const closeHandle = kernel32.func("CloseHandle", "int", ["void *"]);
  const attributeTagInfo = koffi.struct({ FileAttributes: "uint32", ReparseTag: "uint32" });
  const getFileInformationByHandleEx = kernel32.func("GetFileInformationByHandleEx", "int", [
    "void *",
    "int",
    koffi.out(koffi.pointer(attributeTagInfo)),
    "uint32"
  ]);
  const handles: unknown[] = [];
  const FILE_READ_ATTRIBUTES = 0x0080;
  const FILE_SHARE_READ_WRITE = 0x00000003;
  const OPEN_EXISTING = 3;
  const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
  const FILE_ATTRIBUTE_DIRECTORY = 0x0010;
  const FILE_ATTRIBUTE_REPARSE_POINT = 0x0400;
  const FILE_ATTRIBUTE_TAG_INFO = 9;

  try {
    const segments = request.path.split(/[\\/]/u);
    segments.pop();
    let current = resolve(request.root);
    for (let index = 0; index <= segments.length; index += 1) {
      if (index > 0) {
        current = join(current, segments[index - 1]!);
        try {
          mkdirSync(current);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const handle = createFileW(
        current,
        FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ_WRITE,
        null,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | (index === 0 ? 0 : FILE_FLAG_OPEN_REPARSE_POINT),
        null
      );
      if (koffi.address(handle) === 0xffffffffffffffffn) throw new Error(`CreateFileW failed for protected parent: ${current}`);
      handles.push(handle);
      const info: { FileAttributes?: number; ReparseTag?: number } = {};
      if (!getFileInformationByHandleEx(handle, FILE_ATTRIBUTE_TAG_INFO, info, koffi.sizeof(attributeTagInfo))) {
        throw new Error(`GetFileInformationByHandleEx failed for protected parent: ${current}`);
      }
      if (!(info.FileAttributes! & FILE_ATTRIBUTE_DIRECTORY) || (index > 0 && (info.FileAttributes! & FILE_ATTRIBUTE_REPARSE_POINT))) {
        throw new Error(`Refusing to write through reparse-point parent: ${request.path}`);
      }
    }
    beforeCommitTestHook?.();
    windowsAtomicPathWrite(request);
  } finally {
    for (const handle of handles.reverse()) closeHandle(handle);
    kernel32.unload();
  }
}

function windowsAtomicPathWrite(request: DescriptorRelativeWriteRequest): void {
  const absolute = join(resolve(request.root), request.path);
  if (request.expectedHash === "missing") {
    try {
      readFileSync(absolute);
      throw new Error(`Expected hash mismatch: ${request.path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } else {
    const actual = digestJson({ body: readFileSync(absolute, "utf8") });
    if (actual !== request.expectedHash) throw new Error(`Expected hash mismatch: ${request.path}`);
  }
  mkdirSync(dirname(absolute), { recursive: true });
  const temp = join(dirname(absolute), request.tempName);
  try {
    writeFileSync(temp, request.body, request.mode === undefined ? { encoding: "utf8", flag: "wx" } : { encoding: "utf8", mode: request.mode, flag: "wx" });
    if (request.mode !== undefined) chmodSync(temp, request.mode);
    const fd = openSync(temp, "r+");
    try {
      try { fsyncSync(fd); } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EINVAL") throw error;
      }
    } finally {
      closeSync(fd);
    }
    renameSync(temp, absolute);
  } finally {
    rmSync(temp, { force: true });
  }
}
