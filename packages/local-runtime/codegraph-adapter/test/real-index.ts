import { execFileSync } from "node:child_process";
import { packagedCodeGraphCliInvocation } from "../src/index";

/** Index construction owns native parser resources; subprocess exit bounds their lifetime. */
export function indexCodeGraphFixture(root: string): void {
  const invocation = packagedCodeGraphCliInvocation();
  execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], {
    cwd: root, stdio: "pipe", timeout: 60_000,
    env: { ...process.env, DO_NOT_TRACK: "1", CODEGRAPH_NO_DOWNLOAD: "1" }
  });
}
