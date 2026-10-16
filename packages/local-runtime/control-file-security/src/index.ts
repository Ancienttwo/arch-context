import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const WINDOWS_CREATE_TIMEOUT_MS = 60_000;
// A native read child is killed at this deadline, which also closes its handle.
const WINDOWS_READ_TIMEOUT_MS = 10_000;
// Time for the killed reader to release its handle after its deadline.
const REMOVE_HANDLE_RELEASE_MARGIN_MS = 2_000;
const REMOVE_RETRY_DELAY_MS = 25;

// Progress markers the native child writes to stderr as it passes each step. A failed or timed-out
// child reports the last marker it reached; "none" means the script never started running.
const WINDOWS_CONTROL_FILE_PHASES = ["script", "input", "parsed", "opened", "verified", "done"];
const WINDOWS_CONTROL_FILE_PHASE_MARKER = /^archctx-acl-phase:([a-z]+)\r?$/;

// Windows PowerShell 5.1 supplies the .NET Framework FileStream(FileSecurity) constructor.
// Paths and file contents travel over stdin, never in executable command text or arguments.
const WINDOWS_CONTROL_FILE_SCRIPT = String.raw`
[Console]::Error.WriteLine('archctx-acl-phase:script')
$ErrorActionPreference = 'Stop'
# A pwsh -> Node/Bun -> powershell.exe launch inherits incompatible PS7 module paths.
$env:PSModulePath = "$PSHOME\Modules"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$stream = $null
$created = $false
function Test-PrivateAcl($stream, $sid) {
  $acl = $stream.GetAccessControl()
  $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($owner.Value -ne $sid.Value -or -not $acl.AreAccessRulesProtected -or $rules.Count -ne 1) { return $false }
  $rule = $rules[0]
  return ($rule.IdentityReference.Value -eq $sid.Value -and
    $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
    $rule.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl -and
    -not $rule.IsInherited -and
    $rule.InheritanceFlags -eq [System.Security.AccessControl.InheritanceFlags]::None -and
    $rule.PropagationFlags -eq [System.Security.AccessControl.PropagationFlags]::None)
}
try {
  $text = [Console]::In.ReadToEnd()
  [Console]::Error.WriteLine('archctx-acl-phase:input')
  $request = $text | ConvertFrom-Json
  [Console]::Error.WriteLine('archctx-acl-phase:parsed')
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($request.operation -eq 'create') {
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
    $stream = New-Object System.IO.FileStream($request.path, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::None, $acl)
    $created = $true
    [Console]::Error.WriteLine('archctx-acl-phase:opened')
    if (-not (Test-PrivateAcl $stream $sid)) { throw 'private ACL readback failed' }
    [Console]::Error.WriteLine('archctx-acl-phase:verified')
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$request.body)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
    [Console]::Error.WriteLine('archctx-acl-phase:done')
    $result = @{ ok = $true }
  } elseif ($request.operation -eq 'read') {
    # Deny concurrent write/delete, validate the opened file, then read that same handle.
    $stream = New-Object System.IO.FileStream($request.path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    [Console]::Error.WriteLine('archctx-acl-phase:opened')
    if (-not (Test-PrivateAcl $stream $sid)) { throw 'private ACL readback failed' }
    [Console]::Error.WriteLine('archctx-acl-phase:verified')
    if ($stream.Length -gt 1048576) { throw 'control file exceeds read budget' }
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true, 4096, $true)
    try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
    [Console]::Error.WriteLine('archctx-acl-phase:done')
    $result = @{ ok = $true; body = $body }
  } else { throw 'unsupported operation' }
  [Console]::Out.Write(($result | ConvertTo-Json -Compress))
} catch {
  $exception = $_.Exception
  while ($null -ne $exception.InnerException) { $exception = $exception.InnerException }
  $nativeCode = $exception.HResult -band 65535
  $code = if ($request.operation -eq 'create' -and ($nativeCode -eq 80 -or $nativeCode -eq 183)) { 'EEXIST' } else { 'EACCES' }
  if ($null -ne $stream) { $stream.Dispose(); $stream = $null }
  if ($created) { [System.IO.File]::Delete($request.path) }
  [Console]::Out.Write((@{ ok = $false; code = $code } | ConvertTo-Json -Compress))
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
}
`;

function windowsControlFile(operation: "create" | "read", path: string, body?: string): string | undefined {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error("Windows native ACL authority unavailable: SystemRoot is missing");
  let output: string;
  const startedAt = performance.now();
  try {
    output = execFileSync(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(WINDOWS_CONTROL_FILE_SCRIPT, "utf16le").toString("base64")
    ], {
      input: JSON.stringify({ operation, path, body }), encoding: "utf8", windowsHide: true,
      // The first powershell.exe launch on a fresh Windows runner is slow whatever the script
      // does: 323 hosted first creates had p95 12.2 s and max 24.8 s, and one exceeded 30 s.
      // Two daemon startup files fit within its existing 150 s startup budget; reads stay bounded.
      stdio: ["pipe", "pipe", "pipe"], timeout: operation === "create" ? WINDOWS_CREATE_TIMEOUT_MS : WINDOWS_READ_TIMEOUT_MS, maxBuffer: 1024 * 1024
    });
  } catch (error) {
    // Select scalar metadata only. Never retain cause, command, path, input, stdout or stderr text:
    // the phase is one allow-listed marker name, never a copied stderr line.
    const failure = error as { code?: unknown; status?: unknown; signal?: unknown; stderr?: unknown } | null;
    const code = ["ETIMEDOUT", "ENOENT", "EACCES", "EPERM", "ENOBUFS"].includes(String(failure?.code))
      ? String(failure?.code) : "UNKNOWN";
    const signal = ["SIGTERM", "SIGKILL", "SIGABRT", "SIGINT"].includes(String(failure?.signal))
      ? String(failure?.signal) : null;
    const status = typeof failure?.status === "number" && Number.isInteger(failure.status) ? failure.status : null;
    const phase = lastWindowsControlFilePhase(failure?.stderr);
    const elapsedMs = Math.round(performance.now() - startedAt);
    throw new Error(`Windows native ACL operation failed: ${JSON.stringify({ operation, code, status, signal, phase, elapsedMs })}`);
  }
  const result: unknown = JSON.parse(output);
  if (!result || typeof result !== "object" || !("ok" in result)) throw new Error("Invalid native ACL result");
  if (result.ok !== true) {
    const code = "code" in result && result.code === "EEXIST" ? "EEXIST" : "EACCES";
    throw Object.assign(new Error(`Private control-file ${operation} refused`), { code });
  }
  if (operation === "read") {
    if (!("body" in result) || typeof result.body !== "string") throw new Error("Invalid native ACL read result");
    return result.body;
  }
}

function lastWindowsControlFilePhase(stderr: unknown): string {
  let phase = "none";
  if (typeof stderr !== "string") return phase;
  for (const line of stderr.split("\n")) {
    const name = WINDOWS_CONTROL_FILE_PHASE_MARKER.exec(line)?.[1];
    if (name && WINDOWS_CONTROL_FILE_PHASES.includes(name)) phase = name;
  }
  return phase;
}

/** Exclusive creation: Windows DACL is private from the first observable instant. */
export function createPrivateControlFile(path: string, body: string): void {
  if (process.platform === "win32") {
    windowsControlFile("create", path, body);
    return;
  }
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, body, "utf8");
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  } finally {
    closeSync(fd);
  }
}

/** A missing, unreadable or non-private file supplies no usable credential. */
export function readPrivateControlFile(path: string): string | undefined {
  try {
    if (process.platform === "win32") {
      // Absence can only deny a read; existing files still require same-handle native ACL proof.
      if (!existsSync(path)) return undefined;
      return windowsControlFile("read", path);
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined;
      return readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/**
 * Removes a control file. On Windows a concurrent private read holds its handle with delete
 * sharing denied, so the unlink fails until that reader closes. The reader's child process ends
 * by its own deadline, so a sharing failure is retried until then. Other errors are not retried.
 */
export async function removePrivateControlFile(path: string): Promise<void> {
  const deadline = Date.now() + WINDOWS_READ_TIMEOUT_MS + REMOVE_HANDLE_RELEASE_MARGIN_MS;
  for (;;) {
    try {
      rmSync(path, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const sharingFailure = process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "EACCES");
      if (!sharingFailure || Date.now() >= deadline) throw error;
    }
    await sleep(REMOVE_RETRY_DELAY_MS);
  }
}
