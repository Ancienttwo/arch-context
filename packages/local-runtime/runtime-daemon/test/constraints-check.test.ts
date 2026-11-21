import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stableYaml } from "@archcontext/contracts";
import { codeGraphCliInvocation } from "@archcontext/local-runtime/codegraph-adapter";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { isProcessAlive } from "@archcontext/local-runtime/process-liveness";
import { runtimeStatePaths } from "@archcontext/local-runtime/runtime-state-paths";
import { runConstraintCheckCommand } from "../src/constraints-check";
import { createRuntimeRpcClientFromWorkspaceStateDir } from "../src/daemon-control";

const contract = "component.runtime.contract";
const internal = "component.runtime.internal";
const contractPath = "runtime/contract/index.ts";
const internalPath = "runtime/internal/index.ts";
const unownedPath = "shared/index.ts";
const constraintId = "constraint.consumer-runtime";

async function withFixture(
  options: { targetPath: string; contested?: boolean; allowedTarget?: string },
  run: (root: string) => void | Promise<void>
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "archctx-allowed-targets-"));
  try {
    function write(path: string, body: string) {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, body);
    }
    initializeArchContextModel(root, "Public contract fixture");
    const nodes = [
      { id: "module.consumer", kind: "module", source: { include: ["consumer/**"] } },
      { id: "capability.runtime", kind: "capability", source: { include: ["runtime/index.ts"] } },
      { id: contract, kind: "component", parent: "capability.runtime", source: { include: [contractPath] } },
      { id: internal, kind: "component", parent: "capability.runtime", source: { include: options.contested ? [internalPath, contractPath] : [internalPath] } }
    ];
    for (const node of nodes) {
      write(`.archcontext/model/nodes/${node.id}.yaml`, stableYaml({
        id: node.id, kind: node.kind, source: node.source, ...(node.parent === undefined ? {} : { parent: node.parent }),
        schemaVersion: "archcontext.node/v2", name: node.id, status: "active", summary: "Fixture ownership."
      }));
    }
    write(`.archcontext/model/constraints/${constraintId}.yaml`, stableYaml({
      schemaVersion: "archcontext.constraint/v1", id: constraintId, name: "Public contract boundary", severity: "error",
      rationale: "The consumer may use the public contract.", scope: { nodes: ["module.consumer"] },
      rule: { type: "forbid-dependency", targets: ["capability.runtime"], allowedTargets: [options.allowedTarget ?? contract] }
    }));
    write("consumer/index.ts", `import { target } from "../${options.targetPath}";\nexport const consumer = target;\n`);
    write(options.targetPath, "export const target = 1;\n");
    write(".gitignore", ".codegraph/\n.state/\n");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: root });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "fixture");
    if (options.allowedTarget === undefined) {
      const invocation = codeGraphCliInvocation("codegraph", root);
      execFileSync(invocation.command, [...invocation.argsPrefix, "init", root], { cwd: root, env: { ...process.env, CODEGRAPH_TELEMETRY: "0" } });
    }
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test("constraints check allows imports owned by the public contract", () => {
  return withFixture({ targetPath: contractPath }, root => {
    expect(runConstraintCheckCommand(root)).toMatchObject({ ok: true, data: {
      status: "pass", coverage: "complete", importEdgeCount: 1, reasonCodes: [], violations: []
    } });
  });
}, 60_000);

test.each([
  ["sibling internal ownership", internalPath, false],
  ["contract and internal co-ownership", contractPath, true]
] as const)("constraints check reports %s as a violation", (_label, targetPath, contested) => {
  return withFixture({ targetPath, contested }, root => {
    expect(runConstraintCheckCommand(root)).toMatchObject({ ok: true, data: {
      status: "violated", coverage: "complete", reasonCodes: [],
      violations: [{ constraintId, fromPath: "consumer/index.ts", toPath: targetPath, toNode: internal }]
    } });
  });
}, 60_000);

test("constraints check marks a resolved unowned target as undetermined", () => {
  return withFixture({ targetPath: unownedPath }, root => {
    expect(runConstraintCheckCommand(root)).toMatchObject({ ok: true, data: {
      status: "undetermined", coverage: "complete", reasonCodes: ["forbid-target-unowned"],
      importEdgeCount: 1, unresolvedImports: [], violations: []
    } });
  });
}, 60_000);

test("constraints check and archctx validate reject an allowed target outside the forbidden subtree", () => {
  return withFixture({ targetPath: contractPath, allowedTarget: "module.consumer" }, async root => {
    const failure = { ok: false, error: { code: "AC_SCHEMA_INVALID", reasonCode: "constraint-model-invalid", details: { issueCount: 1 } } };
    expect(runConstraintCheckCommand(root)).toMatchObject(failure);

    const cli = resolve(import.meta.dir, "../../../surfaces/cli/bin/archctx");
    const env = { ...process.env, ARCHCONTEXT_STATE_DIR: join(root, ".state") };
    const { workspaceStateDir, daemonConnectionPath, daemonLockPath } = runtimeStatePaths(root, env);
    try {
      const result = spawnSync("bun", [cli, "validate", "--json"], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject(failure);
    } finally {
      // Validate leaves the shared daemon running, and its open state files pin the fixture on Windows.
      const client = createRuntimeRpcClientFromWorkspaceStateDir(workspaceStateDir);
      if (client) {
        const { pid } = client.connectionInfo();
        expect(await client.shutdown()).toMatchObject({ ok: true });
        // Shutdown acknowledges the request before the daemon closes its files and exits.
        const deadline = Date.now() + 5_000;
        while (isProcessAlive(pid) && Date.now() < deadline) await Bun.sleep(50);
        expect(isProcessAlive(pid), `fixture daemon ${pid} should have exited`).toBe(false);
      }
      expect(existsSync(daemonConnectionPath)).toBe(false);
      expect(existsSync(daemonLockPath)).toBe(false);
    }
  });
}, 60_000);
