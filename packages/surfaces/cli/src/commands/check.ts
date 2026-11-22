import {
  CLI_CHECK_SCHEMA_VERSION,
  FailureError,
  errorEnvelope,
  failureEnvelope,
  isRepoRelativePosixPath,
  knownFailure,
  okEnvelope,
  type ArchitectureDebtReportV1,
  type CliCheckChangedOutputV1,
  type CliCheckPrOutputV1,
  type CliCheckSliceResult,
  type Json,
  type JsonEnvelope,
  type ProjectionSliceV1,
  type RuntimeVerifyV1
} from "@archcontext/contracts";
import { runArchitectureDebtCommand, selectedProducerFailureEnvelope } from "@archcontext/local-runtime/architecture-debt";
import { findRepositoryRoot } from "@archcontext/local-runtime/git-adapter";
import {
  CapabilityDependenciesError,
  readCapabilityDependencies,
  runConstraintCheckCommand,
  runFlowSelectorCheckCommand,
  runProjectionSliceCommand,
  runRuntimeVerifyCommand,
  runStateMachineCheckCommand
} from "@archcontext/local-runtime/runtime-daemon";
import { runArchitectureDebtDeltaCommand } from "../architecture-debt-delta";
import {
  cliArgumentFailure,
  collectMultiValueFlags,
  isCheckInvocation,
  readFlag,
  readOptionalNonNegativeIntegerFlag,
  readOptionalPositiveIntegerFlag,
  readRepeatedFlag
} from "../cli-flags";

/**
 * `archctx check`: unified in-process, read-only architecture check gate (#640 / #642).
 * - Edit-time (`--changed` / `--changed-path`): wraps `runArchitectureDebtCommand` (`<300ms` warm target).
 * - PR gate (`--base <ref> [--slice]`): wraps `runRuntimeVerifyCommand` + optional `runProjectionSliceCommand`.
 */
export function runCheckCommand(args: string[], cwd: string): JsonEnvelope {
  const { values, strayPositional } = collectMultiValueFlags(args, ["--changed", "--changed-path"], ["--base"]);
  if (strayPositional !== undefined) {
    return cliArgumentFailure("check", `check does not accept ${strayPositional}; use --help`);
  }
  const baseValues = readRepeatedFlag(args, "--base");
  const changedPaths = [...new Set([...(values.get("--changed") ?? []), ...(values.get("--changed-path") ?? [])])].sort();
  const base = readFlag(args, "--base");
  const sliceRequested = args.includes("--slice");

  if (baseValues.length > 1) return cliArgumentFailure("check", "Provide only one --base revision");
  if (base !== undefined && changedPaths.length > 0) {
    return cliArgumentFailure("check", "check --base cannot be combined with --changed or --changed-path");
  }
  if (base === undefined && sliceRequested) {
    return cliArgumentFailure("check", "check --slice requires --base <ref>");
  }

  if (base === undefined) {
    const invalidPath = changedPaths.find((path) => !isRepoRelativePosixPath(path));
    if (invalidPath !== undefined) {
      return cliArgumentFailure("check", `changed path must be a repository-relative POSIX path: ${invalidPath}`);
    }
    const debtEnvelope = runArchitectureDebtCommand(cwd, { changedPaths });
    if (!debtEnvelope.ok) return { ...debtEnvelope, requestId: "check" };
    const debt = debtEnvelope.data as unknown as ArchitectureDebtReportV1;
    const status = debt.items.length === 0 ? "pass" : "findings";
    const exitCode: 0 | 2 = status === "pass" ? 0 : 2;
    const payload: CliCheckChangedOutputV1 = {
      schemaVersion: CLI_CHECK_SCHEMA_VERSION,
      mode: "changed",
      status,
      exitCode,
      changedPaths,
      debt
    };
    return okEnvelope("check", payload as unknown as Json);
  }

  const verifyEnvelope = runRuntimeVerifyCommand(cwd, base);
  if (!verifyEnvelope.ok) return { ...verifyEnvelope, requestId: "check" };
  const verify = verifyEnvelope.data as unknown as RuntimeVerifyV1;
  let slice: CliCheckSliceResult | undefined;
  if (sliceRequested) {
    const sliceEnvelope = runProjectionSliceCommand({ cwd, base, changedPaths: [] });
    slice = sliceEnvelope.ok
      ? { ok: true, data: sliceEnvelope.data as unknown as ProjectionSliceV1 }
      : { ok: false, error: sliceEnvelope.error! };
  }

  const blockingChecks: string[] = [];
  if (!verify.checks.validate.ok || !verify.checks.validate.data.valid) blockingChecks.push("validate");
  if (!verify.checks.flows.ok || !verify.checks.flows.data.ok) blockingChecks.push("flows");
  if (!verify.checks["state-machines"].ok || verify.checks["state-machines"].data.machines.some((m) => m.rules.some((r) => r.status === "broken"))) {
    blockingChecks.push("state-machines");
  }
  if (!verify.checks.constraints.ok || verify.checks.constraints.data.status === "violated") blockingChecks.push("constraints");
  if (!verify.checks.projection.ok || verify.checks.projection.data.verdict === "generated-only-not-render-equivalent") {
    blockingChecks.push("projection");
  }
  if (!verify.checks.debt.ok || verify.checks.debt.data.items.length > 0) blockingChecks.push("debt");
  if (slice && !slice.ok) blockingChecks.push("slice");

  const status = blockingChecks.length === 0 ? "pass" : "findings";
  const exitCode: 0 | 2 = status === "pass" ? 0 : 2;
  const payload: CliCheckPrOutputV1 = {
    schemaVersion: CLI_CHECK_SCHEMA_VERSION,
    mode: "pr",
    status,
    exitCode,
    base,
    baseSha: verify.baseSha,
    headSha: verify.headSha,
    blockingChecks,
    verify,
    ...(slice ? { slice } : {})
  };
  return okEnvelope("check", payload as unknown as Json);
}

/** Process exit code for `archctx check`: 0=pass, 2=findings/blocking issues, 1=error. */
export function checkCommandExitCode(result: { ok?: boolean; data?: unknown }): number {
  if (!result || result.ok !== true) return 1;
  const data = result.data as { exitCode?: number; status?: string } | undefined;
  if (data?.exitCode === 0 || data?.exitCode === 2) return data.exitCode;
  return data?.status === "findings" ? 2 : 0;
}

export function runRuntimeVerifyCliCommand(args: string[], cwd: string): JsonEnvelope {
  if (args.includes("--help") || args.includes("-h")) return okEnvelope("verify", { usage: "archctx verify --base <ref> --json" });
  const flags = args.filter((arg) => arg !== "--json");
  if (flags.length !== 2 || flags[0] !== "--base" || args.length > 3) {
    return failureEnvelope("verify", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  }
  return runRuntimeVerifyCommand(cwd, flags[1]!);
}

export async function runDebtCommand(args: string[], cwd: string): Promise<JsonEnvelope> {
  const base = readFlag(args, "--base");
  const complete = args.includes("--complete");
  const changedPaths = readRepeatedFlag(args, "--changed-path");
  if ((base !== undefined || complete) && changedPaths.length > 0) {
    return cliArgumentFailure("debt", "--changed-path cannot be combined with --base or --complete");
  }
  if (base === undefined) return runArchitectureDebtCommand(cwd, { changedPaths, complete });
  if (readRepeatedFlag(args, "--base").length > 1) return cliArgumentFailure("debt", "Provide only one --base revision");

  const controller = new AbortController();
  const stop = () => controller.abort(new FailureError("AC_RUNTIME_UNAVAILABLE", "debt-measurement-interrupted"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    return await runArchitectureDebtDeltaCommand(cwd, base, complete, controller.signal);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

export function runCheckpointCommand(args: string[], cwd: string) {
  return { ...runArchitectureDebtCommand(cwd, { changedPaths: readRepeatedFlag(args, "--changed-path") }), requestId: "checkpoint" };
}

export function runConstraintsCommand(args: string[], cwd: string): JsonEnvelope {
  if (!isCheckInvocation(args)) return failureEnvelope("constraints.check", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  return runConstraintCheckCommand(cwd);
}

/** In-process flow proofs; only the explicit no-sync mode preserves the checkout index. */
export function runFlowsCommand(args: string[], cwd: string): JsonEnvelope {
  if (!isCheckInvocation(args, ["--no-sync"])) return failureEnvelope("flows.check", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  return runFlowSelectorCheckCommand(cwd, { noSync: args.includes("--no-sync") });
}

/** Stateless read of the model and of the files that a source names; no daemon or store. */
export function runStateMachinesCommand(args: string[], cwd: string): JsonEnvelope {
  if (!isCheckInvocation(args)) return failureEnvelope("state-machines.check", knownFailure("AC_SCHEMA_INVALID", "cli-input-invalid"));
  return runStateMachineCheckCommand(cwd);
}

/** `archctx deps`: in-process and read-only, like `resolve`, so it starts no daemon and writes no state. */
export function runDepsCommand(args: string[], cwd: string) {
  const importNodeLimit = readOptionalPositiveIntegerFlag(args, "--import-node-limit", "deps");
  if (!importNodeLimit.ok) return failureEnvelope("deps", knownFailure("AC_SCHEMA_INVALID", "deps-input-invalid", { field: "importNodeLimit", issue: "invalid-limit" }));
  const edgeLimit = readOptionalNonNegativeIntegerFlag(args, "--edge-limit", "deps");
  if (!edgeLimit.ok) return failureEnvelope("deps", knownFailure("AC_SCHEMA_INVALID", "deps-input-invalid", { field: "edgeLimit", issue: "invalid-limit" }));
  const from = readFlag(args, "--from");
  const into = readFlag(args, "--into");
  for (const [flag, value] of [["--from", from], ["--into", into]] as const) {
    if (args.includes(flag) && (value === undefined || value.startsWith("--"))) {
      return failureEnvelope("deps", knownFailure("AC_SCHEMA_INVALID", "deps-input-invalid", { field: flag === "--from" ? "from" : "into", issue: "missing-value" }));
    }
  }
  try {
    return okEnvelope("deps", readCapabilityDependencies(findRepositoryRoot(cwd), {
      ...(from === undefined ? {} : { from }),
      ...(into === undefined ? {} : { into }),
      ...(importNodeLimit.value === undefined ? {} : { importNodeLimit: importNodeLimit.value }),
      ...(edgeLimit.value === undefined ? {} : { edgeLimit: edgeLimit.value })
    }) as unknown as Json);
  } catch (error) {
    if (error instanceof CapabilityDependenciesError) return selectedProducerFailureEnvelope("deps", error, "cli");
    if (error instanceof Error && error.message.includes("No Git repository root")) {
      return errorEnvelope("deps", "AC_REPO_NOT_FOUND", error.message, "git-worktree-required");
    }
    throw error;
  }
}
