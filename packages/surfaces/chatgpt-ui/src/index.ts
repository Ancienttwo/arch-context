import type { Json } from "@archcontext/contracts";

export const CHATGPT_UI_RESOURCE_URI = "ui://archcontext/task-context.html";

export function buildUiToolMetadata() {
  return {
    _meta: {
      "ui.resourceUri": CHATGPT_UI_RESOURCE_URI,
      "ui.openai/widgetAccessible": true,
      "archcontext.dataSharing": "Tool results shown here may be sent to OpenAI by the MCP host."
    }
  };
}

export function renderTaskContextHtml(input: {
  repo: string;
  headSha: string;
  dirty: boolean;
  task: string;
  posture: string;
  pressureScore: number;
  confidenceScore: number;
  targetState?: Json;
  migrationState?: Json;
  changesetPreview?: Json;
  intervention?: Json;
  migrationProgress?: Json;
  diffPreview?: Json;
  findings?: Json[];
}): string {
  const findings = input.findings ?? [];
  const decision = readField(input.intervention, "decision");
  const diffFiles = readFiles(input.diffPreview);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ArchContext</title>
  <!--
    ArchContext task-context panel (ui://archcontext/task-context.html).
    Dynamic placeholders interpolated from input:
      {{repo}} {{headSha}} {{dirty}} {{task}} {{posture}}
      {{pressureScore}} {{confidenceScore}}
      {{targetState}} {{migrationState}}
      {{intervention}} (surfaces {{intervention.decision}})
      {{migrationProgress}} (reads .required / .completed / .blocked)
      {{changesetPreview}}
      {{diffPreview}} (reads .files[].path / .added / .removed)
      {{findings}} (reads [].severity / .message)
  -->
  <style>
    :root{color-scheme:light;
    --paper:#f6f7f4;--panel:#fff;--panel-sunken:#fbfcfa;--wash:#eef1ec;--wash-strong:#e3e8e1;
    --ink:#172019;--ink-2:#36433b;--muted:#5c675f;--faint:#8a958d;--line:#cbd4ce;--line-soft:#dde3dd;
    --ink-green:#176b57;--ink-green-700:#115443;--ink-green-50:#e4efe9;
    --amber:#d08b1f;--amber-700:#a96f12;--amber-50:#fdf4e1;
    --brick:#b6422f;--brick-700:#93331f;--brick-50:#f7e7e2;
    --indigo:#2f5fa8;--indigo-700:#244a85;--indigo-50:#e6ecf5;--slate:#5c675f;
    --font-sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
    --font-mono:ui-monospace,"SF Mono","Menlo","Consolas",monospace;}
    *{box-sizing:border-box}
    body{margin:0;font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
    code,pre,kbd{font-family:var(--font-mono)}
    :focus-visible{outline:2px solid var(--indigo);outline-offset:2px}

    .panel{background:var(--paper);color:var(--ink);max-width:760px;margin:0 auto;padding:14px;
      display:grid;gap:12px;border-radius:14px}
    .card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}
    .card-sunken{background:var(--panel-sunken);border-color:var(--line-soft)}

    h1{margin:0;font-size:20px;font-weight:600;letter-spacing:0;color:var(--ink)}
    h2{margin:0 0 12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted)}
    .eyebrow{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted)}
    p{margin:0}

    /* brandmark */
    .brand{display:inline-flex;align-items:center;gap:9px}
    .brand-glyph{display:inline-flex;align-items:center;justify-content:center;height:20px;padding:0 0.42em;
      border-radius:5px;background:var(--ink-green);color:#fff;font-family:var(--font-mono);font-size:12px;
      font-weight:700;line-height:1;letter-spacing:0}
    .brand-word{font-size:16px;font-weight:600;letter-spacing:0;color:var(--ink)}

    .header-top{display:flex;align-items:center;gap:8px;margin-bottom:10px}
    .ro-chip{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted)}
    .ro-dot{width:6px;height:6px;border-radius:50%;background:var(--faint);flex:none}

    /* chips */
    .chips{display:flex;flex-wrap:wrap;gap:7px}
    .chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;
      background:var(--wash);color:var(--muted);border:1px solid var(--line);font-size:12px;font-weight:500;
      white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
    .chip-mono{font-family:var(--font-mono)}
    .chip-ok{background:var(--ink-green-50);color:var(--ink-green-700);border-color:transparent}
    .chip-warn{background:var(--amber-50);color:var(--amber-700);border-color:transparent}
    .chip-danger{background:var(--brick-50);color:var(--brick-700);border-color:transparent}
    .chip-info{background:var(--indigo-50);color:var(--indigo-700);border-color:transparent}

    /* notice */
    .notice{display:flex;gap:10px;background:var(--amber-50);border:1px solid var(--amber);border-radius:8px;
      padding:11px 13px;font-size:13px;line-height:1.45;color:var(--ink)}
    .notice-mark{flex:none;width:18px;height:18px;border-radius:50%;background:var(--amber);color:#fff;
      font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;margin-top:1px}
    .notice strong{font-weight:600}

    .task-text{font-size:14px;line-height:1.5;color:var(--ink)}

    /* pressure bars */
    .bars{display:grid;gap:14px}
    .bar-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px}
    .bar-label{font-size:13px;font-weight:600;color:var(--ink)}
    .bar-level{margin-left:8px;font-size:12px;font-weight:500;text-transform:capitalize}
    .bar-num{font-family:var(--font-mono);font-size:12px;color:var(--muted)}
    .bar-num .of{color:var(--faint)}
    .bar-track{height:8px;border-radius:999px;background:var(--wash);overflow:hidden}
    .bar-fill{height:100%;border-radius:999px}
    .lvl-low{color:var(--ink-green)} .fill-low{background:var(--ink-green)}
    .lvl-medium{color:var(--amber)} .fill-medium{background:var(--amber)}
    .lvl-high{color:var(--brick)} .fill-high{background:var(--brick)}
    .fill-confidence{background:var(--ink-green)}

    /* intervention */
    .iv-card{border:1px solid var(--ink-green);border-radius:8px;overflow:hidden;background:var(--panel)}
    .iv-head{background:var(--ink-green);color:#fff;padding:10px 14px;display:flex;align-items:center;
      justify-content:space-between;gap:10px}
    .iv-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em}
    .iv-decision{font-size:12px;font-weight:600;background:rgba(255,255,255,0.18);padding:2px 9px;border-radius:999px;
      white-space:nowrap}
    .iv-body{padding:14px}
    .iv-thesis{font-size:14px;line-height:1.5;color:var(--ink);margin-bottom:12px}

    /* metric tiles */
    .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .tile{border:1px solid var(--line-soft);border-radius:6px;background:var(--panel-sunken);padding:11px 12px}
    .tile-label{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)}
    .tile-value{font-size:26px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--ink)}
    .tile-ok .tile-value{color:var(--ink-green)}
    .tile-danger .tile-value{color:var(--brick)}

    /* status badge */
    .badge{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:2px 10px;border-radius:999px;
      font-size:12px;font-weight:600;letter-spacing:0.01em;white-space:nowrap;text-transform:uppercase;
      border:1px solid transparent;flex:none}
    .badge-dot{width:8px;height:8px;border-radius:50%;flex:none}
    .badge-warn{background:var(--amber-50);color:var(--amber-700)}
    .badge-warn .badge-dot{background:var(--amber)}
    .badge-error{background:var(--brick-50);color:var(--brick-700)}
    .badge-error .badge-dot{background:var(--brick)}
    .badge-info{background:var(--indigo-50);color:var(--indigo-700)}
    .badge-info .badge-dot{background:var(--indigo)}

    .findings{display:grid;gap:9px}
    .finding{display:flex;gap:9px;align-items:flex-start}
    .finding-msg{font-size:13px;line-height:1.45;color:var(--ink-2)}

    /* diff stat */
    .diff{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel);margin-bottom:10px}
    .diff-head{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--panel-sunken);
      border-bottom:1px solid var(--line-soft);font-size:12px}
    .diff-head .count{color:var(--muted);font-weight:600}
    .diff-totals{margin-left:auto;display:inline-flex;gap:10px;font-family:var(--font-mono)}
    .diff-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--line-soft)}
    .diff-path{flex:1;min-width:0;font-family:var(--font-mono);font-size:12px;color:var(--ink-2);
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
    .diff-nums{display:inline-flex;gap:8px;font-family:var(--font-mono);font-size:12px;flex:none}
    .add{color:var(--ink-green-700)} .del{color:var(--brick-700)}

    /* json block (collapsible) */
    details.json{border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}
    details.json>summary{list-style:none;cursor:pointer;padding:10px 13px;font-size:12px;font-weight:600;
      text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);display:flex;align-items:center;gap:8px;
      user-select:none}
    details.json>summary::-webkit-details-marker{display:none}
    details.json>summary::before{content:"+";font-family:var(--font-mono);font-weight:700;color:var(--faint)}
    details.json[open]>summary::before{content:"−"}
    details.json[open]>summary{border-bottom:1px solid var(--line-soft)}
    details.json pre{margin:0;padding:12px 13px;max-height:280px;overflow:auto;
      white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;color:var(--ink-2);
      background:var(--panel-sunken)}

    .foot{font-size:12px;color:var(--faint);text-align:center;margin:2px 0 2px;line-height:1.5}
  </style>
</head>
<body>
  <main class="panel">
    <section class="card">
      <div class="header-top">
        <span class="brand">
          <span class="brand-glyph" aria-hidden="true">&gt;_&lt;</span>
          <strong class="brand-word">ArchContext</strong>
        </span>
        <span class="ro-chip"><span class="ro-dot" aria-hidden="true"></span>read-only · writeMode disabled</span>
      </div>
      <div class="chips">
        <span class="chip chip-mono" title="${escapeHtml(input.repo)}">${escapeHtml(input.repo)}</span>
        <span class="chip chip-mono" title="${escapeHtml(input.headSha)}">${escapeHtml(input.headSha)}</span>
        ${chip(input.dirty ? "dirty" : "clean", input.dirty ? "warn" : "ok")}
        ${chip(input.posture, postureTone(input.posture))}
      </div>
    </section>

    <div class="notice" role="note">
      <span class="notice-mark" aria-hidden="true">!</span>
      <div><strong>Data sharing:</strong> Tool results displayed in this panel may be sent to OpenAI by the MCP host. Private repository context stays in the local runtime; write tools require local confirmation.</div>
    </div>

    <section class="card">
      <h2>Task context</h2>
      <p class="task-text">${escapeHtml(input.task)}</p>
    </section>

    <section class="card">
      <h2>Pressure / Confidence</h2>
      <div class="bars">
        ${pressureBar(input.pressureScore)}
        ${confidenceBar(input.confidenceScore)}
      </div>
    </section>

    <section class="iv-card" aria-label="Intervention Decision">
      <div class="iv-head">
        <span class="iv-title">Intervention Decision</span>
        ${decision ? `<span class="iv-decision">${escapeHtml(humanize(decision))}</span>` : ""}
      </div>
      <div class="iv-body">
        ${interventionBody(input.intervention)}
        <details class="json">
          <summary>Decision detail</summary>
          <pre>${escapeHtml(stringify(input.intervention))}</pre>
        </details>
      </div>
    </section>

    <section class="card">
      <h2>Migration Progress</h2>
      <div class="tiles">
        ${tile("Required", metricValue(input.migrationProgress, "required"), "neutral")}
        ${tile("Completed", metricValue(input.migrationProgress, "completed"), "ok")}
        ${tile("Blocked", metricValue(input.migrationProgress, "blocked"), "danger")}
      </div>
      <details class="json" style="margin-top:10px">
        <summary>Progress detail</summary>
        <pre>${escapeHtml(stringify(input.migrationProgress))}</pre>
      </details>
    </section>

    <section class="card">
      <h2>Target / Migration</h2>
      <details class="json">
        <summary>Target state &amp; migration state</summary>
        <pre>${escapeHtml(stringify({ targetState: input.targetState ?? {}, migrationState: input.migrationState ?? {} }))}</pre>
      </details>
    </section>

    <section class="card">
      <h2>ChangeSet Preview</h2>
      <details class="json">
        <summary>Preview detail</summary>
        <pre>${escapeHtml(stringify(input.changesetPreview))}</pre>
      </details>
    </section>

    <section class="card">
      <h2>ChangeSet Diff</h2>
      ${diffFiles.length ? diffStat(diffFiles) : ""}
      <details class="json">
        <summary>Diff detail</summary>
        <pre>${escapeHtml(stringify(input.diffPreview))}</pre>
      </details>
    </section>

    <section class="card">
      <h2>Review Findings</h2>
      ${findings.length ? `<div class="findings">${findings.map(findingRow).join("")}</div>` : `<p class="task-text" style="color:var(--muted)">No findings.</p>`}
    </section>

    <p class="foot">writeMode: disabled — ArchContext cannot modify your code from this panel.<br>Private context stays in the local runtime; write tools require local confirmation.</p>
  </main>
</body>
</html>`;
}

export function buildGaUiState(input: {
  intervention?: Json;
  migrationProgress?: Json;
  diffPreview?: Json;
  writeEnabled?: boolean;
}) {
  return {
    schemaVersion: "archcontext.chatgpt-ui-state/v1",
    writeMode: input.writeEnabled ? "requires-local-confirmation" : "disabled",
    intervention: input.intervention ?? {},
    migrationProgress: input.migrationProgress ?? { required: 0, completed: 0, blocked: 0 },
    diffPreview: input.diffPreview ?? { files: [] },
    disclosure: "Private repository context stays in the local runtime; write tools require local confirmation."
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]!));
}

function stringify(value: Json | undefined): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function humanize(value: string): string {
  return value.replace(/-/g, " ");
}

function postureTone(posture: string): "neutral" | "warn" | "danger" {
  if (posture === "intervention") return "danger";
  if (posture === "proof-required") return "warn";
  return "neutral";
}

function chip(label: string, tone: "neutral" | "ok" | "warn" | "danger" | "info"): string {
  const cls = tone === "neutral" ? "chip" : `chip chip-${tone}`;
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function pressureBar(score: number): string {
  const v = clamp(score);
  const level = v >= 67 ? "high" : v >= 34 ? "medium" : "low";
  return `<div>
    <div class="bar-head">
      <span class="bar-label">Pressure<span class="bar-level lvl-${level}">${level}</span></span>
      <span class="bar-num">${v}<span class="of"> / 100</span></span>
    </div>
    <div class="bar-track"><div class="bar-fill fill-${level}" style="width:${v}%"></div></div>
  </div>`;
}

function confidenceBar(score: number): string {
  const v = clamp(score);
  return `<div>
    <div class="bar-head">
      <span class="bar-label">Confidence</span>
      <span class="bar-num">${v}<span class="of"> / 100</span></span>
    </div>
    <div class="bar-track"><div class="bar-fill fill-confidence" style="width:${v}%"></div></div>
  </div>`;
}

function tile(label: string, value: string, tone: "neutral" | "ok" | "danger"): string {
  const cls = tone === "neutral" ? "tile" : `tile tile-${tone}`;
  return `<div class="${cls}"><div class="tile-label">${escapeHtml(label)}</div><div class="tile-value">${escapeHtml(value)}</div></div>`;
}

function metricValue(value: Json | undefined, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "0";
  const item = value[key];
  return typeof item === "number" || typeof item === "string" ? String(item) : "0";
}

function readField(value: Json | undefined, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value[key];
  return typeof item === "string" ? item : null;
}

type DiffFile = { path: string; added: number | null; removed: number | null };

function readFiles(value: Json | undefined): DiffFile[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const files = value["files"];
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => {
      if (!f || typeof f !== "object" || Array.isArray(f)) return null;
      const path = typeof f["path"] === "string" ? f["path"] : null;
      if (path === null) return null;
      const added = typeof f["added"] === "number" ? f["added"] : null;
      const removed = typeof f["removed"] === "number" ? f["removed"] : null;
      return { path, added, removed };
    })
    .filter((f): f is DiffFile => f !== null);
}

function diffStat(files: DiffFile[]): string {
  const totalAdded = files.reduce((a, f) => a + (f.added ?? 0), 0);
  const totalRemoved = files.reduce((a, f) => a + (f.removed ?? 0), 0);
  const rows = files
    .map((f) => {
      const nums = [
        f.added !== null ? `<span class="add">+${f.added}</span>` : "",
        f.removed !== null ? `<span class="del">−${f.removed}</span>` : ""
      ].join("");
      return `<div class="diff-row"><code class="diff-path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</code><span class="diff-nums">${nums}</span></div>`;
    })
    .join("");
  const fileWord = files.length === 1 ? "file" : "files";
  return `<div class="diff">
    <div class="diff-head">
      <span class="count">${files.length} ${fileWord}</span>
      <span class="diff-totals"><span class="add">+${totalAdded}</span><span class="del">−${totalRemoved}</span></span>
    </div>
    ${rows}
  </div>`;
}

function interventionBody(value: Json | undefined): string {
  const thesis = readField(value, "thesis");
  const strategy = readField(value, "strategy");
  const status = readField(value, "status");
  const parts: string[] = [];
  if (thesis) parts.push(`<p class="iv-thesis">${escapeHtml(thesis)}</p>`);
  const chips: string[] = [];
  if (status) chips.push(chip(`status: ${status}`, "ok"));
  if (strategy) chips.push(chip(`strategy: ${strategy}`, "info"));
  if (chips.length) parts.push(`<div class="chips" style="margin-bottom:12px">${chips.join("")}</div>`);
  return parts.join("");
}

function findingRow(finding: Json): string {
  const severity = (typeof finding === "object" && finding !== null && !Array.isArray(finding) && typeof finding["severity"] === "string")
    ? finding["severity"]
    : "info";
  const message = (typeof finding === "object" && finding !== null && !Array.isArray(finding) && typeof finding["message"] === "string")
    ? finding["message"]
    : stringify(finding);
  const tone = severity === "error" || severity === "critical" ? "error" : severity === "warning" ? "warn" : "info";
  return `<div class="finding"><span class="badge badge-${tone}"><span class="badge-dot" aria-hidden="true"></span>${escapeHtml(severity)}</span><span class="finding-msg">${escapeHtml(message)}</span></div>`;
}
