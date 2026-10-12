import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";

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
  ], { input: JSON.stringify(path), encoding: "utf8", timeout: 10_000 });
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
    if (child.exitCode !== null) throw new Error(`reader holder exited early with ${child.exitCode}`);
    await Promise.race([once(child.stdout, "data"), once(child, "exit")]);
  }
  return child;
}
