import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Windows PowerShell 5.1 supplies the .NET Framework FileStream(FileSecurity) constructor.
// Paths and file contents travel over stdin, never in executable command text or arguments.
const WINDOWS_CONTROL_FILE_SCRIPT = String.raw`
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
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($request.operation -eq 'create') {
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
    $stream = New-Object System.IO.FileStream($request.path, [System.IO.FileMode]::CreateNew, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::None, $acl)
    $created = $true
    if (-not (Test-PrivateAcl $stream $sid)) { throw 'private ACL readback failed' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$request.body)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
    $result = @{ ok = $true }
  } elseif ($request.operation -eq 'read') {
    # Deny concurrent write/delete, validate the opened file, then read that same handle.
    $stream = New-Object System.IO.FileStream($request.path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    if (-not (Test-PrivateAcl $stream $sid)) { throw 'private ACL readback failed' }
    if ($stream.Length -gt 1048576) { throw 'control file exceeds read budget' }
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true, 4096, $true)
    try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
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
  try {
    output = execFileSync(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(WINDOWS_CONTROL_FILE_SCRIPT, "utf16le").toString("base64")
    ], {
      input: JSON.stringify({ operation, path, body }), encoding: "utf8", windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"], timeout: 10_000, maxBuffer: 1024 * 1024
    });
  } catch {
    // Never surface subprocess diagnostics that might quote credential input.
    throw new Error("Windows native ACL operation failed");
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
