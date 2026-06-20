import type {
  ExplorerProjection,
  ExplorerNodeView,
  ExplorerRelationView,
  ExplorerVerificationStatus,
  ExplorerPressureLevel
} from "@archcontext/contracts";

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

export interface RenderExplorerHtmlOptions {
  focusId?: string | null;
}

// --- semantic palette (color + label + shape; never color alone) -------------

interface StatusStyle {
  bg: string;
  fg: string;
  dot: string;
  dash: boolean;
}

const STATUS_STYLE: Record<ExplorerVerificationStatus, StatusStyle> = {
  VERIFIED: { bg: "var(--ink-green-50)", fg: "var(--ink-green-700)", dot: "var(--ink-green)", dash: false },
  MATCHED: { bg: "var(--indigo-50)", fg: "var(--indigo-700)", dot: "var(--indigo)", dash: false },
  DRIFT: { bg: "var(--brick-50)", fg: "var(--brick-700)", dot: "var(--brick)", dash: false },
  UNKNOWN: { bg: "var(--wash)", fg: "var(--muted)", dot: "var(--slate)", dash: true }
};

function pressureColor(level: ExplorerPressureLevel): string {
  return level === "high" ? "var(--brick)" : level === "medium" ? "var(--amber)" : "var(--ink-green)";
}

// node fill in the graph: drift/unknown carry status meaning; otherwise pressure wins
function graphNodeColor(node: ExplorerNodeView): string {
  if (node.verificationStatus === "DRIFT") return "var(--brick)";
  if (node.verificationStatus === "UNKNOWN") return "var(--slate)";
  if (node.pressure.level === "high") return "var(--brick)";
  if (node.pressure.level === "medium") return "var(--amber)";
  if (node.verificationStatus === "MATCHED") return "var(--indigo)";
  return "var(--ink-green)";
}

// diagram box outline: pure status zoning
function statusColor(status: ExplorerVerificationStatus): string {
  if (status === "DRIFT") return "var(--brick)";
  if (status === "UNKNOWN") return "var(--slate)";
  if (status === "MATCHED") return "var(--indigo)";
  return "var(--ink-green)";
}

const clampScore = (score: number): number => Math.max(0, Math.min(100, Math.round(score)));

// ----------------------------------------------------------------------------

export function renderExplorerHtml(projection: ExplorerProjection, options: RenderExplorerHtmlOptions = {}): string {
  const title = "ArchContext Explorer";
  const nodes = projection.nodes.slice(0, 80);
  const relations = projection.relations.slice(0, 160);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const visibleRelations = relations.filter((r) => nodeIds.has(r.source) && nodeIds.has(r.target));

  const driftCount = nodes.filter((node) => node.verificationStatus === "DRIFT").length;
  const highCount = nodes.filter((node) => node.pressure.level === "high").length;

  const repo = projection.repository;
  const focusId = normalizeFocusId(nodes, options.focusId);
  const statePanel = renderStatePanel(projection, nodes);

  const placeholderComment = renderPlaceholderComment();
  const graphSvg = renderGraph(nodes, visibleRelations);
  const diagramView = renderDiagram(nodes, visibleRelations, focusId);

  return `<!doctype html>
${placeholderComment}
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${BASE_STYLE}
  </style>
</head>
<body>
  <main role="application" aria-label="ArchContext Explorer">
    <aside class="sidebar">
      <div class="brand-row">
        <span class="brandmark" aria-hidden="true">&gt;_&lt;</span>
        <strong class="wordmark">ArchContext</strong>
        <span class="brand-sub">Explorer</span>
      </div>
      <div class="repo-meta">
        <span class="repo-id mono">${escapeHtml(repo.repositoryId)}</span>
        <div class="repo-refs">
          <code class="ref mono" title="${escapeHtml(repo.headSha)}">${escapeHtml(truncate(repo.headSha, 12))}</code>
          <code class="ref mono ref-muted" title="${escapeHtml(repo.worktreeDigest)}">${escapeHtml(truncateMiddle(repo.worktreeDigest, 18))}</code>
        </div>
      </div>
      <span class="trust-badge"><span class="trust-dot" aria-hidden="true"></span>read-only · local · no egress</span>
      <div class="cmdline" role="note">
        <span class="cmd-prompt">$</span>
        <span class="cmd-text">archctx explore --port 7420</span>
        <span class="cmd-status">
          <span class="cmd-pill"><span class="cmd-pill-dot dot-ok" aria-hidden="true"></span>127.0.0.1:7420</span>
          <span class="cmd-pill"><span class="cmd-pill-dot dot-neutral" aria-hidden="true"></span>ttl 900s</span>
          <span class="cmd-pill"><span class="cmd-pill-dot dot-ok" aria-hidden="true"></span>egress none</span>
        </span>
      </div>
      <div class="search-wrap">
        <input type="search" id="search" placeholder="Search nodes, signals…" aria-label="Search nodes">
      </div>
      <div class="chips">
        <span class="chip">${nodes.length} nodes</span>
        <span class="chip">${visibleRelations.length} relations</span>
        ${driftCount > 0 ? `<span class="chip chip-danger">${driftCount} drift</span>` : ""}
        ${highCount > 0 ? `<span class="chip chip-danger">${highCount} high pressure</span>` : ""}
      </div>
      <h2 class="eyebrow">Nodes</h2>
      <div class="node-list" id="node-list">
        ${nodes.length > 0 ? nodes.map(renderNodeRow).join("") : `<div class="state-inline">No matching nodes</div>`}
      </div>
    </aside>
    <section class="detail">
      <section class="card graph-card">
        <header class="card-head">
          <span class="eyebrow eyebrow-flush">Architecture</span>
          <span class="toggle" role="group" aria-label="View">
            <button type="button" class="seg" id="seg-graph" data-view="graph" aria-pressed="true">Graph</button>
            <button type="button" class="seg" id="seg-diagram" data-view="diagram" aria-pressed="false">Diagram</button>
          </span>
        </header>
        ${statePanel
          ? statePanel
          : `<div class="view view-graph ac-pixel-grid-soft" id="view-graph" aria-label="Architecture graph">${graphSvg}</div>
        <div class="view view-diagram" id="view-diagram" hidden aria-label="Architecture diagram">${diagramView}</div>
        <div class="view-legend" id="legend-graph">Radius ∝ pressure · zoned by status · drift dashed</div>
        <div class="view-legend" id="legend-diagram" hidden>Click a node (here or in the list) to focus · typed arrows · left accent = verification</div>`}
      </section>

      <h2 class="eyebrow">Relations</h2>
      ${renderRelationTable(visibleRelations)}

      <h2 class="eyebrow">Verification</h2>
      ${renderJsonBlocks(projection.verification, "verification")}

      <h2 class="eyebrow">Interventions</h2>
      ${renderJsonBlocks(projection.interventions, "intervention")}

      <h2 class="eyebrow">Landscape</h2>
      ${
        projection.landscape !== undefined && projection.landscape !== null
          ? `<pre class="json-block">${escapeHtml(stringifyJson(projection.landscape))}</pre>`
          : `<div class="state-inline">No landscape recorded for this projection.</div>`
      }
      <div class="foot-pad"></div>
    </section>
  </main>
  <script>
${RUNTIME_SCRIPT}
  </script>
</body>
</html>`;
}

// --- node row ---------------------------------------------------------------

function renderNodeRow(node: ExplorerNodeView): string {
  const score = clampScore(node.pressure.score);
  const pColor = pressureColor(node.pressure.level);
  return `<article class="node-row" tabindex="0" data-node-id="${escapeHtml(node.id)}" title="Focus in diagram">
    <div class="node-head">
      <h3 class="node-name">${escapeHtml(node.name)}</h3>
      ${renderStatusBadge(node.verificationStatus)}
    </div>
    <code class="node-id mono">${escapeHtml(node.id)}</code>
    <div class="node-meta">
      <span class="node-kind">${escapeHtml(node.kind)}</span>
      <span class="dot-sep">·</span>
      <span class="node-level" style="color:${pColor}">${escapeHtml(node.pressure.level)}</span>
      <span class="bar"><span class="bar-fill" style="width:${score}%;background:${pColor}"></span></span>
      <span class="bar-val mono">${score}</span>
    </div>
  </article>`;
}

function renderStatusBadge(status: ExplorerVerificationStatus): string {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.UNKNOWN;
  const border = s.dash ? "1px dashed var(--border-strong)" : "1px solid transparent";
  const dot = s.dash
    ? `<span class="badge-dot badge-dot-ring" style="border-color:${s.dot}" aria-hidden="true"></span>`
    : `<span class="badge-dot" style="background:${s.dot}" aria-hidden="true"></span>`;
  return `<span class="status-badge" style="background:${s.bg};color:${s.fg};border:${border}">${dot}${escapeHtml(status)}</span>`;
}

// --- relations --------------------------------------------------------------

function renderRelationTable(relations: ExplorerRelationView[]): string {
  if (relations.length === 0) return `<div class="state-inline">No relations in the current view.</div>`;
  const rows = relations
    .map((relation) => {
      const drift = relation.verificationStatus === "DRIFT";
      return `<tr class="rel-row${drift ? " rel-drift" : ""}" data-source="${escapeHtml(relation.source)}" data-target="${escapeHtml(relation.target)}">
        <td class="rel-kind mono">${escapeHtml(relation.kind)}</td>
        <td class="rel-end mono">${escapeHtml(relation.source)}</td>
        <td class="rel-end mono">${escapeHtml(relation.target)}</td>
        <td>${renderStatusBadge(relation.verificationStatus)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap">
    <table class="rel-table">
      <thead><tr>
        <th>Kind</th><th>Source</th><th>Target</th><th>Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// --- json blocks ------------------------------------------------------------

function renderJsonBlocks(items: unknown[], label: string): string {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="state-inline">No ${escapeHtml(label)} entries for this projection.</div>`;
  }
  return `<div class="json-list">${items
    .map((item) => `<pre class="json-block">${escapeHtml(stringifyJson(item))}</pre>`)
    .join("")}</div>`;
}

// --- security / lifecycle StatePanel ----------------------------------------

function renderStatePanel(projection: ExplorerProjection, nodes: ExplorerNodeView[]): string | null {
  if (nodes.length > 0) return null;
  // zero nodes is the only "not-ready" condition derivable from existing fields.
  if (projection.capabilities.tokenRequired) {
    return statePanel(
      "locked",
      "⊘",
      "var(--amber)",
      "var(--amber-700)",
      "Read-only token required",
      "This Explorer is token-gated and has no projection to show yet. The daemon issues a fresh, short-lived token on restart — nothing is exposed in the meantime.",
      "token ttl 900s · egress none"
    );
  }
  return statePanel(
    "empty",
    "∅",
    "var(--line)",
    "var(--muted)",
    "No architecture yet",
    "The project index is still building, or the Explorer surface is not enabled for this repo. The graph appears as soon as the first projection is ready.",
    "egress none · waiting for projection"
  );
}

function statePanel(
  variant: string,
  glyph: string,
  ring: string,
  color: string,
  title: string,
  description: string,
  mono: string
): string {
  return `<div class="state-panel" data-variant="${escapeHtml(variant)}">
    <span class="state-glyph" style="border-color:${ring};color:${color}" aria-hidden="true">${escapeHtml(glyph)}</span>
    <div class="state-body">
      <div class="state-title">${escapeHtml(title)}</div>
      <p class="state-desc">${escapeHtml(description)}</p>
      <div class="state-mono mono">${escapeHtml(mono)}</div>
    </div>
  </div>`;
}

// --- graph view (hand-written SVG) ------------------------------------------

interface PositionedNode {
  node: ExplorerNodeView;
  x: number;
  y: number;
}

function radiusFor(node: ExplorerNodeView): number {
  return 11 + Math.round((clampScore(node.pressure.score) / 100) * 9);
}

function renderGraph(nodes: ExplorerNodeView[], relations: ExplorerRelationView[]): string {
  const W = 760;
  const H = 470;
  if (nodes.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Empty architecture graph"></svg>`;
  }

  const bands = [
    { key: "healthy", label: "Verified / Matched", y: 96, match: (s: ExplorerVerificationStatus) => s === "VERIFIED" || s === "MATCHED", fill: "transparent" },
    { key: "drift", label: "Drift — model and code disagree", y: 250, match: (s: ExplorerVerificationStatus) => s === "DRIFT", fill: "var(--brick-50)" },
    { key: "unknown", label: "Unknown", y: 392, match: (s: ExplorerVerificationStatus) => s === "UNKNOWN", fill: "transparent" }
  ];

  const pos = new Map<string, PositionedNode>();
  for (const band of bands) {
    const inBand = nodes.filter((node) => band.match(node.verificationStatus));
    const pad = 90;
    const span = W - pad * 2;
    inBand.forEach((node, i) => {
      const x = inBand.length === 1 ? W / 2 : pad + (span * i) / (inBand.length - 1);
      const jitter = (i % 2 === 0 ? -1 : 1) * (inBand.length > 3 ? 22 : 0);
      pos.set(node.id, { node, x, y: band.y + jitter });
    });
  }

  const bandLayer = bands
    .map((band) => {
      const rect =
        band.fill !== "transparent"
          ? `<rect x="16" y="${band.y - 58}" width="${W - 32}" height="116" rx="10" fill="${band.fill}" stroke="var(--brick)" stroke-opacity="0.25" stroke-dasharray="4 4" />`
          : "";
      return `${rect}<text x="26" y="${band.y - 40}" class="band-label">${escapeHtml(band.label)}</text>`;
    })
    .join("");

  const edgeLayer = relations
    .map((relation) => {
      const a = pos.get(relation.source);
      const b = pos.get(relation.target);
      if (!a || !b) return "";
      const drift = relation.verificationStatus === "DRIFT";
      const stroke = drift ? "var(--brick)" : "var(--line)";
      return `<line class="edge" data-source="${escapeHtml(relation.source)}" data-target="${escapeHtml(relation.target)}" x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}" stroke="${stroke}" stroke-width="${drift ? 1.5 : 1}"${drift ? ` stroke-dasharray="5 4"` : ""} />`;
    })
    .join("");

  const nodeLayer = Array.from(pos.values())
    .map(({ node, x, y }) => {
      const r = radiusFor(node);
      const color = graphNodeColor(node);
      const isDrift = node.verificationStatus === "DRIFT";
      const ring =
        node.verificationStatus === "UNKNOWN"
          ? `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${r}" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="3 3" />`
          : "";
      const label = node.name.length > 18 ? `${node.name.slice(0, 16)}…` : node.name;
      return `<g class="gnode" data-node-id="${escapeHtml(node.id)}" tabindex="0" aria-label="${escapeHtml(node.name)}">
        <circle class="gnode-halo" cx="${fmt(x)}" cy="${fmt(y)}" r="${r + 6}" fill="none" stroke="${color}" stroke-opacity="0.3" stroke-width="2" />
        <circle cx="${fmt(x)}" cy="${fmt(y)}" r="${r}" fill="${color}" stroke="${isDrift ? "var(--brick-700)" : "#fff"}" stroke-width="${isDrift ? 3 : 2}" />
        ${ring}
        <text x="${fmt(x)}" y="${fmt(y + r + 15)}" text-anchor="middle" class="gnode-label">${escapeHtml(label)}</text>
      </g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Architecture graph">
    ${bandLayer}
    <g class="edges">${edgeLayer}</g>
    <g class="nodes">${nodeLayer}</g>
  </svg>`;
}

// --- diagram view (focused 1-hop, hand-written SVG) -------------------------

function renderDiagram(nodes: ExplorerNodeView[], relations: ExplorerRelationView[], focusId: string | null): string {
  if (nodes.length === 0) {
    return `<div class="state-inline">No node to focus.</div>`;
  }
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const focusable = nodes.filter((node) => node.kind === "module" || node.kind === "capability");
  const pool = focusable.length > 0 ? focusable : nodes;

  let focus: ExplorerNodeView | undefined = focusId ? byId.get(focusId) : undefined;
  if (!focus) {
    focus = [...pool].sort((a, b) => b.pressure.score - a.pressure.score)[0];
  }
  if (!focus) return `<div class="state-inline">No node to focus.</div>`;

  const upstream = relations
    .filter((r) => r.target === focus!.id && byId.has(r.source))
    .map((r) => ({ relation: r, node: byId.get(r.source)! }));
  const downstream = relations
    .filter((r) => r.source === focus!.id && byId.has(r.target))
    .map((r) => ({ relation: r, node: byId.get(r.target)! }));

  const BW = 158;
  const BH = 54;
  const ROWH = 78;
  const FW = 196;
  const FH = 76;
  const leftX = 16;
  const centreX = 262;
  const rightX = 528;
  const maxSide = Math.max(1, upstream.length, downstream.length);
  const PADY = 28;
  const H = PADY * 2 + maxSide * ROWH;
  const W = rightX + BW + 16;
  const focusY = H / 2 - FH / 2;

  const sideY = (count: number, i: number): number => {
    const colH = count * ROWH;
    const top = PADY + (maxSide * ROWH - colH) / 2;
    return top + i * ROWH + (ROWH - BH) / 2;
  };

  const neighborBox = (
    side: "up" | "down",
    x: number,
    y: number,
    node: ExplorerNodeView,
    kind: string
  ): string => {
    const c = statusColor(node.verificationStatus);
    const drift = node.verificationStatus === "DRIFT";
    const y1 = y + BH / 2;
    const isUp = side === "up";
    const ax1 = isUp ? x + BW : centreX;
    const ax2 = isUp ? centreX : rightX;
    const ay2 = focusY + FH / 2;
    const mx = (ax1 + ax2) / 2;
    const marker = drift ? "url(#acd-drift)" : "url(#acd)";
    const dash = node.verificationStatus === "UNKNOWN" ? ` stroke-dasharray="4 3"` : "";
    const name = node.name.length > 17 ? `${node.name.slice(0, 15)}…` : node.name;
    return `<g class="dnode" data-node-id="${escapeHtml(node.id)}">
      <path class="dedge" d="M${fmt(ax1)},${fmt(y1)} C${fmt(mx)},${fmt(y1)} ${fmt(mx)},${fmt(ay2)} ${fmt(ax2)},${fmt(ay2)}" fill="none" stroke="${drift ? "var(--brick)" : "var(--line)"}" stroke-width="${drift ? 2 : 1.25}"${drift ? ` stroke-dasharray="5 4"` : ""} marker-end="${marker}" />
      <text x="${fmt(mx)}" y="${fmt((y1 + ay2) / 2 - 5)}" text-anchor="middle" class="dedge-label" style="fill:${drift ? "var(--brick-700)" : "var(--muted)"}">${escapeHtml(kind)}</text>
      <g class="dbox" tabindex="0" aria-label="${escapeHtml(node.name)}" data-focus="${escapeHtml(node.id)}">
        <rect x="${x}" y="${fmt(y)}" width="${BW}" height="${BH}" rx="7" fill="var(--panel)" stroke="${c}" stroke-width="${drift ? 2 : 1.25}"${dash} />
        <rect x="${x}" y="${fmt(y)}" width="4" height="${BH}" rx="2" fill="${c}" />
        <circle cx="${x + BW - 12}" cy="${fmt(y + 12)}" r="4" fill="${pressureColor(node.pressure.level)}" />
        <text x="${x + 13}" y="${fmt(y + 23)}" class="dbox-name">${escapeHtml(name)}</text>
        <text x="${x + 13}" y="${fmt(y + 40)}" class="dbox-kind">${escapeHtml(node.kind)}</text>
      </g>
    </g>`;
  };

  const fc = statusColor(focus.verificationStatus);
  const fName = focus.name.length > 18 ? `${focus.name.slice(0, 16)}…` : focus.name;
  const fScore = clampScore(focus.pressure.score);
  const fPColor = pressureColor(focus.pressure.level);

  const upCaption =
    upstream.length > 0
      ? `<text x="${leftX + BW / 2}" y="14" text-anchor="middle" class="col-caption">Upstream</text>`
      : "";
  const downCaption =
    downstream.length > 0
      ? `<text x="${rightX + BW / 2}" y="14" text-anchor="middle" class="col-caption">Downstream</text>`
      : "";

  const upBoxes = upstream.map((u, i) => neighborBox("up", leftX, sideY(upstream.length, i), u.node, u.relation.kind)).join("");
  const downBoxes = downstream.map((d, i) => neighborBox("down", rightX, sideY(downstream.length, i), d.node, d.relation.kind)).join("");

  const empty =
    upstream.length === 0 && downstream.length === 0
      ? `<text x="${centreX + FW / 2}" y="${fmt(focusY + FH + 28)}" text-anchor="middle" class="diagram-empty">No relations for this module in the current view.</text>`
      : "";

  const options = pool
    .map((node) => `<option value="${escapeHtml(node.id)}"${node.id === focus!.id ? " selected" : ""}>${escapeHtml(`${node.name} · ${node.kind}`)}</option>`)
    .join("");

  return `<div class="diagram-controls">
    <span class="diagram-label">Focus module</span>
    <select id="focus-select" class="focus-select mono" aria-label="Focus module">${options}</select>
    <span class="diagram-hint">1-hop neighborhood · ${upstream.length} in · ${downstream.length} out</span>
  </div>
  <div class="diagram-scroll">
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(`Architecture diagram focused on ${focus.name}`)}" style="display:block;min-width:${W > 720 ? `${W}px` : "auto"}">
      <defs>
        <marker id="acd" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="var(--faint)" /></marker>
        <marker id="acd-drift" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="var(--brick)" /></marker>
      </defs>
      ${upCaption}
      ${downCaption}
      ${upBoxes}
      ${downBoxes}
      <g class="focus-node">
        <rect x="${centreX}" y="${fmt(focusY)}" width="${FW}" height="${FH}" rx="9" fill="var(--panel)" stroke="${fc}" stroke-width="2.5" />
        <rect x="${centreX}" y="${fmt(focusY)}" width="5" height="${FH}" rx="2.5" fill="${fc}" />
        <text x="${centreX + 16}" y="${fmt(focusY + 26)}" class="focus-name">${escapeHtml(fName)}</text>
        <text x="${centreX + 16}" y="${fmt(focusY + 46)}" class="focus-kind">${escapeHtml(focus.kind)}</text>
        <circle cx="${centreX + 20}" cy="${fmt(focusY + 61)}" r="4" fill="${fPColor}" />
        <text x="${centreX + 28}" y="${fmt(focusY + 65)}" class="focus-pressure" style="fill:${fPColor}">${escapeHtml(`${focus.pressure.level} ${fScore}`)}</text>
        <text x="${centreX + FW - 14}" y="${fmt(focusY + 65)}" text-anchor="end" class="focus-status" style="fill:${fc}">${escapeHtml(focus.verificationStatus)}</text>
      </g>
      ${empty}
    </svg>
  </div>`;
}

// --- helpers ----------------------------------------------------------------

function normalizeFocusId(nodes: ExplorerNodeView[], focusId?: string | null): string | null {
  if (!focusId) return null;
  const ids = new Set(nodes.map((node) => node.id));
  return ids.has(focusId) ? focusId : null;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = Math.ceil(max / 2);
  const tail = Math.floor(max / 2);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function renderPlaceholderComment(): string {
  return `<!-- Dynamic placeholders rendered from ExplorerProjection:
  {{repository.repositoryId}} {{repository.headSha}} {{repository.worktreeDigest}}
  {{capabilities.tokenRequired}} {{capabilities.egress}}
  {{nodes.length}} {{relations.length}} {{driftCount}} {{highCountHighPressure}}
  {{#each nodes}} {{node.id}} {{node.name}} {{node.kind}} {{node.verificationStatus}} {{node.pressure.level}} {{node.pressure.score}} {{/each}}
  {{#each relations}} {{relation.kind}} {{relation.source}} {{relation.target}} {{relation.verificationStatus}} {{/each}}
  {{#focus}} {{focus.name}} {{focus.kind}} {{focus.verificationStatus}} {{focus.pressure.level}} {{focus.pressure.score}} {{/focus}}
  {{#each verification}}{{json}}{{/each}} {{#each interventions}}{{json}}{{/each}} {{landscape|json}}
-->`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// --- static style + script (no external assets) -----------------------------

const BASE_STYLE = `    :root{color-scheme:light;
      --paper:#f6f7f4;--panel:#fff;--panel-sunken:#fbfcfa;--wash:#eef1ec;--wash-strong:#e3e8e1;
      --ink:#172019;--ink-2:#36433b;--muted:#5c675f;--faint:#8a958d;--line:#cbd4ce;--line-soft:#dde3dd;--border-strong:#b3bfb6;
      --ink-green:#176b57;--ink-green-700:#115443;--ink-green-50:#e4efe9;
      --amber:#d08b1f;--amber-700:#a96f12;--amber-50:#fdf4e1;
      --brick:#b6422f;--brick-700:#93331f;--brick-50:#f7e7e2;
      --indigo:#2f5fa8;--indigo-700:#244a85;--indigo-50:#e6ecf5;--slate:#5c675f;
      --font-sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
      --font-mono:ui-monospace,"SF Mono","Menlo","Consolas",monospace;}
    *{box-sizing:border-box}
    body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
    code,pre,kbd,.mono{font-family:var(--font-mono)}
    :focus-visible{outline:2px solid var(--indigo);outline-offset:2px}
    [hidden]{display:none!important}
    h1,h2,h3,p{margin:0}
    main{display:grid;grid-template-columns:minmax(300px,372px) minmax(0,1fr);min-height:100vh}
    .sidebar{border-right:1px solid var(--line);background:var(--panel);padding:20px;overflow:auto}
    .detail{padding:24px;overflow:auto}
    .eyebrow{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 0 10px}
    .eyebrow-flush{margin:0}
    .brand-row{display:flex;align-items:baseline;gap:9px}
    .brandmark{align-self:center;flex:none;padding:0 .42em;height:26px;border-radius:7px;background:var(--ink-green);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:15px;font-weight:700;line-height:1;letter-spacing:0}
    .wordmark{font-size:16px;font-weight:600;letter-spacing:0;color:var(--ink)}
    .brand-sub{font-size:13px;color:var(--muted);font-weight:500}
    .repo-meta{margin-top:8px;display:grid;gap:6px}
    .repo-id{font-size:12px;color:var(--muted);word-break:break-all}
    .repo-refs{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .ref{font-size:12px;color:var(--ink-2);background:var(--panel-sunken);border:1px solid var(--line-soft);border-radius:4px;padding:1px 6px}
    .ref-muted{color:var(--muted)}
    .trust-badge{display:inline-flex;align-items:center;gap:7px;margin-top:12px;height:26px;padding:0 11px;border-radius:999px;background:var(--ink-green-50);color:var(--ink-green-700);font-size:12px;font-weight:600}
    .trust-dot{width:7px;height:7px;border-radius:50%;background:var(--ink-green);flex:none}
    .cmdline{display:flex;align-items:center;gap:8px;margin-top:12px;font-family:var(--font-mono);font-size:12.5px;line-height:1.4;padding:8px 12px;border-radius:6px;background:#11201a;border:1px solid #1f3a30;color:#d6e4dc;overflow-x:auto}
    .cmd-prompt{color:var(--ink-green);font-weight:700;flex:none}
    .cmd-text{white-space:nowrap}
    .cmd-status{margin-left:auto;display:inline-flex;align-items:center;gap:12px;padding-left:12px;flex:none;color:#a7b8ae}
    .cmd-pill{display:inline-flex;align-items:center;gap:5px}
    .cmd-pill-dot{width:6px;height:6px;border-radius:50%}
    .dot-ok{background:var(--ink-green)}
    .dot-neutral{background:#7c8a80}
    .search-wrap{margin:16px 0 12px}
    #search{width:100%;height:36px;border:1px solid var(--line);border-radius:6px;padding:0 11px;font:inherit;font-size:14px;background:var(--paper);color:var(--ink)}
    .chips{display:flex;gap:8px;flex-wrap:wrap}
    .chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;background:var(--wash);color:var(--muted);border:1px solid var(--line);font-size:12px;font-weight:500;white-space:nowrap}
    .chip-danger{background:var(--brick-50);color:var(--brick-700);border-color:transparent}
    .node-list{display:grid;gap:8px}
    .node-row{border:1px solid var(--line);border-radius:8px;padding:11px;background:var(--panel);cursor:pointer;transition:border-color 120ms cubic-bezier(.2,0,.2,1),background 120ms cubic-bezier(.2,0,.2,1);outline:none}
    .node-row:hover,.node-row:focus-within,.node-row.is-active{border-color:var(--ink-green);background:var(--ink-green-50)}
    .node-row.is-dim{opacity:.4}
    .node-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    .node-name{font-size:14px;font-weight:600;line-height:1.25;color:var(--ink)}
    .node-id{display:block;margin-top:6px;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
    .node-meta{display:flex;align-items:center;gap:8px;margin-top:8px}
    .node-kind{font-size:12px;color:var(--muted)}
    .dot-sep{color:var(--faint)}
    .node-level{font-size:12px;font-weight:500;text-transform:capitalize}
    .bar{flex:1;height:5px;border-radius:999px;background:var(--wash);overflow:hidden;min-width:40px}
    .bar-fill{display:block;height:100%}
    .bar-val{font-size:11px;color:var(--faint)}
    .status-badge{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.01em;white-space:nowrap;text-transform:uppercase}
    .badge-dot{width:8px;height:8px;border-radius:50%;flex:none}
    .badge-dot-ring{background:transparent;border:1.5px solid var(--slate)}
    .card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px}
    .card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    .toggle{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:2px;background:var(--panel)}
    .seg{appearance:none;border:none;cursor:pointer;font:inherit;font-size:12px;font-weight:600;padding:4px 13px;border-radius:999px;background:transparent;color:var(--muted)}
    .seg[aria-pressed="true"]{background:var(--ink-green);color:#fff}
    .view{display:block}
    .view-graph{border-radius:6px}
    .ac-pixel-grid-soft{background-image:radial-gradient(var(--line-soft) 1px,transparent 1px);background-size:10px 10px}
    .view-legend{margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--muted)}
    .band-label{font-size:11px;fill:var(--muted);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
    .edge{transition:stroke-opacity 140ms,stroke 140ms,stroke-width 140ms}
    .gnode{cursor:pointer;transition:opacity 140ms}
    .gnode-halo{opacity:0}
    .gnode.is-active .gnode-halo{opacity:1}
    .gnode.is-dim{opacity:.4}
    .gnode-label{font-size:11.5px;fill:var(--ink-2);font-weight:500}
    .gnode.is-active .gnode-label{fill:var(--ink);font-weight:600}
    .diagram-controls{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
    .diagram-label{font-size:12px;color:var(--muted)}
    .focus-select{font:inherit;font-size:13px;padding:5px 9px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);font-family:var(--font-mono)}
    .diagram-hint{font-size:11.5px;color:var(--faint)}
    .diagram-scroll{overflow-x:auto}
    .col-caption{font-size:10px;fill:var(--faint);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
    .dedge{transition:stroke 140ms,stroke-width 140ms}
    .dedge-label{font-size:9.5px;font-family:var(--font-mono)}
    .dbox{cursor:pointer;outline:none}
    .dbox-name{font-size:12px;font-weight:600;fill:var(--ink)}
    .dbox-kind{font-size:10.5px;fill:var(--muted);font-family:var(--font-mono)}
    .dnode.is-dim{opacity:.45}
    .focus-name{font-size:15px;font-weight:700;fill:var(--ink)}
    .focus-kind{font-size:11px;fill:var(--muted);font-family:var(--font-mono)}
    .focus-pressure{font-size:10.5px;font-weight:600}
    .focus-status{font-size:10px;font-weight:700;letter-spacing:.04em}
    .diagram-empty{font-size:12px;fill:var(--muted)}
    .table-wrap{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel)}
    .rel-table{width:100%;border-collapse:collapse;font-size:13px}
    .rel-table th{text-align:left;padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);background:var(--panel-sunken)}
    .rel-table td{padding:9px 12px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
    .rel-kind{font-size:12px;color:var(--indigo-700)}
    .rel-end{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
    .rel-row.is-hot{background:var(--ink-green-50)}
    .rel-drift{border-left:3px dashed var(--brick)}
    .rel-drift .rel-kind{color:var(--brick-700)}
    .json-list{display:grid;gap:8px}
    .json-block{margin:0;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);font-size:12px;line-height:1.5;color:var(--ink-2);overflow:auto;max-height:320px}
    .state-inline{border:1px dashed var(--line);border-radius:8px;padding:22px;color:var(--muted);text-align:center;font-size:13px;background:var(--panel)}
    .state-panel{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:40px 28px;border:1px dashed var(--line);border-radius:8px;background:var(--panel)}
    .state-glyph{width:46px;height:46px;border-radius:50%;border:2px solid var(--line);display:inline-flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;font-family:var(--font-mono)}
    .state-title{font-size:16px;font-weight:600;color:var(--ink)}
    .state-desc{margin:6px auto 0;font-size:13px;color:var(--muted);line-height:1.5;max-width:420px}
    .state-mono{margin-top:8px;font-size:12px;color:var(--faint)}
    .foot-pad{height:24px}
    @media (max-width:820px){
      main{grid-template-columns:1fr}
      .sidebar{border-right:0;border-bottom:1px solid var(--line)}
    }
    @media (prefers-reduced-motion:reduce){*{transition:none!important}}`;

const RUNTIME_SCRIPT = `(function(){
  "use strict";
  var search=document.getElementById("search");
  if(search){
    var url0=new URL(window.location.href);
    search.value=url0.searchParams.get("q")||"";
    search.addEventListener("keydown",function(event){
      if(event.key==="Enter"){
        var url=new URL(window.location.href);
        if(search.value){url.searchParams.set("q",search.value);}else{url.searchParams.delete("q");}
        window.location.href=url.toString();
      }
    });
  }

  // view toggle
  var segGraph=document.getElementById("seg-graph");
  var segDiagram=document.getElementById("seg-diagram");
  var viewGraph=document.getElementById("view-graph");
  var viewDiagram=document.getElementById("view-diagram");
  var legendGraph=document.getElementById("legend-graph");
  var legendDiagram=document.getElementById("legend-diagram");
  function setView(view){
    var graph=view==="graph";
    if(segGraph)segGraph.setAttribute("aria-pressed",String(graph));
    if(segDiagram)segDiagram.setAttribute("aria-pressed",String(!graph));
    if(viewGraph)viewGraph.hidden=!graph;
    if(viewDiagram)viewDiagram.hidden=graph;
    if(legendGraph)legendGraph.hidden=!graph;
    if(legendDiagram)legendDiagram.hidden=graph;
  }
  if(segGraph)segGraph.addEventListener("click",function(){setView("graph");});
  if(segDiagram)segDiagram.addEventListener("click",function(){setView("diagram");});

  // cross-highlight: list rows <-> graph nodes <-> relation rows (shared data-node-id)
  var rows=Array.prototype.slice.call(document.querySelectorAll(".node-row"));
  var gnodes=Array.prototype.slice.call(document.querySelectorAll(".gnode"));
  var dnodes=Array.prototype.slice.call(document.querySelectorAll(".dnode"));
  var edges=Array.prototype.slice.call(document.querySelectorAll(".edge"));
  var relRows=Array.prototype.slice.call(document.querySelectorAll(".rel-row"));
  var allNodeEls=rows.concat(gnodes,dnodes);
  function setHighlight(id){
    allNodeEls.forEach(function(el){
      var match=el.getAttribute("data-node-id")===id;
      el.classList.toggle("is-active",!!id&&match);
      el.classList.toggle("is-dim",!!id&&!match);
    });
    edges.forEach(function(edge){
      var hot=!!id&&(edge.getAttribute("data-source")===id||edge.getAttribute("data-target")===id);
      edge.style.strokeOpacity=id?(hot?"1":"0.35"):"";
      if(hot){edge.setAttribute("stroke-width","2");}
      else if(edge.getAttribute("stroke-dasharray")){edge.setAttribute("stroke-width","1.5");}
      else{edge.setAttribute("stroke-width","1");}
    });
    relRows.forEach(function(rr){
      var hot=!!id&&(rr.getAttribute("data-source")===id||rr.getAttribute("data-target")===id);
      rr.classList.toggle("is-hot",hot);
    });
  }
  function bindHover(el){
    var id=el.getAttribute("data-node-id");
    el.addEventListener("mouseenter",function(){setHighlight(id);});
    el.addEventListener("mouseleave",function(){setHighlight(null);});
    el.addEventListener("focus",function(){setHighlight(id);});
    el.addEventListener("blur",function(){setHighlight(null);});
  }
  allNodeEls.forEach(bindHover);

  // focus: clicking a sidebar row OR a diagram box sets ?focus= and shows diagram
  function gotoFocus(id){
    var url=new URL(window.location.href);
    url.searchParams.set("focus",id);
    window.location.href=url.toString();
  }
  rows.forEach(function(row){
    row.addEventListener("click",function(){
      var id=row.getAttribute("data-node-id");
      if(id)gotoFocus(id);
    });
  });
  Array.prototype.slice.call(document.querySelectorAll(".dbox")).forEach(function(box){
    box.addEventListener("click",function(){
      var id=box.getAttribute("data-focus");
      if(id)gotoFocus(id);
    });
  });
  var sel=document.getElementById("focus-select");
  if(sel)sel.addEventListener("change",function(){if(sel.value)gotoFocus(sel.value);});

  // if the page loaded with ?focus=, open the diagram view directly
  var url1=new URL(window.location.href);
  if(url1.searchParams.get("focus")){setView("diagram");}
})();`;
