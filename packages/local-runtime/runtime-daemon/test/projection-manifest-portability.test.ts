import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableYaml } from "@archcontext/contracts";
import { initializeArchContextModel } from "@archcontext/local-runtime/model-store-yaml";
import { declareOptionalCodeFacts } from "@archcontext/local-runtime/test/codegraph-factories";
import { buildArchitectureDocsProjection } from "../src/projection-service";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** One committed repository whose capability declares `app/**`, with build output and logs ignored. */
function createOrigin(parent: string): string {
  const root = join(parent, "origin");
  mkdirSync(join(root, "app/src"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# portability fixture\n", "utf8");
  writeFileSync(join(root, ".gitignore"), "app/dist/\n*.log\n.codegraph/\n", "utf8");
  writeFileSync(join(root, "app/src/index.ts"), "import { helper } from \"./helper\";\nexport const app = helper();\n", "utf8");
  writeFileSync(join(root, "app/src/helper.ts"), "export function helper(): number {\n  return 1;\n}\n", "utf8");
  initializeArchContextModel(root, "Portability App");
  declareOptionalCodeFacts(root);
  writeFileSync(join(root, ".archcontext/model/nodes/capability.app.yaml"), stableYaml({
    schemaVersion: "archcontext.node/v2",
    id: "capability.app",
    kind: "capability",
    name: "App",
    status: "active",
    summary: "Serves the application.",
    source: { include: ["app/**"] }
  }), "utf8");
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "-c", "user.name=ArchContext Test", "-c", "user.email=archcontext@example.test", "commit", "-q", "-m", "portability fixture");
  return root;
}

function checkout(origin: string, path: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  execFileSync("git", ["clone", "--quiet", origin, path], { stdio: ["ignore", "pipe", "pipe"] });
  return path;
}

test("the same commit projected from two checkout paths, with and without a CodeGraph index and with ignored build output, writes byte-equal committed outputs (#277)", () => {
  const parent = mkdtempSync(join(tmpdir(), "archctx-manifest-portability-"));
  try {
    const origin = createOrigin(parent);
    const head = git(origin, "rev-parse", "HEAD");
    // Indexed checkout with ignored build output and a log under `source.include`.
    const indexed = checkout(origin, join(parent, "machine-a", "work", "repo"));
    execFileSync("codegraph", ["init", indexed], { cwd: indexed, stdio: ["ignore", "pipe", "pipe"] });
    mkdirSync(join(indexed, "app/dist"), { recursive: true });
    writeFileSync(join(indexed, "app/dist/bundle.js"), "console.log('built');\n", "utf8");
    writeFileSync(join(indexed, "app/src/build.log"), "built\n", "utf8");
    // A second indexed checkout at another path, indexed at another time.
    const indexedElsewhere = checkout(origin, join(parent, "machine-b", "deeper", "checkout", "path"));
    execFileSync("codegraph", ["init", indexedElsewhere], { cwd: indexedElsewhere, stdio: ["ignore", "pipe", "pipe"] });
    // A checkout where `codegraph init` never ran.
    const unindexed = checkout(origin, join(parent, "machine-c"));

    const project = (root: string) => {
      expect(git(root, "rev-parse", "HEAD")).toBe(head);
      return buildArchitectureDocsProjection(undefined, root, new Date(0).toISOString());
    };
    const a = project(indexed);
    const b = project(indexedElsewhere);
    const c = project(unindexed);

    // The runtime snapshots really differ between the machines...
    expect(a.runtimeSnapshot.codeGraphStatus).toBe("ready");
    expect(b.runtimeSnapshot.codeGraphStatus).toBe("ready");
    expect(c.runtimeSnapshot.codeGraphStatus).toBe("unavailable");
    expect(a.runtimeSnapshot.indexedWorktreeDigest).not.toBe(b.runtimeSnapshot.indexedWorktreeDigest);
    expect(c.runtimeSnapshot.indexedWorktreeDigest).toBeNull();
    expect(a.runtimeSnapshot.codeGraphDigest).not.toBe(c.runtimeSnapshot.codeGraphDigest);

    // ...but every committed output, manifest included, is byte-equal.
    const committed = (projection: ReturnType<typeof project>) =>
      projection.files.map(({ path, body }) => ({ path, body })).sort((left, right) => left.path.localeCompare(right.path));
    expect(a.manifest.body).toBe(c.manifest.body);
    expect(b.manifest.body).toBe(c.manifest.body);
    expect(committed(a)).toEqual(committed(c));
    expect(committed(b)).toEqual(committed(c));
    const manifest = JSON.parse(a.manifest.body);
    expect(manifest.provenance.schemaVersion).toBe("archcontext.architecture-docs-projection-provenance/v3");
    expect(manifest.targets.find((target: { scope: { id: string } }) => target.scope.id === "capability.app").sourceFootprintDigest)
      .toMatch(/^sha256:[a-f0-9]{64}$/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}, 120_000);
