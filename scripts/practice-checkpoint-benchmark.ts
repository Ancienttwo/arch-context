#!/usr/bin/env bun
import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeGraphAdapter } from "@archcontext/local-runtime/codegraph-adapter";
import { MockCodeGraphProvider } from "@archcontext/local-runtime/test/codegraph-factories";
import { createStartedDaemon } from "@archcontext/local-runtime/runtime-daemon";
import { TestLocalStore } from "@archcontext/local-runtime/test/local-store-factories";

const DEFAULT_COLD_SAMPLES = 5;
const DEFAULT_WARM_SAMPLES = 20;
const DEFAULT_COALESCED_SAMPLES = 10;

if (import.meta.main) {
  const [command = "run", ...args] = process.argv.slice(2);
  if (command !== "run") {
    console.error("[practice-checkpoint-benchmark] usage: run [--json] [--cold-samples n] [--warm-samples n] [--coalesced-samples n]");
    process.exit(2);
  }
  const result = await runPracticeCheckpointBenchmark({
    coldSamples: Number(readFlag(args, "--cold-samples") ?? DEFAULT_COLD_SAMPLES),
    warmSamples: Number(readFlag(args, "--warm-samples") ?? DEFAULT_WARM_SAMPLES),
    coalescedSamples: Number(readFlag(args, "--coalesced-samples") ?? DEFAULT_COALESCED_SAMPLES)
  });
  process.stdout.write(`${args.includes("--json") ? JSON.stringify(result, null, 2) : renderHuman(result)}\n`);
  if (!result.ok) process.exit(1);
}

export interface PracticeCheckpointBenchmarkConfig {
  coldSamples: number;
  warmSamples: number;
  coalescedSamples: number;
}

export interface PracticeCheckpointBenchmarkResult {
  schemaVersion: "archcontext.practice-checkpoint-benchmark/v1";
  ok: boolean;
  thresholds: {
    coldP95Ms: number;
    warmP95Ms: number;
    coalescedP95Ms: number;
  };
  environment: {
    platform: string;
    node: string;
    bun?: string;
    repositoryFiles: number;
    provider: "mock-codegraph";
  };
  samples: {
    coldMs: number[];
    warmMs: number[];
    coalescedMs: number[];
  };
  p95: {
    coldMs: number;
    warmMs: number;
    coalescedMs: number;
  };
  coalescedEventCount: number;
}

export async function runPracticeCheckpointBenchmark(config: PracticeCheckpointBenchmarkConfig): Promise<PracticeCheckpointBenchmarkResult> {
  const root = mkdtempSync(join(tmpdir(), "archctx-practice-checkpoint-benchmark-"));
  const daemon = await createStartedDaemon({
    codeFacts: new CodeGraphAdapter(new MockCodeGraphProvider()),
    codeGraphProviderFactory: () => new MockCodeGraphProvider(),
    localStore: new TestLocalStore()
  });
  try {
    writeFixtureRepo(root);
    await daemon.init(root, "Practice Checkpoint Benchmark");

    const coldMs: number[] = [];
    for (let index = 0; index < config.coldSamples; index += 1) {
      const taskSessionId = `bench_cold_${index}`;
      await daemon.prepare(root, "remove legacy v1 wrapper", 12_288, 3, taskSessionId);
      coldMs.push(await measure(() => daemon.checkpoint(root, {
        taskSessionId,
        event: "post-edit",
        changedPaths: ["src/billing/legacy-wrapper-v1.ts"],
        toolCallId: `cold_${index}`,
        maxItems: 3
      })));
    }

    const warmTaskSessionId = "bench_warm";
    await daemon.prepare(root, "remove legacy v1 wrapper", 12_288, 3, warmTaskSessionId);
    const warmMs: number[] = [];
    for (let index = 0; index < config.warmSamples; index += 1) {
      warmMs.push(await measure(() => daemon.checkpoint(root, {
        taskSessionId: warmTaskSessionId,
        event: "post-edit",
        changedPaths: ["src/billing/legacy-wrapper-v1.ts"],
        toolCallId: `warm_${index}`,
        maxItems: 3
      })));
    }

    const coalescedInput = {
      taskSessionId: "bench_coalesced",
      event: "post-edit" as const,
      changedPaths: ["src/billing/legacy-wrapper-v1.ts"],
      toolCallId: "coalesced_same_event",
      maxItems: 3
    };
    await daemon.prepare(root, "remove legacy v1 wrapper", 12_288, 3, coalescedInput.taskSessionId);
    await daemon.checkpoint(root, coalescedInput);
    const coalescedMs: number[] = [];
    let coalescedEventCount = 1;
    for (let index = 0; index < config.coalescedSamples; index += 1) {
      const elapsed = await measure(async () => {
        const result = await daemon.checkpoint(root, coalescedInput);
        coalescedEventCount = (result.data as any).hook.coalescedEventCount;
      });
      coalescedMs.push(elapsed);
    }

    const result: PracticeCheckpointBenchmarkResult = {
      schemaVersion: "archcontext.practice-checkpoint-benchmark/v1",
      ok: p95(coldMs) <= 750 && p95(warmMs) <= 250 && p95(coalescedMs) <= 50,
      thresholds: { coldP95Ms: 750, warmP95Ms: 250, coalescedP95Ms: 50 },
      environment: {
        platform: `${process.platform}-${process.arch}`,
        node: process.version,
        bun: globalThis.Bun?.version,
        repositoryFiles: 4,
        provider: "mock-codegraph"
      },
      samples: { coldMs, warmMs, coalescedMs },
      p95: {
        coldMs: p95(coldMs),
        warmMs: p95(warmMs),
        coalescedMs: p95(coalescedMs)
      },
      coalescedEventCount
    };
    return result;
  } finally {
    await daemon.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFixtureRepo(root: string): void {
  writeFileSync(join(root, "README.md"), "# Practice checkpoint benchmark\n", "utf8");
  writeFileSync(join(root, "package.json"), "{\"name\":\"practice-checkpoint-benchmark\"}\n", "utf8");
  writeFileSync(join(root, "src-billing.ts"), "export const legacyWrapperV1 = true;\n", "utf8");
  writeFileSync(join(root, "src-orders.ts"), "export const fallbackMapperV2 = true;\n", "utf8");
}

async function measure(operation: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await operation();
  return Number((performance.now() - started).toFixed(3));
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function renderHuman(result: PracticeCheckpointBenchmarkResult): string {
  return [
    `practice checkpoint benchmark: ${result.ok ? "PASS" : "FAIL"}`,
    `cold p95: ${result.p95.coldMs}ms <= ${result.thresholds.coldP95Ms}ms`,
    `warm p95: ${result.p95.warmMs}ms <= ${result.thresholds.warmP95Ms}ms`,
    `coalesced p95: ${result.p95.coalescedMs}ms <= ${result.thresholds.coalescedP95Ms}ms`,
    `coalesced event count: ${result.coalescedEventCount}`
  ].join("\n");
}
