import { execFileSync, spawn } from "node:child_process";
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

export function fixtureNameCounts(root: string, names: string[]): number[] {
  const runtime = codeGraphNodeRuntime();
  const script = 'const {CodeGraph}=require(process.argv[1]); const names=JSON.parse(require("node:fs").readFileSync(0,"utf8")); const graph=CodeGraph.openSync(process.argv[2]); try { process.stdout.write(JSON.stringify(names.map(name=>graph.getNodesByName(name).length))); } finally { graph.close(); }';
  return JSON.parse(execFileSync(runtime.node, ["-e", script, runtime.sdk, root], {
    cwd: root, input: JSON.stringify(names), encoding: "utf8", timeout: 30_000,
    env: { ...process.env, DO_NOT_TRACK: "1" }, stdio: ["pipe", "pipe", "pipe"]
  }));
}

export async function holdCodeGraphFixture(root: string): Promise<{ isRunning(): boolean; close(): Promise<void> }> {
  const runtime = codeGraphNodeRuntime();
  const script = 'const {CodeGraph}=require(process.argv[1]); const graph=CodeGraph.openSync(process.argv[2]); graph.getFiles(); process.stdin.resume(); process.stdin.once("end",()=>graph.close()); process.stdout.write("ready\\n");';
  const child = spawn(runtime.node, ["-e", script, runtime.sdk, root], { cwd: root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DO_NOT_TRACK: "1" } });
  const closed = new Promise<number | null>(resolve => child.once("close", resolve));
  let ready = false;
  let output = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("CodeGraph fixture holder did not become ready")), 15_000);
      child.once("error", reject);
      child.once("close", code => { if (!ready) reject(new Error(`CodeGraph fixture holder exited: ${code}`)); });
      child.stdout.on("data", chunk => {
        output += String(chunk);
        if (output === "ready\n") { ready = true; resolve(); }
        else if (output.length > 1024) reject(new Error("Unexpected fixture holder output"));
      });
    });
  } catch (error) {
    child.kill("SIGKILL"); await closed; throw error;
  } finally { if (timer) clearTimeout(timer); }
  return {
    isRunning: () => child.exitCode === null && child.signalCode === null,
    close: async () => {
      child.stdin.end();
      const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try { if (await closed !== 0) throw new Error("CodeGraph fixture holder did not close cleanly"); }
      finally { clearTimeout(deadline); }
    }
  };
}
