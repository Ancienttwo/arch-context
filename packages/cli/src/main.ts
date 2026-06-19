#!/usr/bin/env bun
import { errorEnvelope } from "../../contracts/src/index";
import { createStartedDaemon } from "../../runtime-daemon/src/index";

const [, , command, ...args] = process.argv;

if (import.meta.main) {
  const result = await runCli(command, args, process.cwd()).catch((error) =>
    errorEnvelope("cli", "AC_RUNTIME_UNAVAILABLE", error instanceof Error ? error.message : String(error))
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function runCli(command = "help", args: string[] = [], cwd: string) {
  const daemon = await createStartedDaemon();
  switch (command) {
    case "init":
      return daemon.init(cwd, readFlag(args, "--name") ?? "ArchContext Project");
    case "sync":
      return daemon.sync(cwd, readRepeatedFlag(args, "--changed"));
    case "validate":
      return daemon.validate(cwd);
    case "context": {
      const task = readFlag(args, "--task") ?? args.join(" ").trim();
      if (!task) return errorEnvelope("context", "AC_SCHEMA_INVALID", "context requires --task or task text");
      return daemon.context(cwd, task, Number(readFlag(args, "--max-symbols") ?? 12));
    }
    case "status":
      return daemon.runtimeStatus(cwd);
    case "help":
    default:
      return {
        schemaVersion: "archcontext.envelope/v1",
        ok: true,
        requestId: "help",
        data: {
          commands: ["init", "sync", "validate", "context", "status"],
          examples: ["archctx init --name MyApp", "archctx context --task \"add subscriptions\""]
        }
      };
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readRepeatedFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}
