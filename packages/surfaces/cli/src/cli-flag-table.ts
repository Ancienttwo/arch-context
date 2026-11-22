import {
  PROJECTION_PUBLISH_BOOLEAN_FLAGS,
  PROJECTION_PUBLISH_STATUS_VALUE_FLAGS,
  PROJECTION_PUBLISH_VALUE_FLAGS,
  PROJECTION_VERIFY_PR_VALUE_FLAGS
} from "./cli-types";

export const GLOBAL_VALUE_FLAGS = ["--format"] as const;
export const GLOBAL_BOOLEAN_FLAGS = ["--json"] as const;

export interface CliFlagSpec {
  value: readonly string[];
  boolean: readonly string[];
}

/**
 * Every flag each command accepts besides the global `--format <value>`, `--json` and `--help`/`-h`.
 * `preflightCliArguments` checks the whole command line against it before any handler runs (#182, #322).
 */
export const CLI_COMMAND_FLAGS: Readonly<Record<string, CliFlagSpec & { subcommands?: Readonly<Record<string, CliFlagSpec>> }>> = {
  "check": { value: ["--base", "--changed", "--changed-path"], boolean: ["--slice"] },
  "debt": { value: ["--changed-path", "--base"], boolean: ["--complete"] },
  "agent-context": { value: ["--expected-worktree-digest", "--id", "--task-session-id"], boolean: ["--approved"] },
  "apply": { value: ["--expected-worktree-digest", "--id"], boolean: ["--approved"] },
  "checkpoint": { value: ["--changed-path"], boolean: [] },
  "complete": { value: ["--head-sha", "--posture", "--task", "--task-session-id"], boolean: [] },
  "constraints": { value: [], boolean: [] },
  "context": { value: ["--max-symbols", "--name", "--path", "--task"], boolean: ["--landscape"] },
  "deps": { value: ["--edge-limit", "--from", "--import-node-limit", "--into"], boolean: [] },
  "doctor": { value: [], boolean: ["--check-updates"] },
  "explore": {
    value: [],
    boolean: [],
    subcommands: {
      status: { value: [], boolean: [] },
      stop: { value: [], boolean: [] },
      revoke: { value: [], boolean: [] },
      contract: { value: ["--token-ttl-seconds"], boolean: [] },
      start: { value: ["--port", "--token-ttl-seconds"], boolean: ["--foreground"] },
      projection: { value: ["--depth", "--expand", "--expected-graph-digest", "--expected-head-sha", "--expected-observed-facts-digest", "--expected-worktree-digest", "--focus", "--level", "--max-nodes", "--max-relations", "--task-session-id", "--view"], boolean: [] },
      delta: { value: ["--base-event-id", "--base-projection-digest", "--head-event-id", "--head-projection-digest"], boolean: [] }
    }
  },
  "export": { value: [], boolean: [] },
  "flows": { value: [], boolean: ["--no-sync"] },
  "hash": { value: ["--path"], boolean: [] },
  "hook": {
    value: [],
    boolean: [],
    subcommands: {
      checkpoint: { value: ["--changed-path", "--event"], boolean: [] }
    }
  },
  "hooks": { value: ["--host"], boolean: ["--generated-projection"] },
  "init": { value: ["--name"], boolean: ["--infer", "--model-only", "--no-hooks", "--no-skills", "--no-instructions"] },
  "install": { value: ["--host"], boolean: [] },
  "landscape": { value: [], boolean: [] },
  "manifest": { value: ["--decisions", "--id", "--layers"], boolean: [] },
  "model": {
    value: [],
    boolean: [],
    subcommands: {
      validate: { value: [], boolean: [] },
      resolve: { value: ["--path", "--paths-from"], boolean: [] },
      export: { value: ["--profile", "--ref"], boolean: ["--worktree"] },
      history: { value: ["--limit", "--offset", "--ref"], boolean: [] },
      show: { value: ["--id"], boolean: [] }
    }
  },
  "paths": { value: [], boolean: [] },
  "plan": { value: ["--body", "--body-file", "--expected-hash", "--id", "--op", "--operations-file", "--path"], boolean: [] },
  "practices": {
    value: [],
    boolean: [],
    subcommands: {
      checkpoint: { value: ["--changed", "--event", "--expected-head-sha", "--expected-worktree-digest", "--head-sha", "--max-bytes", "--max-items", "--path", "--task", "--task-session-id", "--tool-call-id"], boolean: [] },
      list: { value: ["--category", "--source"], boolean: [] },
      show: { value: ["--id"], boolean: [] },
      validate: { value: [], boolean: ["--strict"] },
      sources: { value: [], boolean: [] },
      waivers: { value: [], boolean: [] },
      waive: { value: ["--check-id", "--created-at", "--evidence-digest", "--expires-at", "--id", "--owner", "--path-glob", "--practice-id", "--reason", "--review-at", "--subject", "--task-session-id", "--waiver-id"], boolean: [] }
    }
  },
  "prepare": { value: ["--max-bytes", "--max-items", "--task", "--task-session-id"], boolean: [] },
  "projection": {
    value: ["--request-json"],
    boolean: [],
    subcommands: {
      run: { value: ["--request-json"], boolean: [] },
      snapshot: { value: [], boolean: [] },
      freshness: { value: [], boolean: [] },
      slice: { value: ["--base", "--changed-path"], boolean: [] },
      publish: { value: PROJECTION_PUBLISH_VALUE_FLAGS, boolean: PROJECTION_PUBLISH_BOOLEAN_FLAGS },
      "publish-status": { value: PROJECTION_PUBLISH_STATUS_VALUE_FLAGS, boolean: [] },
      "verify-pr": { value: PROJECTION_VERIFY_PR_VALUE_FLAGS, boolean: [] }
    }
  },
  "recommendations": {
    value: [],
    boolean: [],
    subcommands: {
      metrics: { value: ["--now"], boolean: [] },
      show: { value: ["--id", "--import-node-limit", "--recommendation-id"], boolean: [] },
      list: { value: ["--status"], boolean: [] },
      acknowledge: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] },
      accept: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--snapshot-digest", "--source"], boolean: [] },
      reject: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--snapshot-digest", "--source"], boolean: [] },
      defer: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--snapshot-digest", "--source"], boolean: [] },
      waive: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] },
      resolve: { value: ["--actor", "--actor-kind", "--agent-job-id", "--evidence-digest", "--expected-worktree-digest", "--id", "--import-node-limit", "--now", "--reason", "--recommendation-id", "--source"], boolean: [] }
    }
  },
  "refactor": {
    value: ["--assessment-digest", "--expected-worktree-digest", "--import-node-limit", "--request-json"],
    boolean: ["--selection"],
    subcommands: {
      scan: { value: ["--import-node-limit", "--node", "--path", "--request-json"], boolean: [] },
      simulate: {
        value: [
          "--expected-head-sha",
          "--expected-worktree-digest",
          "--import-node-limit",
          "--move",
          "--request-file",
          "--request-json",
          "--target"
        ],
        boolean: []
      }
    }
  },
  "scan": {
    value: ["--import-node-limit", "--node", "--path", "--paths", "--scope"],
    boolean: [],
    subcommands: {
      simulate: {
        value: [
          "--expected-head-sha",
          "--expected-worktree-digest",
          "--import-node-limit",
          "--move",
          "--request-file",
          "--request-json",
          "--target"
        ],
        boolean: []
      }
    }
  },
  "decide": {
    value: [],
    boolean: [],
    subcommands: {
      list: { value: ["--import-node-limit", "--status"], boolean: [] },
      show: { value: ["--id", "--import-node-limit", "--recommendation-id"], boolean: [] },
      accept: { value: ["--actor", "--id", "--import-node-limit", "--kill-path", "--kill-relation", "--kill-symbol", "--reason", "--recommendation-id"], boolean: [] },
      defer: { value: ["--actor", "--id", "--import-node-limit", "--reason", "--recommendation-id"], boolean: [] },
      reject: { value: ["--actor", "--id", "--import-node-limit", "--reason", "--recommendation-id"], boolean: [] },
      waive: { value: ["--actor", "--id", "--import-node-limit", "--reason", "--recommendation-id"], boolean: [] },
      acknowledge: { value: ["--actor", "--id", "--import-node-limit", "--reason", "--recommendation-id"], boolean: [] },
      resolve: { value: ["--actor", "--id", "--import-node-limit", "--reason", "--recommendation-id", "--resolution-digest"], boolean: [] }
    }
  },
  "verify": { value: ["--id", "--import-node-limit", "--recommendation-id"], boolean: [] },
  "repo": { value: ["--name", "--repository-id", "--root"], boolean: [] },
  "resolve": { value: ["--path", "--paths-from"], boolean: [] },
  "impact": { value: ["--base", "--head", "--depth", "--paths-from"], boolean: [] },
  "history": { value: ["--ref", "--format", "--offset", "--limit"], boolean: [] },
  "review": { value: ["--head-sha", "--posture", "--task", "--task-session-id"], boolean: [] },
  "index": { value: [], boolean: [], subcommands: { seed: { value: ["--timeout-ms"], boolean: [] } } },
  "state-machines": { value: [], boolean: [] },
  "status": { value: [], boolean: [] },
  "sync": { value: ["--changed"], boolean: ["--check", "--no-instructions"] },
  "uninstall": { value: ["--content", "--host"], boolean: [] },
  "update": { value: [], boolean: ["--check"] },
  "validate": { value: [], boolean: [] },
  "capabilities": { value: [], boolean: [] },
  "docs": {
    value: ["--accepted-change-set-id", "--accepted-event-id", "--adoption-plan-id", "--affected-node", "--expected-worktree-digest", "--id", "--intent", "--library", "--library-id", "--major-reason", "--profile", "--query", "--task-session-id", "--version"],
    boolean: ["--all", "--allow-network", "--approved", "--force-refresh"],
    subcommands: { anchors: { value: ["--profile"], boolean: [] } }
  },
  "help": { value: [], boolean: [] }
};
