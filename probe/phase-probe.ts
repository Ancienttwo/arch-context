// Preload for `bun test --preload`: attributes each test's wall time to child processes,
// bun:sqlite calls, and sync fs flush/rename/remove calls. Writes one line per test plus any
// single call >= PHASE_PROBE_SLOW_MS to PHASE_PROBE_OUT. Does not change behaviour.
import { mock, beforeEach, afterEach } from "bun:test";
import { appendFileSync } from "node:fs";
const out = process.env.PHASE_PROBE_OUT ?? "phase-probe.out";
const slowMs = Number(process.env.PHASE_PROBE_SLOW_MS ?? "250");
const realFs = require("node:fs");
const write = (line: string) => { realFs.appendFileSync(out, line + "\n"); process.stderr.write(`[phase] ${line}\n`); };
type Bucket = { n: number; ms: number };
let cur: Record<string, Bucket> = {};
let testStart = 0;
const add = (cat: string, ms: number, what: string) => {
  const b = (cur[cat] ??= { n: 0, ms: 0 }); b.n++; b.ms += ms;
  if (ms >= slowMs) write(`  SLOW ${cat} ${ms.toFixed(0)}ms at +${(performance.now() - testStart - ms).toFixed(0)}ms ${what.slice(0, 200)}`);
};
const timed = <F extends (...a: any[]) => any>(cat: string, fn: F, label: (a: any[]) => string): F =>
  (function (this: any, ...a: any[]) { const s = performance.now(); try { return fn.apply(this, a); } finally { add(cat, performance.now() - s, label(a)); } }) as F;
const short = (v: unknown) => String(v).replace(/.*node_modules/, "nm").replace(/[A-Za-z]:\\Users\\[^ ]*Temp\\|\/private\/var\/folders\/[^ ]*\/T\//g, "<tmp>/");
// child_process
const cp = require("node:child_process");
const cpw: Record<string, any> = { ...cp };
for (const n of ["execFileSync", "spawnSync", "execSync"]) cpw[n] = timed(`spawn:${n}`, cp[n], (a) => [a[0], ...(Array.isArray(a[1]) ? a[1] : [])].map(short).join(" "));
mock.module("node:child_process", () => ({ ...cpw, default: cpw }));
mock.module("child_process", () => ({ ...cpw, default: cpw }));
// fs flush / rename / remove
const fsw: Record<string, any> = { ...realFs };
for (const n of ["fsyncSync", "fdatasyncSync", "renameSync", "rmSync", "unlinkSync", "copyFileSync"]) if (realFs[n]) fsw[n] = timed(`fs:${n}`, realFs[n], (a) => short(a[0]));
// fs/promises flush / rename / remove (async waits otherwise land in "other")
const realFsp = require("node:fs/promises");
const fspw: Record<string, any> = { ...realFsp };
for (const n of ["rename", "rm", "unlink", "copyFile"]) if (realFsp[n]) {
  const f = realFsp[n];
  fspw[n] = async (...a: any[]) => { const s = performance.now(); try { return await f(...a); } finally { add(`fsp:${n}`, performance.now() - s, short(a[0])); } };
}
mock.module("node:fs/promises", () => ({ ...fspw, default: fspw }));
mock.module("fs/promises", () => ({ ...fspw, default: fspw }));
mock.module("node:fs", () => ({ ...fsw, default: fsw }));
mock.module("fs", () => ({ ...fsw, default: fsw }));
// bun:sqlite
const sq = require("bun:sqlite");
const RealDb = sq.Database;
class ProbedDb extends RealDb {
  constructor(...a: any[]) { const s = performance.now(); super(...a); add("sqlite:open", performance.now() - s, short(a[0])); }
  exec(...a: any[]) { const s = performance.now(); try { return super.exec(...a); } finally { add("sqlite:exec", performance.now() - s, String(a[0]).slice(0, 80)); } }
  run(...a: any[]) { const s = performance.now(); try { return super.run(...a); } finally { add("sqlite:exec", performance.now() - s, String(a[0]).slice(0, 80)); } }
  close(...a: any[]) { const s = performance.now(); try { return super.close(...a); } finally { add("sqlite:close", performance.now() - s, ""); } }
  prepare(sql: string, ...a: any[]) { return this.wrapStatement(sql, () => super.prepare(sql, ...a)); }
  query(sql: string, ...a: any[]) { return this.wrapStatement(sql, () => super.query(sql, ...a)); }
  wrapStatement(sql: string, make: () => any) {
    const s = performance.now(); const st = make(); add("sqlite:prepare", performance.now() - s, sql.slice(0, 80));
    for (const m of ["get", "all", "run", "values"]) { const f = (st as any)[m]?.bind(st); if (f) (st as any)[m] = (...x: any[]) => { const t = performance.now(); try { return f(...x); } finally { add("sqlite:step", performance.now() - t, sql.slice(0, 80)); } }; }
    return st;
  }
}
mock.module("bun:sqlite", () => ({ ...sq, Database: ProbedDb, default: ProbedDb }));
beforeEach(() => { cur = {}; testStart = performance.now(); });
afterEach(() => {
  const total = performance.now() - testStart;
  const parts = Object.entries(cur).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => `${k}=${v.ms.toFixed(0)}ms/${v.n}`);
  const accounted = Object.values(cur).reduce((s, v) => s + v.ms, 0);
  write(`TEST total=${total.toFixed(0)}ms other=${(total - accounted).toFixed(0)}ms ${parts.join(" ")}`);
});
