import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listGitVisibleFiles
} from "@archcontext/local-runtime/git-adapter";
import {
  readRepositoryStructuralFacts,
  verifySymbolKillList
} from "../src/index";
import { indexCodeGraphFixture, syncCodeGraphFixture } from "./real-index";

function createIndexedRepo(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "archctx-structural-facts-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), ".codegraph/\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src/a.ts"),
    [
      'import { ext } from "./b";',
      "export class Svc { run() { return ext(); } }",
      "export function alpha() { return beta() + ext(); }",
      "export function beta() { return 1; }",
      "export function gamma() { return 2; }",
      ""
    ].join("\n")
  );
  writeFileSync(
    join(root, "src/b.ts"),
    ["export function ext() { return 3; }", "export function helper() { return 4; }", ""].join("\n")
  );
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "fixture"
    ],
    { cwd: root }
  );
  indexCodeGraphFixture(root);
  return root;
}

describe("codegraph structural facts & 3-state symbol killList", () => {
  test("extracts cross-file calls, intra-file symbol clusters, and call-edge limit truncation", () => {
    const root = createIndexedRepo();
    try {
      const tracked = listGitVisibleFiles(root);
      const facts = readRepositoryStructuralFacts(root, tracked);
      expect(facts.coverage).toBe("complete");
      expect(facts.reasonCodes).toEqual([]);
      expect(facts.callEdgeLimitExceeded).toBe(false);
      expect(facts.callEdges.some((edge) => edge.fromPath === "src/a.ts" && edge.toPath === "src/b.ts" && edge.toSymbol === "ext")).toBe(true);

      const fileA = facts.fileStructures.find((file) => file.path === "src/a.ts");
      expect(fileA).toBeDefined();
      expect(fileA!.lineCount).toBeGreaterThanOrEqual(5);
      expect(fileA!.topLevelSymbols.map((s) => s.name).sort()).toEqual(["Svc", "alpha", "beta", "gamma"]);
      expect(fileA!.intraFileEdges).toContainEqual({ from: "alpha", to: "beta" });

      const capped = readRepositoryStructuralFacts(root, tracked, { callEdgeLimit: 1 });
      expect(capped.coverage).toBe("partial");
      expect(capped.callEdgeLimitExceeded).toBe(true);
      expect(capped.callEdges).toHaveLength(1);
      expect(capped.reasonCodes).toEqual(["code-facts-call-limit"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("enforces 3-state symbol kill-list fail-closed verification (#636 P2 Invariant #1)", () => {
    const root = createIndexedRepo();
    try {
      const tracked = new Set(listGitVisibleFiles(root));

      expect(
        verifySymbolKillList(root, ["src/b.ts#ext", "src/a.ts#Svc::run", "src/b.ts#missing"], {
          codeFactsReady: true,
          trackedFiles: tracked
        })
      ).toEqual([
        { target: "src/b.ts#ext", status: "present" },
        { target: "src/a.ts#Svc::run", status: "present" },
        { target: "src/b.ts#missing", status: "absent" }
      ]);

      // Bare symbol or traversal target is never collapsed to "absent".
      expect(
        verifySymbolKillList(root, ["ext", "../secret.ts#ext"], {
          codeFactsReady: true,
          trackedFiles: tracked
        })
      ).toEqual([
        { target: "ext", status: "unknown", reasonCode: "kill-list-symbol-ambiguous" },
        { target: "../secret.ts#ext", status: "unknown", reasonCode: "kill-list-symbol-ambiguous" }
      ]);

      // Unready index -> "unknown"
      expect(
        verifySymbolKillList(root, ["src/b.ts#ext"], {
          codeFactsReady: false,
          trackedFiles: tracked
        })
      ).toEqual([{ target: "src/b.ts#ext", status: "unknown", reasonCode: "code-facts-unavailable" }]);

      // Modifying src/b.ts without syncing causes digest mismatch -> "unknown" (never "absent")
      writeFileSync(join(root, "src/b.ts"), "export function ext() { return 99; }\n");
      expect(
        verifySymbolKillList(root, ["src/b.ts#ext"], {
          codeFactsReady: true,
          trackedFiles: tracked
        })
      ).toEqual([{ target: "src/b.ts#ext", status: "unknown", reasonCode: "code-facts-digest-mismatch" }]);

      // Deleting the symbol cleanly and syncing -> "absent"
      writeFileSync(join(root, "src/b.ts"), "export function helper() { return 4; }\n");
      syncCodeGraphFixture(root);
      expect(
        verifySymbolKillList(root, ["src/b.ts#ext"], {
          codeFactsReady: true,
          trackedFiles: tracked
        })
      ).toEqual([{ target: "src/b.ts#ext", status: "absent" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
