// STALL-PROBE (probe branch only, never merge).
// Preload for `bun test`. Exposes globalThis.__archctxStallProbe so instrumented code can name phases.
// A Worker thread watches a SharedArrayBuffer. It keeps running when the main JS thread is blocked
// inside a synchronous SQLite or fs call, so it can name the phase that is stalled and tell
// a synchronous block (no event-loop heartbeat) from an async wait (heartbeat alive).
import { afterEach, beforeEach } from "bun:test";
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const LABEL_BYTES = 4096;
const ctrlBuffer = new SharedArrayBuffer(16);
const timeBuffer = new SharedArrayBuffer(16);
const labelBuffer = new SharedArrayBuffer(LABEL_BYTES);
const ctrl = new Int32Array(ctrlBuffer); // [seq, labelLength, depth]
const times = new Float64Array(timeBuffer); // [lastChangeEpochMs, heartbeatEpochMs]
const labelBytes = new Uint8Array(labelBuffer);
const encoder = new TextEncoder();

type Frame = { label: string; start: number; childMs: number; hasChild: boolean };
const stack: Frame[] = [];
const SLOW_LEAF_MS = Number(process.env.ARCHCTX_STALL_PROBE_SLOW_MS ?? 750);
const SLOW_FRAME_MS = 3000;
let testIndex = 0;

function log(line: string): void {
  writeSync(2, `[stall-probe] ${new Date().toISOString()} ${line}\n`);
}

function publish(): void {
  const text = stack.map((frame) => frame.label).join(" > ");
  const { written } = encoder.encodeInto(text, labelBytes.subarray(0, LABEL_BYTES));
  Atomics.store(ctrl, 1, written ?? 0);
  Atomics.store(ctrl, 2, stack.length);
  times[0] = Date.now();
  Atomics.add(ctrl, 0, 1);
}

function enter(label: string): Frame {
  const parent = stack.at(-1);
  if (parent) parent.hasChild = true;
  const frame: Frame = { label, start: performance.now(), childMs: 0, hasChild: false };
  stack.push(frame);
  publish();
  return frame;
}

function exit(frame: Frame): void {
  const index = stack.lastIndexOf(frame);
  if (index === -1) return;
  // An exception can skip an inner exit; drop those frames with the one that ends.
  stack.length = index;
  const durationMs = performance.now() - frame.start;
  const parent = stack.at(-1);
  if (parent) parent.childMs += durationMs;
  const path = [...stack.map((item) => item.label), frame.label].join(" > ");
  if (!frame.hasChild && durationMs >= SLOW_LEAF_MS) {
    log(`SLOW leaf ${durationMs.toFixed(0)}ms :: ${path}`);
  } else if (frame.hasChild && durationMs >= SLOW_FRAME_MS) {
    log(`SLOW frame ${durationMs.toFixed(0)}ms self=${(durationMs - frame.childMs).toFixed(0)}ms :: ${path}`);
  }
  publish();
}

function phase<T>(label: string, fn: () => T): T {
  const frame = enter(label);
  let result: T;
  try {
    result = fn();
  } catch (error) {
    exit(frame);
    throw error;
  }
  if (result instanceof Promise) {
    return result.finally(() => exit(frame)) as T;
  }
  exit(frame);
  return result;
}

(globalThis as Record<string, unknown>).__archctxStallProbe = { enter, exit, phase };

const heartbeat = setInterval(() => {
  times[1] = Date.now();
}, 100);
heartbeat.unref?.();
times[1] = Date.now();

const worker = new Worker(fileURLToPath(new URL("./sqlite-stall-watchdog.ts", import.meta.url)), {
  workerData: { ctrlBuffer, timeBuffer, labelBuffer, pid: process.pid }
});
worker.unref();

beforeEach(() => {
  testIndex += 1;
  enter(`test#${testIndex}`);
});

afterEach(() => {
  const frame = stack.find((item) => item.label === `test#${testIndex}`);
  if (frame) exit(frame);
});

log(`armed pid=${process.pid} bun=${process.versions.bun} platform=${process.platform}`);
