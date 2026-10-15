import { toEnvelope, NATIVE_CONTEXT_PROFILE, NativeContextError, assertNativeContextLimit, nativeContextErrorEnvelope, okEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { assertNativeGitRevision } from "@archcontext/local-runtime/git-adapter";
import { exportNativeContext, type NativeContextSelector } from "@archcontext/local-runtime/model-store-yaml";

export type NativeContextReader = typeof exportNativeContext;

/** Native-specific preflight is read-free and leaves legacy diagram flags alone. */
export function runNativeContextCommand(args: string[], cwd: string, reader: NativeContextReader = exportNativeContext): JsonEnvelope {
  if (args.includes("--help") || args.includes("-h")) return okEnvelope("export.native", {
    command: "export native",
    usage: ["archctx export native --worktree [--profile repo-harness/v1] [--json]", "archctx export native --ref <commit-ish> [--profile repo-harness/v1] [--format json]"],
    selectors: "Exactly one of --worktree and --ref is required.",
    source: "Stateless local Git/filesystem reads; no daemon, database, CodeGraph or network.",
    worktreeConsistency: "Two complete observations detect observed drift; lock-free ABA edits can escape detection."
  });
  try {
    const seen = new Set<string>();
    let worktree = false;
    let ref: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const flag = args[index]!;
      if (seen.has(flag)) throw new NativeContextError("native-context-arguments-invalid", { flag, category: "duplicate" });
      seen.add(flag);
      if (flag === "--worktree") { worktree = true; continue; }
      if (flag === "--json") continue;
      if (!["--ref", "--profile", "--format"].includes(flag)) throw new NativeContextError("native-context-arguments-invalid", { category: flag.startsWith("-") ? "unknown-flag" : "unexpected-positional" });
      const value = args[++index];
      if (value === undefined || value.startsWith("-")) throw new NativeContextError("native-context-arguments-invalid", { flag, category: "missing-value" });
      if (flag === "--ref") { assertNativeGitRevision(value); ref = value; }
      if (flag === "--profile" && value !== NATIVE_CONTEXT_PROFILE) throw new NativeContextError("native-context-profile-invalid", { supportedProfile: NATIVE_CONTEXT_PROFILE });
      if (flag === "--format" && value !== "json") throw new NativeContextError("native-context-arguments-invalid", { flag, supportedFormat: "json" });
    }
    if (Number(worktree) + Number(ref !== undefined) !== 1) throw new NativeContextError("native-context-arguments-invalid", { category: "exactly-one-selector-required" });
    const selector: NativeContextSelector = ref === undefined ? { source: "worktree" } : { source: "ref", ref };
    const envelope = okEnvelope("export.native", reader(cwd, selector) as unknown as Json);
    // Match the actual existing CLI JSON renderer including indentation and its final newline.
    assertNativeContextLimit("responseBytes", Buffer.byteLength(JSON.stringify(envelope, null, 2) + "\n", "utf8"));
    return envelope;
  } catch (error) {
    let typed: NativeContextError | undefined;
    try { if (error instanceof NativeContextError) typed = error; } catch { /* Uninspectable throws remain unknown. */ }
    const envelope = typed ? nativeContextErrorEnvelope(typed) : toEnvelope("export.native", error, "native-export") as JsonEnvelope;
    try { assertNativeContextLimit("responseBytes", Buffer.byteLength(JSON.stringify(envelope, null, 2) + "\n", "utf8")); }
    catch (limit) { return nativeContextErrorEnvelope(limit as NativeContextError); }
    return envelope;
  }
}
