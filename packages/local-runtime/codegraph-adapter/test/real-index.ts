import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { packagedCodeGraphCliInvocation } from "../src/index";
import { codeGraphBundle } from "../src/read-session";

/**
 * The Node executable and SDK entry of the pinned platform bundle. The fixtures below run in it, so
 * their SQLite handles end with the child process; production reads never use it (ADR-0058).
 */
function codeGraphNodeRuntime(): { node: string; sdk: string } {
  const bundle = codeGraphBundle();
  return { node: join(bundle.platformRoot, process.platform === "win32" ? "node.exe" : "node"), sdk: join(bundle.dist, "index.js") };
}

/** Index construction owns native parser resources; subprocess exit bounds their lifetime. */
export function indexCodeGraphFixture(root: string): void {
  const invocation = packagedCodeGraphCliInvocation();
  execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], {
    cwd: root, stdio: "pipe", timeout: 60_000,
    env: { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" }
  });
}

/** Brings an indexed fixture up to its current files, as `complete` does before it reads debt. */
export function syncCodeGraphFixture(root: string): void {
  const invocation = packagedCodeGraphCliInvocation();
  execFileSync(invocation.command, [...invocation.argsPrefix, "sync", root], {
    cwd: root, stdio: "pipe", timeout: 60_000,
    env: { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" }
  });
}

export function incompleteCodeGraphFixture(root: string): void {
  const runtime = codeGraphNodeRuntime();
  execFileSync(runtime.node, ["-e", 'const {CodeGraph}=require(process.argv[1]); const graph=CodeGraph.initSync(process.argv[2]); graph.close();', runtime.sdk, root], {
    cwd: root, stdio: "pipe", timeout: 30_000, env: { ...process.env, DO_NOT_TRACK: "1" }
  });
}
