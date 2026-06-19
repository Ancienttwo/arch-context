import type { Json } from "../../packages/contracts/src/index";

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
    <section><h2>ChangeSet Preview</h2><pre>${escapeHtml(JSON.stringify(input.changesetPreview ?? {}, null, 2))}</pre></section>
    <section><h2>Review Findings</h2><pre>${escapeHtml(JSON.stringify(findings, null, 2))}</pre></section>
  </main>
</body>
</html>`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]!));
}
