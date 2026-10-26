import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import { stableYaml } from "@archcontext/contracts";
import { YamlModelStore } from "../src/index";
import { runProjectionCheckCommand } from "../../runtime-daemon/src/projection-service";
import { doctorManifest } from "../../../surfaces/cli/src/main";
import { createNativeFixture, writeFixtureFile } from "./fixtures/native-context/fixture";

test("validation and doctor report exactly one actionable decisions warning", async () => {
  const fixture = createNativeFixture();
  try {
    const path = ".archcontext/manifest.yaml";
    const manifest = parseJsonOrStableYaml(readFileSync(join(fixture.root, path), "utf8"), path) as Record<string, any>;
    manifest.content = { decisions: ".archcontext/decisions" };
    writeFixtureFile(fixture.root, path, stableYaml(manifest));
    const result = await new YamlModelStore().validateModel({ root: fixture.root, repositoryId: "repo.test", headSha: fixture.commit });
    const warnings = result.warnings!.filter(value => value.startsWith("manifest-decisions-unsupported:"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("archctx manifest plan --id <changeset.id> --decisions docs/adr");
    expect(doctorManifest(fixture.root).warnings).toEqual(warnings);
    const check = runProjectionCheckCommand({ mode: "check" } as any, fixture.root);
    expect(check).toMatchObject({ ok: false, error: { reasonCode: "native-context-model-invalid", details: { path, invariant: warnings[0] } } });
    manifest.content.decisions = "docs/adr";
    writeFixtureFile(fixture.root, path, stableYaml(manifest));
    expect(doctorManifest(fixture.root).warnings).toEqual([]);
  } finally { fixture.cleanup(); }
});
