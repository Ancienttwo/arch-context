import { openSync, closeSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { NativeContextError, nativeContextErrorEnvelope, okEnvelope, toEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { IMPACT_LIMITS, readRefImpact, type RefImpactOptions } from "@archcontext/local-runtime/model-store-yaml";

const invalid = (category: string): never => { throw new NativeContextError("native-context-arguments-invalid", { category }); };
export function runRefImpactCommand(args: string[], cwd: string, reader: typeof readRefImpact = readRefImpact): JsonEnvelope {
  if (args.includes("--help") || args.includes("-h")) return okEnvelope("impact", {
    command: "impact", usage: ["archctx impact --base <ref> --head <ref> [--depth <0..10>] --json", "archctx impact --paths-from <file|-> [--depth <0..10>] --json"],
    source: "Read-only Git objects; paths-from uses the current stable worktree model. No checkout, daemon or CodeGraph process.",
    coverage: "Ref code facts are unavailable from the worktree-only producer, so touchedFlowSteps is unknown. Paths-only input has unknown line counts and model delta. Renames are a deletion plus an addition; dependents use the head model."
  });
  try {
    const values = new Map<string, string>(); const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 1) {
      const flag = args[index]!;
      if (seen.has(flag)) invalid("duplicate-impact-flag");
      seen.add(flag);
      if (flag === "--json") continue;
      if (!["--base", "--head", "--depth", "--paths-from", "--format"].includes(flag)) invalid("unknown-impact-flag");
      const value = args[++index];
      if (!value || (value.startsWith("-") && !(flag === "--paths-from" && value === "-"))) invalid("missing-impact-value");
      values.set(flag, value!);
    }
    if (values.has("--format") && values.get("--format") !== "json") invalid("impact-format-must-be-json");
    const depthText = values.get("--depth") ?? "1";
    if (!/^(?:[0-9]|10)$/.test(depthText)) invalid("impact-depth-must-be-0-to-10");
    const depth = Number(depthText);
    let options: RefImpactOptions;
    if (values.has("--paths-from")) {
      if (values.has("--base") || values.has("--head")) invalid("impact-paths-and-refs-exclusive");
      const path = values.get("--paths-from")!;
      let text: string;
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
        if (length > IMPACT_LIMITS.diffBytes) invalid("impact-paths-file-too-large");
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
      } catch (error) {
        if (error instanceof NativeContextError) throw error;
        throw new NativeContextError("native-context-input-unreadable", { category: "impact-paths-file" });
      } finally { if (fd !== undefined && fd !== 0) closeSync(fd); }
      options = { paths: text.split(/\r?\n/).filter(line => line.length > 0), depth };
    } else {
      const base = values.get("--base"), head = values.get("--head");
      if (!base || !head) invalid("impact-requires-base-and-head");
      options = { base: base!, head: head!, depth };
    }
    const envelope = okEnvelope("impact", reader(cwd, options) as unknown as Json);
    if (Buffer.byteLength(JSON.stringify(envelope, null, 2)) > IMPACT_LIMITS.responseBytes) throw new NativeContextError("native-context-limit-exceeded", { limit: "impact-response-bytes", maximum: IMPACT_LIMITS.responseBytes });
    return envelope;
  } catch (error) {
    return error instanceof NativeContextError ? { ...nativeContextErrorEnvelope(error), requestId: "impact" } : toEnvelope("impact", error, "native-export") as JsonEnvelope;
  }
}
