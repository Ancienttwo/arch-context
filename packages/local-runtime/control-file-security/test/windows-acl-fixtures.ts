import { execFileSync } from "node:child_process";
import { join } from "node:path";

export function grantEveryoneRead(path: string): void {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
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

