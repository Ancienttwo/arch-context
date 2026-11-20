import { openSync, closeSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { NativeContextError, nativeContextErrorEnvelope, okEnvelope, toEnvelope, type Json, type JsonEnvelope, type RefImpactV1, type RefImpactBatchV1 } from "@archcontext/contracts";
import { IMPACT_LIMITS, readRefImpact, readRefImpactBatch, type RefImpactOptions } from "@archcontext/local-runtime/model-store-yaml";

const invalid = (category: string): never => { throw new NativeContextError("native-context-arguments-invalid", { category }); };
export function runRefImpactCommand(args: string[], cwd: string, reader: typeof readRefImpact = readRefImpact): JsonEnvelope {
  if (args.includes("--help") || args.includes("-h")) return okEnvelope("impact", {
    command: "impact", usage: ["archctx impact --base <ref> --head <ref> [--depth <0..10>] --json", "archctx impact --paths-from <file|-> [--depth <0..10>] --json", "archctx impact --batch-file <json-path> --json"],
    source: "Read-only Git objects and an existing CodeGraph index with readiness probes; paths-from uses the current stable worktree model. No checkout, daemon, index initialization or sync.",
    coverage: "Declaration ranges require a complete existing index whose indexed source bytes match the selected tree. Missing, ambiguous, partial or stale evidence remains unknown. Historical trees without matching index facts remain unknown. Paths-only input has unknown line counts and model delta. Renames are a deletion plus an addition; dependents use the head model."
  });
  const batchRequested = args.includes("--batch-file");
  const invalidFlag = (category: string): never => invalid(batchRequested ? "impact-batch-arguments-invalid" : category);
  try {
    const values = new Map<string, string>(); const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 1) {
      const flag = args[index]!;
      if (seen.has(flag)) invalidFlag("duplicate-impact-flag");
      seen.add(flag);
      if (flag === "--json") continue;
      if (!["--base", "--head", "--depth", "--paths-from", "--batch-file", "--format"].includes(flag)) invalidFlag("unknown-impact-flag");
      const value = args[++index];
      if (!value || (value.startsWith("-") && !(flag === "--paths-from" && value === "-"))) invalidFlag("missing-impact-value");
      values.set(flag, value!);
    }
    if (values.has("--format") && values.get("--format") !== "json") invalidFlag("impact-format-must-be-json");
    const depthText = values.get("--depth") ?? "1";
    if (!/^(?:[0-9]|10)$/.test(depthText)) invalidFlag("impact-depth-must-be-0-to-10");
    const depth = Number(depthText);
    const batch = values.get("--batch-file");
    let data: RefImpactV1 | RefImpactBatchV1;
    if (batch) {
      if (["--base", "--head", "--depth", "--paths-from"].some(flag => values.has(flag))) invalid("impact-batch-exclusive");
      const text = readImpactInput(cwd, batch, "impact-batch-file");
      let request: unknown;
      try { request = JSON.parse(text); }
      catch { invalid("impact-batch-json-invalid"); }
      data = readRefImpactBatch(cwd, request);
    } else {
      let options: RefImpactOptions;
      if (values.has("--paths-from")) {
        if (values.has("--base") || values.has("--head")) invalid("impact-paths-and-refs-exclusive");
        const text = readImpactInput(cwd, values.get("--paths-from")!, "impact-paths-file");
        options = { paths: text.split(/\r?\n/).filter(line => line.length > 0), depth };
      } else {
        const base = values.get("--base"), head = values.get("--head");
        if (!base || !head) invalid("impact-requires-base-and-head");
        options = { base: base!, head: head!, depth };
      }
      data = reader(cwd, options);
    }
    // SAFETY: Both impact contracts contain only JSON fields.
    const envelope = okEnvelope("impact", data as unknown as Json);
    if (Buffer.byteLength(JSON.stringify(envelope, null, 2)) > IMPACT_LIMITS.responseBytes) {
      throw new NativeContextError("native-context-limit-exceeded", {
        limit: batchRequested ? "batch-response-bytes" : "impact-response-bytes", maximum: IMPACT_LIMITS.responseBytes
      });
    }
    return envelope;
  } catch (error) {
    return error instanceof NativeContextError ? { ...nativeContextErrorEnvelope(error), requestId: "impact" } : toEnvelope("impact", error, "native-export") as JsonEnvelope;
  }
}

function readImpactInput(cwd: string, path: string, category: "impact-paths-file" | "impact-batch-file"): string {
  let fd: number | undefined;
  try {
    fd = path === "-" ? 0 : openSync(resolve(cwd, path), "r");
    const bytes = Buffer.alloc(IMPACT_LIMITS.diffBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > IMPACT_LIMITS.diffBytes) invalid(`${category}-too-large`);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } catch (error) {
    if (error instanceof NativeContextError) throw error;
    throw new NativeContextError("native-context-input-unreadable", { category });
  } finally { if (fd !== undefined && fd !== 0) closeSync(fd); }
}
