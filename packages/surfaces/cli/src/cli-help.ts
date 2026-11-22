import { okEnvelope, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { PROJECTION_PUBLISH_DEFAULT_INTERVAL_SECONDS, PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS } from "./cli-types";

export const CLI_DOCS_ANCHORS_HELP = {
  usage: "archctx docs anchors [--profile default|repo-harness/v1] [--json]",
  description: "Read-only check of citations in human-owned module document regions and node summary/responsibilities. It reports missing-path, missing-symbol, unknown-selector, line-out-of-range and line-moved per node. It is a signal, not a gate: the result stays ok when it has findings.",
  options: {
    "--profile <profile>": "Layout whose module documents are read (default: the committed manifest profile; default without a manifest).",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading the repository."
  },
  writes: "none; no daemon, no local store. Without a CodeGraph index, path and line checks still run and symbol checks are reported as unchecked (codegraph-unavailable).",
  capability: "docs-anchors-v1"
};

export const CLI_PROJECTION_FRESHNESS_HELP = {
  usage: "archctx projection freshness [--json]",
  description: "Render-equivalent freshness of the committed architecture projection: whether any target would render an output other than its committed manifest row, or the manifest itself would change. It runs the projection build that projection check runs, over the committed manifest's profile, so on the same tree it reports check's and complete's answer.",
  options: {
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading the repository."
  },
  writes: "no repository file; no daemon, no local store. It may sync the CodeGraph index, as flows check does. Outside a Git worktree it fails with AC_REPO_NOT_FOUND (git-worktree-required).",
  capability: "projection-freshness-v2"
};

export const CLI_INDEX_SEED_HELP = {
  usage: "archctx index seed [--timeout-ms <ms>] [--json]",
  description: "Explicitly seeds or refreshes the workspace CodeGraph index (.codegraph) decoupled from archctx sync. In the primary worktree, initializes or syncs .codegraph; in a linked worktree, reuses an existing .codegraph non-destructively (already-present) or hardlink-copies the primary worktree's .codegraph (worktree-seed).",
  options: {
    "--timeout-ms <ms>": "Maximum time in milliseconds to wait if the primary worktree .codegraph build is active.",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without touching .codegraph."
  },
  writes: ".codegraph/ only; touches no YAML model, no docs, and no SQLite lock.",
  capability: "index-seed-v1"
};

export const CLI_PROJECTION_PUBLISH_HELP = {
  usage: "archctx projection publish [--base <branch>] [--base-sha <sha>] [--remote <name>] [--branch <archctx/...>] [--publisher gh|command|none] [--publisher-command <executable>] [--accept-observed-major-change] [--follow [--interval <seconds>]] [--json]",
  description: "Projection writer mode. Fetches the remote base tip, resets a writer-owned worktree to it, applies the projection in-process in that worktree, and pushes the result as exactly one commit on top of the base tip to a rolling archctx/* branch, then opens or updates its pull request. Only paths the apply wrote that are projection-owned outputs may change; anything else fails before a commit. One run per remote and base at a time (busy otherwise); the same base SHA is a no-op once published or up to date; a base that moves during the run is re-evaluated and the stale commit is never pushed.",
  options: {
    "--base <branch>": "The branch the projection is computed for (default: main).",
    "--base-sha <sha>": "Publish only for this base commit (40 lowercase hex characters), ending with projection-writer-base-moved when the remote base points elsewhere.",
    "--remote <name>": "The remote to fetch the base from and push the rolling branch to (default: origin).",
    "--branch <archctx/...>": "The rolling branch (default: archctx/projection). It must start with archctx/ and differ from --base; the writer never pushes to any other ref.",
    "--publisher gh|command|none": "gh (default): the operator's own gh lists, then edits or creates the pull request. command: run --publisher-command. none: push only.",
    "--publisher-command <executable>": "With --publisher command: an executable run with no shell or arguments in the owned worktree, with PATH, HOME and ARCHCTX_PUBLISH_REMOTE/BASE/BRANCH/BASE_SHA/COMMIT/TITLE/BODY_FILE only (on Windows also SystemRoot, windir, ComSpec, PATHEXT, TEMP, TMP, USERPROFILE; #! scripts run through their interpreter on PATH; .cmd/.bat are rejected). Optional stdout: a JSON object {url?, number?}.",
    "--accept-observed-major-change": "Accept the major change the run observes (ProjectionRequestV1.acceptObservedMajorChange). Without it a major change stops at human-action-required and nothing is pushed.",
    "--follow": "Run as a foreground loop: one publish per --interval, one JSON envelope line per run on stdout, until SIGINT or SIGTERM. For launchd/systemd KeepAlive on an always-on host.",
    "--interval <seconds>": `With --follow: seconds between runs (default ${PROJECTION_PUBLISH_DEFAULT_INTERVAL_SECONDS}, minimum ${PROJECTION_PUBLISH_MIN_INTERVAL_SECONDS}).`,
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without fetching, pushing or starting a daemon."
  },
  results: "published, up-to-date, already-processed, human-action-required, busy (ok) or failed (ok: false with the run as data).",
  writes: "the writer state, lock and owned worktree under the repository runtime state directory; one commit on the owned worktree; a push to refs/heads/<--branch> only. Outbound: the projection-publishing egress channel (git fetch/ls-remote/push, gh, the publisher command); ARCHCONTEXT_EGRESS_MODE=local-only refuses it with AC_POLICY_VIOLATION. archctx stores no credentials. It never runs codegraph init; when code facts are required, run codegraph init <worktreePath> once (see projection publish-status).",
  capability: "projection-publish-v1"
};

export const CLI_PROJECTION_PUBLISH_STATUS_HELP = {
  usage: "archctx projection publish-status [--base <branch>] [--remote <name>] [--json]",
  description: "Read-only state of the projection writer for one remote and base: the owned worktree path, a running writer's pid, the last processed and last successful base SHAs and the last run.",
  options: {
    "--base <branch>": "Default: main.",
    "--remote <name>": "Default: origin.",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading anything."
  },
  writes: "none; no fetch, no daemon.",
  capability: "projection-publish-v1"
};

export const CLI_PROJECTION_VERIFY_PR_HELP = {
  usage: "archctx projection verify-pr --base <ref> [--json]",
  description: "Checks the checked-out pull request head (HEAD, clean tracked worktree) against --base. A changed path is generated only when it is the projection manifest or a manifest target path at HEAD or at the merge base, and, for a mixed-ownership target, its text outside the generated regions is unchanged (otherwise it is listed in humanEditedPaths); an agent-context row's generated text is its node's region. Only a generated-only diff is rendered (projection check). verdict is no-changes, touches-non-generated (answered from the diff alone, nothing rendered), generated-only-render-equivalent (generated files and regions equal a fresh render and no text outside them changed) or generated-only-not-render-equivalent. A mixed target that is added or deleted, or whose markers do not parse, is conservatively a human edit. The envelope is ok for every valid evaluation; the verdict carries the decision.",
  options: {
    "--base <ref>": "Required. The pull request base, for example origin/main.",
    "--json": "Accepted for symmetry; output is always JSON.",
    "--help, -h": "Show help without reading the repository."
  },
  writes: "none; no daemon, no local store. A dirty tracked worktree fails with AC_PRECONDITION_FAILED. A generated-only diff renders in-process like projection check, so it needs code facts when the manifest requires them.",
  capability: "projection-verify-pr-v1"
};

export const CLI_RESOLVE_HELP = {
  command: "archctx resolve (--path <repo-relative path> | --paths-from <file> | --paths-from -)",
  rule: "ADR-0043. source.exclude applies first. When every matching node lies on one parent chain, the deepest node owns the path; refactor scan uses the same rule. When matching nodes lie on different chains, an ancestor yields to its own descendant, then the longest literal source.include prefix wins, and an equal-length tie is ambiguous.",
  batch: "--paths-from reads one repository-relative POSIX path per line from a file (relative to the current directory) or from stdin (-). Blank lines are ignored and surrounding whitespace is trimmed. The model loads once. data.results has one entry per input path, in input order. The command reads no daemon state and no CodeGraph index.",
  result: "Each result carries path, matched, ambiguous and owningCapabilityId. A match adds stableId, kind, name, source and extensions of the most specific node. An ambiguous result adds candidates. owningCapabilityId is the nearest kind: capability node on the owner's parent chain (the owner itself when it is a capability), or null. For an ambiguous result it is set only when all candidates share one owning capability.",
  exitCodes: "--path: 0 matched, 1 no match or error, 2 ambiguous. --paths-from: 0 when no path is ambiguous (unowned paths included), 2 when any path is ambiguous, 1 on error."
};

export const CLI_DEPS_HELP = {
  command: "archctx deps [--from <node-id>] [--into <node-id>] [--import-node-limit <n>] [--edge-limit <n>] [--json]",
  description: "Read-only capability x capability import matrix. The command reads the model files, the HEAD tree and the CodeGraph index. It writes nothing and needs no daemon.",
  rule: "Each file gets its owners from the parent-chain rule refactor scan uses. Each owner rolls up to the nearest kind: capability node on its parent chain. An edge counts in data.matrix only when both files roll up to exactly one capability. Other edges count in data.imports.unattributed by cause.",
  filters: "--from <node-id> keeps edges whose importing file the node or a descendant owns. --into <node-id> keeps edges whose imported file the node or a descendant owns. An unknown node id is AC_SCHEMA_INVALID.",
  imports: "data.imports reports coverage, reasonCodes, truncated, importNodeCount, importNodeLimit and importNodeLimitExceeded from the CodeGraph import read. A missing or stale index gives coverage unknown and an empty matrix. --import-node-limit sets the read cap (default 64000).",
  calls: "Bounded repository-wide cross-file symbol `calls` and `references` counts up to 128000 edges (reason code code-facts-call-limit on partial reads, or call-edges-not-exposed when omitted).",
  edges: "data.edges lists the attributed file-level edges behind the matrix, sorted by path, up to --edge-limit (default 200). data.edges.count is the full total."
};

export const CLI_PLAN_HELP = {
  command: "archctx plan --id <changeset.id> (--op <create_entity|update_entity_fields|delete_entity> --path <file> [--expected-hash sha256:<64-hex>] [--body <yaml> | --body - | --body-file <path>] | --operations-file <operations.json | ->)",
  operations: "--operations-file takes a repository-relative path to a JSON array of operations in the ChangeSet operations JSON schema, or - to read that array from stdin, and plans them as one ChangeSet; it cannot be combined with --op, --path, --expected-hash, --body or --body-file.",
  body: "--body is the complete new YAML document, not a field patch. Give exactly one of --body <yaml>, --body - (stdin) or --body-file <path>. --body-file and --operations-file read only repository-relative files inside the repository (no absolute or .. paths, no symlinks); content from outside the repository must come through stdin (--body - or --operations-file -). delete_entity accepts no body.",
  expectedHash: "digestJson({ body }) of the file's current UTF-8 contents, not sha256sum of the file. Read it with `archctx hash --path <file>`; use `missing` (the create default) for a new file.",
  drafts: "A draft is cached in the workspace local SQLite cache until applied. Planning the same --id again replaces it.",
  ownershipDelta: "When the plan writes a node file, data.preview.ownershipDelta compares file ownership before and after the planned model over the files the HEAD tree carries, with the parent-chain rule refactor scan uses. becameOwned, becameContested, ownerChanged and becameUnowned each give count, up to 50 files with before and after owners, and omittedCount. status unavailable gives the reason, for example a planned body that does not parse. Read-only.",
  next: "archctx apply --id <changeset.id> --approved --expected-worktree-digest <draft.base.worktreeDigest>"
};

export const CLI_HASH_HELP = {
  command: "archctx hash --path <repo-relative file>",
  formula: "digestJson({ body: <file contents read as UTF-8> }); this is the expected hash a plan operation must carry. It is not sha256sum of the file.",
  scope: "Read-only. The path must be one a ChangeSet may write (for example .archcontext/model/, .archcontext/manifest.yaml or docs/adr/ADR-NNNN-*.md) and the file must exist; symlinks are refused."
};

export const CLI_HELP_COMMANDS = [
  "capabilities", "projection", "init", "index", "sync", "validate", "check", "model",
  "context", "status", "repo", "landscape", "recommendations", "refactor", "scan", "decide",
  "explore", "prepare", "practices", "checkpoint", "hook", "hooks", "plan", "apply", "hash",
  "review", "complete", "manifest", "install", "uninstall", "doctor", "update",
  "paths", "export", "resolve", "impact", "verify", "history", "flows",
  "state-machines", "deps", "constraints", "debt"
] as const;

export const CLI_HELP_EXAMPLES = [
  "archctx check --changed src/app.ts --json",
  "archctx check --base origin/main --slice --json",
  "archctx verify --base origin/main --json",
  "archctx impact --batch-file paths.json --json",
  "archctx impact --base HEAD~1 --head HEAD --json",
  "archctx init --name MyApp",
  "archctx init --infer --model-only --json",
  "archctx index seed --json",
  "archctx sync --json",
  "archctx sync --check --no-instructions --json",
  "archctx model validate --json",
  "archctx model resolve --path packages/core/projection-engine/src/index.ts",
  "archctx model export native --worktree --json",
  "archctx context --path src/app.ts --json",
  "archctx projection run --request-json '{...}'",
  "archctx projection snapshot --json",
  "archctx projection freshness --json",
  "archctx projection publish --json",
  "archctx projection publish --publisher none --json",
  "archctx projection publish --follow --interval 300",
  "archctx projection publish-status --json",
  "archctx projection verify-pr --base origin/main --json",
  "archctx plan --id changeset.<id> --op update_entity_fields --path .archcontext/model/nodes/<node>.yaml --expected-hash sha256:<64-hex> --body '<complete YAML>'",
  "archctx plan --id changeset.<id> --op delete_entity --path .archcontext/model/flows/<flow>.yaml --expected-hash sha256:<64-hex>",
  "archctx hash --path .archcontext/model/nodes/<node>.yaml",
  "archctx plan --id changeset.<id> --operations-file <operations.json>",
  "archctx plan --id changeset.<id> --op update_entity_fields --path .archcontext/model/nodes/<node>.yaml --expected-hash sha256:<64-hex> --body-file <entity.yaml>",
  "archctx apply --id changeset.<id> --approved --expected-worktree-digest <draft.base.worktreeDigest>",
  "archctx recommendations accept --id recommendation.<id> --reason 'Accepted after local review.'",
  "archctx recommendations metrics",
  "archctx recommendations list --status rejected",
  "archctx refactor scan --json",
  "archctx refactor verify --request-json '{...}' --json",
  "archctx practices validate --strict",
  "archctx practices list --json",
  "archctx practices waivers",
  "archctx practices waive --practice-id modularity.no-new-cycle --owner team-architecture --reason 'External migration window requires this edge until cutover.' --review-at 2026-07-10T00:00:00.000Z --expires-at 2026-07-24T00:00:00.000Z --evidence-digest sha256:<64-hex> --subject module.a->module.b",
  "archctx checkpoint --changed-path src/app.ts",
  "archctx practices checkpoint --task-session-id task_cli",
  "archctx hook checkpoint --event post-edit --changed-path src/app.ts",
  "archctx hooks install --host codex",
  "archctx paths",
  "archctx update --check",
  "archctx doctor --check-updates",
  "archctx explore start --foreground",
  "archctx docs anchors --json",
  "archctx export native --worktree --json",
  "archctx export native --ref HEAD --profile repo-harness/v1 --json",
  "archctx resolve --path packages/core/projection-engine/src/index.ts",
  "archctx refactor scan --import-node-limit 100000 --json",
  "archctx resolve --paths-from changed-paths.txt",
  "archctx flows check --json",
  "archctx state-machines check --json",
  "archctx recommendations defer --id recommendation.<id> --import-node-limit 100000 --reason 'Scanned with the same limit.'",
  "archctx deps --json",
  "archctx deps --into capability.<id> --json"
];

export function generalHelpEnvelope(): JsonEnvelope {
  return {
    schemaVersion: "archcontext.envelope/v1",
    ok: true,
    requestId: "help",
    data: {
      commands: [...CLI_HELP_COMMANDS],
      examples: CLI_HELP_EXAMPLES
    }
  };
}

/**
 * `--help`/`-h` for every command, answered by `preflightCliArguments` before any handler runs, so
 * help never performs mutations or starts unnecessary state (#182, #322).
 */
export function cliHelpEnvelope(command: string, args: string[]): JsonEnvelope {
  const subcommand = args[0];
  switch (command) {
  case "init":
    return okEnvelope("help", {
      command: "archctx init",
      usage: "archctx init [--name <product-name>] [--infer] [--model-only] [--no-hooks] [--no-skills] [--no-instructions]",
      description: "Initialize the repository architecture model under .archcontext/.",
      options: {
        "--name <product-name>": "Product name (default: ArchContext Project).",
        "--infer": "Deterministically infer initial capability boundaries from workspace directories.",
        "--model-only": "Shorthand for --no-hooks --no-skills --no-instructions; persists projection.instructions: false in manifest.yaml.",
        "--no-hooks": "Do not install or configure host hooks.",
        "--no-skills": "Do not install or modify skill files.",
        "--no-instructions": "Disable AGENTS.md/CLAUDE.md instruction-block projection in manifest.yaml.",
        "--help, -h": "Show help without initializing the repository."
      }
    });
  case "sync":
    return okEnvelope("help", {
      command: "archctx sync",
      usage: "archctx sync [--check] [--no-instructions] [--changed <path>...] [--json]",
      description: "Compile or check generated architecture documentation projections in-process.",
      options: {
        "--check": "Read-only freshness check; exits 0 when fresh, 2 when drifted/pending, 1 on error.",
        "--no-instructions": "Skip AGENTS.md/CLAUDE.md agent-context targets (surface existing regions as human-review orphans instead of overwriting).",
        "--changed <path>": "Optional changed path hint.",
        "--json": "Accepted for symmetry; output is always JSON."
      }
    });
  case "check":
    return okEnvelope("help", {
      command: "archctx check",
      usage: ["archctx check --changed <path>... [--json]", "archctx check --base <ref> [--slice] [--json]"],
      schemaVersion: "archcontext.cli-check/v1",
      description: "Unified read-only architecture check gate. Use --changed for fast edit-time checks or --base for composite PR verification.",
      exitCodes: "0 pass, 2 findings/blocking issues, 1 invalid input or execution failure.",
      capability: "cli-check-v1"
    });
  case "model":
    return okEnvelope("help", {
      command: "archctx model",
      usage: "archctx model <validate|resolve|export|history|show> [options] [--json]",
      description: "Read-only model query and validation namespace."
    });
  case "plan":
    return okEnvelope("plan", CLI_PLAN_HELP as unknown as Json);
  case "hash":
    return okEnvelope("hash", CLI_HASH_HELP as unknown as Json);
  case "manifest":
    return okEnvelope("manifest", {
      command: "archctx manifest plan --id <changeset.id> [--decisions docs/adr] [--layers cli,effects,core]",
      supportedFields: { "content.decisions": "docs/adr", "model.layers": "non-empty unique ordered layer slugs, top layer first" },
      writes: "none; approve the returned ChangeSet with archctx apply"
    });
  case "resolve":
    return okEnvelope("resolve", CLI_RESOLVE_HELP as unknown as Json);
  case "index":
    if (subcommand === "seed") return okEnvelope("help", CLI_INDEX_SEED_HELP as unknown as Json);
    break;
  case "practices":
    if (subcommand === "checkpoint") return okEnvelope("help", {
      usage: "archctx practices checkpoint [--task-session-id <id>] [--task <text>] [--event <event>] [--path <path>]... [--changed <path>]... [--expected-head-sha <sha>] [--expected-worktree-digest <digest>] [--tool-call-id <id>] [--max-bytes <bytes>] [--max-items <items>] [--json]",
      schemaVersion: "archcontext.practice-checkpoint/v1",
      writes: "daemon-owned practice baseline; prepare seeds the initial baseline",
      description: "Explicit practice writer. Preserves stale context, failure and event coalescing; edit-time debt reads use checkpoint instead."
    });
    break;
  case "hook":
    if (subcommand === "checkpoint") return okEnvelope("help", {
      usage: "archctx hook checkpoint [--event <event>] [--changed-path <path>]... [--json]",
      schemaVersion: "archcontext.hook-debt-checkpoint/v1",
      writes: "none; no runtime or baseline access on success or failure",
      description: "Read-only debt hook with redacted logging. Producer failures fail open with unknown coverage and a typed error; invalid arguments are rejected."
    });
    break;
  case "debt":
    return okEnvelope("help", {
      command: "archctx debt",
      usage: ["archctx debt [--changed-path <path>]... [--json]", "archctx debt [--base <ref>] [--complete] [--json]"],
      schemaVersion: "archcontext.architecture-debt/v1",
      deltaSchemaVersion: "archcontext.architecture-debt-delta/v1",
      description: "Measure the current working tree. --base compares it with a committed Git revision. --complete also reads dependency and flow evidence from CodeGraph. Coverage gaps are reported for each side. Use a full head checkout for delta measurements.",
      writes: "With --base, caches the committed measurement in local SQLite and uses a temporary detached worktree on a cache miss. Runs without starting a daemon."
    });
  case "checkpoint":
    return okEnvelope("help", {
      command: `archctx ${command}`,
      usage: `archctx ${command} [--changed-path <path>]... [--json]`,
      schemaVersion: "archcontext.architecture-debt/v1",
      description: "Edit-time ownership and human citation debt for changed paths. Dependency, flow and practice checks are explicit coverage gaps reserved for complete; no source byte stamp is debt.",
      writes: "none; no daemon, runtime state, rendering or CodeGraph sync"
    });
  case "refactor":
    if (subcommand === "scan") return okEnvelope("help", {
      usage: "archctx refactor scan [--node <nodeId> | --path <repo-relative-file> ... | --request-json <request>] [--import-node-limit <n>] [--json]",
      description: "Measure structure and return fresh candidates alongside open refactor recommendations. Node scans include descendants. Node and path scans read selected files and their direct import neighbors.",
      snapshotDigest: "Pass data.snapshotDigest to recommendations accept, defer or reject while the snapshot is available in the local store."
    });
    if (subcommand === "simulate") return okEnvelope("help", {
      usage: "archctx refactor simulate [--move <path:toNodeId[:sym1,sym2]>]... [--target <subject>] [--request-file <path>] [--import-node-limit <n>] [--json]",
      description: "Read-only impact simulation preview (#638): computes cycle and direction-violation deltas for whole-file moves; reports honest unmeasured status for symbol subsets and extract/invert strategies.",
      writes: "none"
    });
    break;
  case "scan":
    return okEnvelope("help", {
      usage: "archctx scan [--scope repository|node|paths] [--node <nodeId>] [--path <file>...] [--import-node-limit <n>] [--json]",
      description: "Pure-Git Stage 5 refactor radar scan (#643): runs AST/symbol cohesion, entrypoint-bypass, instability, cycle, purity, and bounded Git co-change detectors with zero daemon or SQLite ledger writes.",
      writes: "none"
    });
  case "decide":
    return okEnvelope("help", {
      usage: "archctx decide <list|show|accept|defer|reject|waive|acknowledge|resolve> [<id>] [--status <status>] [--reason <text>] [--kill-symbol <path#sym>] [--resolution-digest <sha256>] [--json]",
      description: "Pure-Git decision authority (#643): lists, inspects, records, and resolves human refactor decisions in .archcontext/refactor-decisions/ with clean-clone verification metadata."
    });
  case "recommendations":
    if (subcommand === "accept" || subcommand === "defer" || subcommand === "reject") return okEnvelope("help", {
      usage: `archctx recommendations ${subcommand} --id <recommendationId> --reason <text> [--snapshot-digest <sha256:digest>]`,
      snapshotDigest: "The top-level digest from refactor scan. For a fresh candidate, reuse the scan scope and import limit without re-measuring."
    });
    break;
  case "deps":
    return okEnvelope("deps", CLI_DEPS_HELP as unknown as Json);
  case "constraints":
    return okEnvelope("constraints.check", {
      command: "archctx constraints check --json",
      description: "Evaluate declared dependency constraints in-process using the current model and existing CodeGraph index. No daemon or runtime-state writes.",
      result: "data.status is pass, violated, undetermined or not-applicable. Missing or incomplete code facts remain undetermined; unsupported rules appear in data.warnings.",
      exitCode: "0 means the query succeeded; inspect data.status for the constraint verdict. Invalid input or model declarations exit 1."
    });
  case "flows":
    return okEnvelope("flows", {
      command: "archctx flows check [--no-sync] [--json]",
      description: "Check every declared flow selector against the CodeGraph index without rendering a projection.",
      statuses: "Each selector reports proven, no-direct-call, only-references, false-builtin-call, ambiguous-symbol, evidence-missing or evidence-truncated. Only proven binds a flow step.",
      writes: "Default: runs codegraph sync and writes the .codegraph index. With --no-sync: no checkout or index writes; the existing index is read in-process through one read-only session (ADR-0058). Neither mode starts a daemon or task session.",
      noSync: "Requires a complete existing index matching the source population. A missing, unreadable, stale or partial index, or one a build is still writing, fails closed with AC_CODE_FACTS_UNAVAILABLE."
    });
  case "state-machines":
    return okEnvelope("state-machines", {
      command: "archctx state-machines check [--json]",
      description: "Check every state machine declared as a direct child of .archcontext/model/state-machines/ (archctx validate rejects a model file in a subdirectory): each never and final rule, unreachable states, dead steps and deadlocks, and the code anchor of every region and event source.",
      result: "Each broken rule carries its shortest path from the initial state; each holding rule lists the guards that protect it. A rule with a finding reports finding-open or finding-resolved. Each anchor reports its status against the current file.",
      writes: "None. Reads the model and the files that a source names; starts no daemon or task session. An anchor that names a symbol reads the CodeGraph index read-only and reports unchecked when no index is available."
    });
  case "docs":
    if (subcommand === "anchors") return okEnvelope("help", CLI_DOCS_ANCHORS_HELP as unknown as Json);
    break;
  case "projection":
    if (subcommand === "freshness") return okEnvelope("help", CLI_PROJECTION_FRESHNESS_HELP as unknown as Json);
    if (subcommand === "slice") return okEnvelope("help", {
      usage: "archctx projection slice --base <ref> [--changed-path <path>...] [--format json|markdown]",
      description: "Compare the merge base and HEAD. Print highlighted capability diagrams and entrypoint anchors for a pull request.",
      schemaVersion: "archcontext.projection-slice/v1",
      requirements: "A clean tracked worktree and a ready existing CodeGraph index. Extra changed paths only select scope. The command writes no files."
    });
    if (subcommand === "publish") return okEnvelope("help", CLI_PROJECTION_PUBLISH_HELP as unknown as Json);
    if (subcommand === "publish-status") return okEnvelope("help", CLI_PROJECTION_PUBLISH_STATUS_HELP as unknown as Json);
    if (subcommand === "verify-pr") return okEnvelope("help", CLI_PROJECTION_VERIFY_PR_HELP as unknown as Json);
    break;
  }
  return okEnvelope("help", {
    command: `archctx ${command}`,
    description: `archctx ${command} has no dedicated help text. --help never runs it or starts the local runtime; run archctx help for every command.`,
    examples: CLI_HELP_EXAMPLES.filter((example) => example === `archctx ${command}` || example.startsWith(`archctx ${command} `))
  });
}
