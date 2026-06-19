import type { Json } from "../../../packages/contracts/src/index";

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
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ArchContext</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #151a1f; background: #f7f8fa; }
    body { margin: 0; padding: 16px; }
    main { max-width: 980px; margin: 0 auto; display: grid; gap: 12px; }
    section { background: #fff; border: 1px solid #d8dde3; border-radius: 8px; padding: 14px; }
    h1, h2 { margin: 0 0 8px; font-size: 16px; letter-spacing: 0; }
    h1 { font-size: 20px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #4d5965; }
    .pill { border: 1px solid #c9d1d9; border-radius: 999px; padding: 2px 8px; background: #fafbfc; }
    .matrix { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .bar { height: 8px; background: #e6e9ed; border-radius: 4px; overflow: hidden; }
    .bar > span { display: block; height: 100%; background: #1677ff; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 12px; line-height: 1.45; }
    .notice { border-color: #e0bc49; background: #fff9df; }
    .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .metric { border: 1px solid #e1e6eb; border-radius: 6px; padding: 10px; background: #fbfcfd; }
    .metric strong { display: block; font-size: 12px; color: #5b6673; margin-bottom: 4px; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>ArchContext</h1>
      <div class="meta">
        <span class="pill">${escapeHtml(input.repo)}</span>
        <span class="pill">${escapeHtml(input.headSha)}</span>
        <span class="pill">${input.dirty ? "dirty" : "clean"}</span>
        <span class="pill">${escapeHtml(input.posture)}</span>
      </div>
    </section>
    <section class="notice"><strong>Data sharing:</strong> Tool results displayed in this UI may be sent to OpenAI by the MCP host.</section>
    <section><h2>Task Context</h2><pre>${escapeHtml(input.task)}</pre></section>
    <section><h2>Pressure / Confidence</h2><div class="matrix">
      <div>Pressure<div class="bar"><span style="width:${clamp(input.pressureScore)}%"></span></div></div>
      <div>Confidence<div class="bar"><span style="width:${clamp(input.confidenceScore)}%"></span></div></div>
    </div></section>
    <section><h2>Target / Migration</h2><pre>${escapeHtml(JSON.stringify({ targetState: input.targetState ?? {}, migrationState: input.migrationState ?? {} }, null, 2))}</pre></section>
    <section><h2>Intervention Decision</h2><pre>${escapeHtml(JSON.stringify(input.intervention ?? {}, null, 2))}</pre></section>
    <section><h2>Migration Progress</h2><div class="grid3">
      ${metric("Required", metricValue(input.migrationProgress, "required"))}
      ${metric("Completed", metricValue(input.migrationProgress, "completed"))}
      ${metric("Blocked", metricValue(input.migrationProgress, "blocked"))}
    </div><pre>${escapeHtml(JSON.stringify(input.migrationProgress ?? {}, null, 2))}</pre></section>
    <section><h2>ChangeSet Preview</h2><pre>${escapeHtml(JSON.stringify(input.changesetPreview ?? {}, null, 2))}</pre></section>
    <section><h2>ChangeSet Diff</h2><pre>${escapeHtml(JSON.stringify(input.diffPreview ?? {}, null, 2))}</pre></section>
    <section><h2>Review Findings</h2><pre>${escapeHtml(JSON.stringify(findings, null, 2))}</pre></section>
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
  return Math.max(0, Math.min(100, Math.round(value)));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]!));
}

function metric(label: string, value: string): string {
  return `<div class="metric"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`;
}

function metricValue(value: Json | undefined, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "0";
  const item = value[key];
  return typeof item === "number" || typeof item === "string" ? String(item) : "0";
}
