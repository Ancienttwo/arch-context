import { errorEnvelope, okEnvelope, toEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { readArchitectureHistory } from "@archcontext/local-runtime/model-store-yaml";
import { projectHistoryMermaid } from "@archcontext/core/projection-engine";

export function runArchitectureHistoryCommand(args: string[], cwd: string): JsonEnvelope {
  if (args.includes("--help") || args.includes("-h")) return okEnvelope("history", { usage: "archctx history [--ref <rev>] [--format json|mermaid] [--offset <n>] [--limit <n>] --json" });
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--json") continue;
    if (!["--ref", "--format", "--offset", "--limit"].includes(flag) || values.has(flag) || args[i + 1] === undefined) return errorEnvelope("history", "AC_SCHEMA_INVALID", "Invalid history arguments", "cli-input-invalid");
    values.set(flag, args[++i]!);
  }
  const format = values.get("--format") ?? "json", offsetText = values.get("--offset") ?? "0", limitText = values.get("--limit") ?? "200";
  if (!/^[0-9]+$/.test(offsetText) || !/^[0-9]+$/.test(limitText) || !Number.isSafeInteger(Number(offsetText)) || !Number.isSafeInteger(Number(limitText)) || Number(limitText) > 1000 || !["json", "mermaid"].includes(format)) return errorEnvelope("history", "AC_SCHEMA_INVALID", "Invalid history arguments", "cli-input-invalid");
  try {
    const history = readArchitectureHistory(cwd, { ref: values.get("--ref"), offset: Number(offsetText), limit: Number(limitText) });
    return okEnvelope("history", (format === "mermaid" ? projectHistoryMermaid(history) : history) as unknown as Json);
  } catch (error) { return toEnvelope("history", error, "cli") as JsonEnvelope; }
}
