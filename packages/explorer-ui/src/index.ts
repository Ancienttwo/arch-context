import type { ExplorerProjection, ExplorerNodeView } from "../../contracts/src/index";

export function filterExplorerProjection(projection: ExplorerProjection, query = ""): ExplorerProjection {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return projection;
  const nodes = projection.nodes.filter((node) =>
    [node.id, node.name, node.kind, node.repositoryId ?? "", node.verificationStatus, ...node.pressure.signals]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...projection,
    nodes,
    relations: projection.relations.filter((relation) => nodeIds.has(relation.source) || nodeIds.has(relation.target))
  };
}

export function renderExplorerHtml(projection: ExplorerProjection): string {
  const title = "ArchContext Explorer";
  const nodes = projection.nodes.slice(0, 80);
  const relations = projection.relations.slice(0, 160);
  const graph = renderGraph(nodes);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f4;
      --ink: #172019;
      --muted: #5c675f;
      --line: #cbd4ce;
      --panel: #ffffff;
      --accent: #176b57;
      --accent-2: #b6422f;
      --accent-3: #2f5fa8;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink); }
    main { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); min-height: 100vh; }
    aside { border-right: 1px solid var(--line); background: var(--panel); padding: 18px; overflow: auto; }
    section { padding: 20px; overflow: auto; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 20px; line-height: 1.2; }
    h2 { font-size: 13px; margin-top: 20px; text-transform: uppercase; color: var(--muted); letter-spacing: 0; }
    h3 { font-size: 14px; line-height: 1.25; }
    .meta { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .toolbar { display: flex; gap: 8px; margin: 16px 0; }
    input { width: 100%; min-height: 34px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: inherit; }
    .pill { display: inline-flex; align-items: center; min-height: 24px; border-radius: 999px; padding: 0 8px; background: #e8eee8; color: var(--muted); font-size: 12px; white-space: nowrap; }
    .list { display: grid; gap: 8px; margin-top: 10px; }
    .row { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: var(--panel); }
    .row:focus-within, .row:hover { border-color: var(--accent); }
    .row-head { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
    .row code { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
    .graph { width: 100%; min-height: 460px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    svg text { font: 12px Inter, ui-sans-serif, system-ui, sans-serif; fill: var(--ink); }
    .relation-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    .relation-table th, .relation-table td { border-bottom: 1px solid var(--line); text-align: left; padding: 8px; vertical-align: top; }
    .json-panel { margin: 10px 0 0; max-width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 10px; font-size: 12px; line-height: 1.45; }
    .empty { border: 1px dashed var(--line); border-radius: 8px; padding: 24px; color: var(--muted); background: var(--panel); }
    @media (max-width: 820px) {
      main { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      .graph { min-height: 320px; }
    }
  </style>
</head>
<body>
  <main role="application" aria-label="ArchContext Explorer">
    <aside>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">${escapeHtml(projection.repository.repositoryId)} · ${escapeHtml(projection.repository.headSha)}</p>
      <div class="toolbar">
        <input type="search" id="search" placeholder="Search nodes" aria-label="Search nodes">
      </div>
      <span class="pill">${nodes.length} nodes</span>
      <span class="pill">${relations.length} relations</span>
      <h2>Nodes</h2>
      <div class="list" id="node-list">
        ${nodes.map(renderNodeRow).join("") || `<div class="empty">No nodes</div>`}
      </div>
    </aside>
    <section>
      <div class="graph" aria-label="Architecture graph">${graph}</div>
      <h2>Relations</h2>
      ${renderRelationTable(projection)}
      <h2>Verification</h2>
      ${renderJsonRows(projection.verification, "verification")}
      <h2>Interventions</h2>
      ${renderJsonRows(projection.interventions, "intervention")}
      <h2>Landscape</h2>
      ${projection.landscape ? `<pre class="json-panel">${escapeHtml(JSON.stringify(projection.landscape, null, 2))}</pre>` : `<div class="empty">No landscape</div>`}
    </section>
  </main>
  <script>
    const input = document.getElementById("search");
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const url = new URL(window.location.href);
        url.searchParams.set("q", input.value);
        window.location.href = url.toString();
      }
    });
  </script>
</body>
</html>`;
}

function renderNodeRow(node: ExplorerNodeView): string {
  return `<article class="row" tabindex="0" data-node-id="${escapeHtml(node.id)}">
    <div class="row-head">
      <h3>${escapeHtml(node.name)}</h3>
      <span class="pill">${escapeHtml(node.verificationStatus)}</span>
    </div>
    <code>${escapeHtml(node.id)}</code>
    <p class="meta">${escapeHtml(node.kind)} · pressure ${escapeHtml(node.pressure.level)} ${node.pressure.score}</p>
  </article>`;
}

function renderRelationTable(projection: ExplorerProjection): string {
  if (projection.relations.length === 0) return `<div class="empty">No relations</div>`;
  return `<table class="relation-table">
    <thead><tr><th>Kind</th><th>Source</th><th>Target</th><th>Status</th></tr></thead>
    <tbody>
      ${projection.relations.map((relation) => `<tr>
        <td>${escapeHtml(relation.kind)}</td>
        <td>${escapeHtml(relation.source)}</td>
        <td>${escapeHtml(relation.target)}</td>
        <td>${escapeHtml(relation.verificationStatus)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderJsonRows(items: unknown[], label: string): string {
  if (items.length === 0) return `<div class="empty">No ${escapeHtml(label)}</div>`;
  return `<div class="list">${items.map((item) => `<pre class="json-panel">${escapeHtml(JSON.stringify(item, null, 2))}</pre>`).join("")}</div>`;
}

function renderGraph(nodes: ExplorerNodeView[]): string {
  if (nodes.length === 0) return `<svg viewBox="0 0 800 420" role="img" aria-label="Empty architecture graph"></svg>`;
  const centerX = 400;
  const centerY = 210;
  const radius = Math.min(170, 42 + nodes.length * 18);
  const positioned = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length);
    return { node, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  });
  const lines = positioned.map((point) => `<line x1="${centerX}" y1="${centerY}" x2="${point.x.toFixed(1)}" y2="${point.y.toFixed(1)}" stroke="#cbd4ce" stroke-width="1" />`);
  const circles = positioned.map((point) => {
    const fill = point.node.verificationStatus === "DRIFT" ? "#b6422f" : point.node.pressure.level === "high" ? "#d08b1f" : "#176b57";
    return `<g tabindex="0" aria-label="${escapeHtml(point.node.name)}">
      <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="15" fill="${fill}" />
      <text x="${(point.x + 20).toFixed(1)}" y="${(point.y + 4).toFixed(1)}">${escapeHtml(shortLabel(point.node.name))}</text>
    </g>`;
  });
  return `<svg viewBox="0 0 800 420" role="img" aria-label="Architecture graph">
    <circle cx="${centerX}" cy="${centerY}" r="18" fill="#2f5fa8" />
    ${lines.join("")}
    ${circles.join("")}
  </svg>`;
}

function shortLabel(value: string): string {
  return value.length <= 28 ? value : `${value.slice(0, 25)}...`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
