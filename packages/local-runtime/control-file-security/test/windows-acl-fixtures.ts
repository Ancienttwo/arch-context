import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";

// Set-Acl launches powershell.exe like the product's native control-file create, so it gets the
// same 60 s budget (src/index.ts). Hosted launches reach 12-25 s under load; at 10 s this fixture
// timed out four times in Windows CI shards while the same test passed in isolation.
export const WINDOWS_ACL_FIXTURE_TIMEOUT_MS = 60_000;

export function grantEveryoneRead(path: string): void {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
# A pwsh -> Node/Bun -> powershell.exe launch inherits incompatible PS7 module paths.
$env:PSModulePath = "$PSHOME\Modules"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$path = [Console]::In.ReadToEnd() | ConvertFrom-Json
$acl = Get-Acl -LiteralPath $path
$sid = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::Read, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $path -AclObject $acl
`;
  execFileSync(join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
    "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")
  ], { input: JSON.stringify(path), encoding: "utf8", timeout: WINDOWS_ACL_FIXTURE_TIMEOUT_MS });
}

/** Opens `path` the way a private read does (delete sharing denied) and holds it for `holdMs`. */
export async function holdLikePrivateRead(path: string, holdMs: number): Promise<ChildProcess> {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$path = [Console]::In.ReadLine()
$holdMs = [int][Console]::In.ReadLine()
$stream = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
try {
  [Console]::Out.WriteLine('held')
  [Console]::Out.Flush()
  [System.Threading.Thread]::Sleep($holdMs)
} finally { $stream.Dispose() }
`;
  const child = spawn(join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
    "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")
  ], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
  child.stdin.end(`${path}\n${holdMs}\n`);
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; });
  while (!output.includes("held")) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`reader holder exited early with ${child.exitCode ?? child.signalCode}`);
    await Promise.race([once(child.stdout, "data"), once(child, "exit"), once(child, "error").then(([error]) => { throw error; })]);
  }
  return child;
}
