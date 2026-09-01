import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GithubIssueDraftV1 } from "@archcontext/core/agent-orchestrator";

/**
 * The GitHub PAT is threaded through explicitly (never read from `process.env` inside this
 * module) so the real executor's child process env is built from exactly this value plus
 * PATH/HOME, never the daemon's full ambient environment — see `runGh` below.
 */
export interface GithubIssueExecutorEnv {
  GH_TOKEN: string;
}

export interface GithubIssueCreatedRecord {
  number: number;
  url: string;
}

export interface GithubIssueListedRecord {
  number: number;
  url: string;
  body: string;
}

export interface GithubIssueRepoView {
  visibility: string;
}

/**
 * Port for the one write-intent external call this codebase makes: publishing an advisory
 * GitHub issue draft (ADR-0042) via the `gh` CLI. Mirrors investigation-transport.ts's
 * real-vs-fake split — production wiring uses `createNodeGithubIssueExecutor`, tests inject a
 * fake that records calls and never shells out.
 */
export interface GithubIssueExecutorPort {
  /**
   * Deliberately has no `labels` input (ADR-0042 non-goal): label existence on the target repo is
   * never verified, so `gh issue create --label X` fails outright when `X` doesn't exist there,
   * turning one bad label into a whole-draft partial-failure this codebase does not attempt to
   * classify. A draft's `labels` stay visible only via `archctx audit show`, for a human to apply
   * by hand after filing.
   */
  createIssue(input: {
    repo: string;
    title: string;
    bodyFile: string;
    env: GithubIssueExecutorEnv;
  }): Promise<GithubIssueCreatedRecord>;
  repoView(repo: string, env: GithubIssueExecutorEnv): Promise<GithubIssueRepoView>;
  listRecentIssues(repo: string, env: GithubIssueExecutorEnv): Promise<GithubIssueListedRecord[]>;
}

export interface NodeGithubIssueExecutorOptions {
  timeoutMs?: number;
}

const DEFAULT_GH_EXECUTOR_TIMEOUT_MS = 30_000;
const GITHUB_ISSUE_LIST_LIMIT = 100;

/**
 * Real (non-fake) GitHub issue executor. The only place in this codebase that calls `gh` with
 * write intent (`gh issue create`); the read-only probes (`repo view`, `issue list`) live here
 * too so every `gh` invocation this codebase makes shares one safety posture:
 *
 * - No shell (`execFile` with an argv array), so title/body can never be interpreted as shell
 *   syntax.
 * - The PAT never appears in argv: it flows only through the child process's `GH_TOKEN`
 *   environment variable, which `gh` reads directly and prefers over any stored `gh auth login`
 *   session. The child env is reduced to exactly PATH/HOME/GH_TOKEN plus
 *   `GH_PROMPT_DISABLED=1` — never the daemon's full `process.env` — so `gh` can never fall back
 *   to an ambient authenticated session or leak unrelated credentials.
 * - Every call has a hard timeout; `execFile`'s own `timeout` option kills the child on expiry.
 */
export function createNodeGithubIssueExecutor(options: NodeGithubIssueExecutorOptions = {}): GithubIssueExecutorPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GH_EXECUTOR_TIMEOUT_MS;
  return {
    createIssue: (input) => createIssue(input, timeoutMs),
    repoView: (repo, env) => repoView(repo, env, timeoutMs),
    listRecentIssues: (repo, env) => listRecentIssues(repo, env, timeoutMs)
  };
}

async function createIssue(
  input: { repo: string; title: string; bodyFile: string; env: GithubIssueExecutorEnv },
  timeoutMs: number
): Promise<GithubIssueCreatedRecord> {
  // No `--label` args here — see the ADR-0042 non-goal on `GithubIssueExecutorPort.createIssue`.
  const args = ["issue", "create", "--repo", input.repo, "--title", input.title, "--body-file", input.bodyFile];
  const stdout = await runGh(args, input.env, timeoutMs);
  const url = stdout.trim();
  const number = issueNumberFromUrl(url);
  if (number === undefined) throw new Error(`gh issue create returned an unparseable issue URL: ${url}`);
  return { number, url };
}

async function repoView(repo: string, env: GithubIssueExecutorEnv, timeoutMs: number): Promise<GithubIssueRepoView> {
  const stdout = await runGh(["repo", "view", repo, "--json", "visibility"], env, timeoutMs);
  const parsed = JSON.parse(stdout) as { visibility?: unknown };
  if (typeof parsed.visibility !== "string" || parsed.visibility.trim() === "") {
    throw new Error(`gh repo view returned no visibility for ${repo}`);
  }
  return { visibility: parsed.visibility };
}

async function listRecentIssues(repo: string, env: GithubIssueExecutorEnv, timeoutMs: number): Promise<GithubIssueListedRecord[]> {
  const stdout = await runGh(
    ["issue", "list", "--repo", repo, "--state", "all", "--limit", String(GITHUB_ISSUE_LIST_LIMIT), "--json", "number,url,body"],
    env,
    timeoutMs
  );
  const parsed = JSON.parse(stdout) as { number: number; url: string; body?: string }[];
  if (!Array.isArray(parsed)) throw new Error(`gh issue list returned an unexpected shape for ${repo}`);
  return parsed.map((entry) => ({ number: entry.number, url: entry.url, body: entry.body ?? "" }));
}

function issueNumberFromUrl(url: string): number | undefined {
  const match = /\/issues\/(\d+)(?:[/?#]|$)/.exec(url);
  return match ? Number(match[1]) : undefined;
}

/**
 * Strips this call's token literal (and any gh-token-shaped substring, in case a *different*
 * valid token leaked into `gh`'s own output) from an error message before it can reach an error
 * envelope — `auditApprove` forwards `Error.message` into the RPC/CLI error surface verbatim, so
 * whatever `gh` writes to stderr must never carry a credential past this boundary.
 */
function redactGithubSecrets(text: string, token: string): string {
  const withoutToken = token ? text.split(token).join("[REDACTED]") : text;
  return withoutToken.replace(/gh[opsu]_[A-Za-z0-9_]+/g, "[REDACTED]");
}

function runGh(args: string[], env: GithubIssueExecutorEnv, timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "gh",
      args,
      {
        env: {
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
          GH_TOKEN: env.GH_TOKEN,
          GH_PROMPT_DISABLED: "1"
        },
        timeout: timeoutMs,
        encoding: "utf8"
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = redactGithubSecrets(stderr?.trim() || error.message, env.GH_TOKEN);
          rejectPromise(new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${detail}`));
          return;
        }
        resolvePromise(stdout);
      }
    );
  });
}

/**
 * Writes the issue body to a private (0600) temp file outside the audited repository (always
 * under `os.tmpdir()`, never under the repository `root` being audited, so an approve run never
 * writes a file a repo-scoped privacy scanner would associate with the audited repository) and
 * always removes it afterward, success or failure — including when writing the body itself fails,
 * which is why the write happens inside the try rather than before it.
 *
 * `deps.writeFile` defaults to the real `writeFileSync` and exists only so a test can inject a
 * failing write without touching the real filesystem's permissions; production code never passes it.
 */
export async function withGithubIssueBodyFile<T>(
  body: string,
  fn: (bodyFile: string) => Promise<T>,
  deps: { writeFile?: typeof writeFileSync } = {}
): Promise<T> {
  const writeFile = deps.writeFile ?? writeFileSync;
  const dir = mkdtempSync(join(tmpdir(), "archctx-gh-issue-body-"));
  try {
    const bodyFile = join(dir, "body.md");
    writeFile(bodyFile, body, { mode: 0o600 });
    return await fn(bodyFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Value-shape detectors for the publish pre-flight. Each carries a stable `id` so a rejection can
 * name *what* tripped without echoing the matched text (see `preflightGithubIssueDrafts`).
 *
 * Deliberately not shared with `scripts/fg5-retention-staging-readback.ts`, whose own
 * `SECRET_PATTERNS` scans machine-generated retention output rather than human-authored advisory
 * prose: that script lives outside any package boundary, and the two scanners now have different
 * false-positive budgets, so a shared module would couple two unrelated tuning decisions.
 *
 * The `jwt` / `installation_token` *keywords* are not secrets — an architecture audit has to be
 * able to say "validate the JWT audience" or "rotate the installation-token" — so those two
 * detectors match a credential value (compact-token structure, or a value in assignment context)
 * instead of the vocabulary.
 */
const SECRET_DETECTORS = [
  { id: "github-token-prefix", pattern: /gh[opsu]_[A-Za-z0-9_]+/ },
  { id: "bearer-credential", pattern: /Bearer\s+[A-Za-z0-9._-]+/i },
  { id: "private-key-header", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "github-webhook-secret", pattern: /GITHUB_WEBHOOK_SECRET/i },
  // A value in assignment context (`installation_token = <value>`, `Installation-Token: <value>`),
  // never the bare identifier.
  { id: "installation-token-value", pattern: /installation[_-]?token["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i },
  // Compact JSON web token: a `{"`-prefixed base64url header (always `eyJ`) plus two more
  // base64url segments. Structure-based, so the word "JWT" alone never matches.
  { id: "compact-jwt-value", pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/ }
] as const;

const GITHUB_ISSUE_BODY_MAX_LENGTH = 65_536;

export function githubIssueFooterMarker(runId: string, draftDigest: string): string {
  return `> Filed by archctx audit · run \`${runId}\` · draft \`${draftDigest}\``;
}

export function findExistingGithubIssueByMarker(
  existing: GithubIssueListedRecord[],
  runId: string,
  draftDigest: string
): GithubIssueListedRecord | undefined {
  const marker = githubIssueFooterMarker(runId, draftDigest);
  return existing.find((issue) => issue.body.includes(marker));
}

export type GithubIssuePreflightDraft = Pick<GithubIssueDraftV1, "draftId" | "draftDigest" | "title" | "bodyMarkdown" | "labels">;

export type GithubIssuePreflightResult =
  | { ok: true; bodies: Map<string, string> }
  | { ok: false; reason: string };

/**
 * Batch pre-flight for an entire approve run: scans every draft's full outbound-or-displayed
 * payload (title + body + footer marker, which are sent to `gh`, plus labels, which `createIssue`
 * never sends to `gh` and which are exposed only via `archctx audit show` — see
 * `GithubIssueExecutorPort.createIssue`'s doc comment) for secret-shaped content field by field,
 * so a rejection can name the offending field without quoting its content, and enforces
 * GitHub's issue body length limit over the title/body/footer text that is actually sent to `gh`.
 * Any single draft failing either check aborts the whole batch before any ledger event is
 * appended or any `gh` call is made — this codebase never publishes a partial batch because one
 * draft looked unsafe.
 */
export function preflightGithubIssueDrafts(runId: string, drafts: GithubIssuePreflightDraft[]): GithubIssuePreflightResult {
  const bodies = new Map<string, string>();
  for (const draft of drafts) {
    const footer = githubIssueFooterMarker(runId, draft.draftDigest);
    const body = `${draft.bodyMarkdown.replace(/\s+$/, "")}\n\n${footer}\n`;
    const scanned: { field: "title" | "body" | "label"; text: string }[] = [
      { field: "title", text: draft.title },
      { field: "body", text: body },
      ...draft.labels.map((label) => ({ field: "label" as const, text: label }))
    ];
    for (const { field, text } of scanned) {
      for (const detector of SECRET_DETECTORS) {
        if (detector.pattern.test(text)) {
          return {
            ok: false,
            reason: `github issue draft ${draft.draftId} matched a secret-shaped pattern (detector ${detector.id}) in its ${field}; publishing aborted for the entire run`
          };
        }
      }
    }
    if (body.length > GITHUB_ISSUE_BODY_MAX_LENGTH) {
      return { ok: false, reason: `github issue draft ${draft.draftId} body is ${body.length} characters including the footer, exceeding the ${GITHUB_ISSUE_BODY_MAX_LENGTH}-character GitHub issue body limit` };
    }
    bodies.set(draft.draftId, body);
  }
  return { ok: true, bodies };
}
