#!/usr/bin/env bun
import {
  CLI_COMMAND_FLAGS,
  checkCommandExitCode,
  doctorManifest,
  resolveCommandExitCode,
  runCapabilitiesCommand,
  runCli,
  runCliProcessEntry,
  type CliRuntimeDeps
} from "./cli-entry";

export {
  CLI_COMMAND_FLAGS,
  checkCommandExitCode,
  doctorManifest,
  resolveCommandExitCode,
  runCapabilitiesCommand,
  runCli,
  type CliRuntimeDeps
};

if (import.meta.main) {
  await runCliProcessEntry(process.argv, process.cwd(), process.versions);
}
