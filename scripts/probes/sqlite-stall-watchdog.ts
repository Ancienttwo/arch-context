// STALL-PROBE (probe branch only, never merge). Worker side of sqlite-stall-probe.ts.
// Polls the shared phase slot. When no phase enter/exit happens for a threshold, it logs the
// open phase stack, whether the main event loop is alive, and process CPU growth. At 10 s it
// also captures Windows thread wait states and the busiest processes.
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { workerData } from "node:worker_threads";

const { ctrlBuffer, timeBuffer, labelBuffer, pid } = workerData as {
  ctrlBuffer: SharedArrayBuffer;
  timeBuffer: SharedArrayBuffer;
  labelBuffer: SharedArrayBuffer;
  pid: number;
};
const ctrl = new Int32Array(ctrlBuffer);
const times = new Float64Array(timeBuffer);
const labelBytes = new Uint8Array(labelBuffer);
const decoder = new TextDecoder();
const THRESHOLDS_MS = [2000, 5000, 10000, 20000, 30000, 45000, 60000, 90000, 120000, 180000, 240000];
const DIAGNOSE_AT_MS = 10000;

let watchedSeq = -1;
let nextThreshold = 0;
let stallCpu = process.cpuUsage();

function log(line: string): void {
  writeSync(2, `[stall-probe] ${new Date().toISOString()} ${line}\n`);
}

function currentLabel(): string {
  const length = Atomics.load(ctrl, 1);
  return decoder.decode(labelBytes.slice(0, length)) || "<no-phase>";
}

function diagnose(label: string): void {
  if (process.platform !== "win32") return;
  const script = [
    `$p = Get-Process -Id ${pid}`,
    "'--- target threads (sample 1)'",
    "$p.Threads | Select-Object Id,ThreadState,WaitReason,@{n='cpuMs';e={[int]$_.TotalProcessorTime.TotalMilliseconds}} | Format-Table -AutoSize | Out-String -Width 220",
    "Start-Sleep -Milliseconds 1000",
    "'--- target threads (sample 2)'",
    `(Get-Process -Id ${pid}).Threads | Select-Object Id,ThreadState,WaitReason,@{n='cpuMs';e={[int]$_.TotalProcessorTime.TotalMilliseconds}} | Format-Table -AutoSize | Out-String -Width 220`,
    "'--- top processes by CPU'",
    "Get-Process | Sort-Object CPU -Descending | Select-Object -First 12 Id,ProcessName,CPU,@{n='WSMB';e={[int]($_.WS/1MB)}} | Format-Table -AutoSize | Out-String -Width 220",
    "'--- counters'",
    "(Get-Counter '\\PhysicalDisk(_Total)\\Current Disk Queue Length','\\PhysicalDisk(_Total)\\% Disk Time','\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 1).CounterSamples | Select-Object Path,CookedValue | Format-Table -AutoSize | Out-String -Width 220"
  ].join("; ");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  child.on("close", () => {
    log(`DIAG for stall :: ${label}\n${output.trim()}\n[stall-probe] DIAG end`);
  });
}

function poll(): void {
  const seq = Atomics.load(ctrl, 0);
  const depth = Atomics.load(ctrl, 2);
  const now = Date.now();
  if (seq !== watchedSeq) {
    if (nextThreshold > 0) log("STALL END (phase moved)");
    watchedSeq = seq;
    nextThreshold = 0;
    stallCpu = process.cpuUsage();
    return;
  }
  if (depth === 0) return;
  const stalledMs = now - times[0];
  if (nextThreshold >= THRESHOLDS_MS.length || stalledMs < THRESHOLDS_MS[nextThreshold]) return;
  const threshold = THRESHOLDS_MS[nextThreshold];
  nextThreshold += 1;
  const cpu = process.cpuUsage(stallCpu);
  const loopAgeMs = now - times[1];
  const label = currentLabel();
  log(
    `STALL ${stalledMs.toFixed(0)}ms (>=${threshold}) eventLoop=${loopAgeMs < 1000 ? "alive" : `blocked(${loopAgeMs.toFixed(0)}ms)`} ` +
    `cpuUser=${(cpu.user / 1000).toFixed(0)}ms cpuSys=${(cpu.system / 1000).toFixed(0)}ms :: ${label}`
  );
  if (threshold === DIAGNOSE_AT_MS) diagnose(label);
}

setInterval(poll, 200);
