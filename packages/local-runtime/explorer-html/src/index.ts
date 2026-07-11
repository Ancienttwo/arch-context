import type {
  ExplorerOccurrenceV2,
  ExplorerProjectionV2,
  ExplorerRelationOccurrenceV2,
  ExplorerSubjectOccurrenceV2
} from "@archcontext/contracts";
import { renderExplorerTopology } from "./topology";

export interface RenderExplorerHtmlOptions {
  focusSubjectId?: string | null;
}

export function renderExplorerHtml(projection: ExplorerProjectionV2, options: RenderExplorerHtmlOptions = {}): string {
  const subjects = projection.occurrences.filter((item): item is ExplorerSubjectOccurrenceV2 => item.role === "subject");
  const groups = projection.occurrences.filter((item) => item.role === "derived-group");
  const focus = focusOccurrence(subjects, options.focusSubjectId) ?? subjects[0];
  const byOccurrence = new Map(projection.occurrences.map((item) => [item.occurrenceId, item]));
  const verificationCounts = countBy(subjects, (item) => item.verificationStatus);
  const authorityCounts = countBy(subjects, (item) => item.authorityState);
  const viewLinks = projection.availableViews.map((view) => renderViewLink(view, projection.view.id)).join("");
  const levelLinks = (["overview", "context", "detail"] as const).map((level) => `<button type="button" class="seg" data-level="${level}" aria-pressed="${projection.semanticLevel === level}">${titleCase(level)}</button>`).join("");
  const breadcrumb = projection.breadcrumbs.length > 0
    ? `<nav class="breadcrumb" aria-label="Breadcrumb">${projection.breadcrumbs.map((item) => renderBreadcrumb(item, byOccurrence)).join(`<span aria-hidden="true">/</span>`)}</nav>`
    : `<nav class="breadcrumb" aria-label="Breadcrumb"><span>${escapeHtml(projection.view.title)}</span></nav>`;
  const eventUrl = "/events";
  const topology = renderExplorerTopology({ projection, focusSubjectId: options.focusSubjectId });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>ArchContext Explorer</title>
  <style>${STYLE}${INTERACTION_STYLE}${INSPECTOR_STYLE}</style>
</head>
<body>
  <main role="application" aria-label="ArchContext Explorer V2">
    <header class="topbar">
      <div><strong>ArchContext</strong> <span>Explorer</span></div>
      <code>${escapeHtml(projection.cursor.repository.repositoryId)} · ${escapeHtml(short(projection.cursor.worktree.headSha))}</code>
      <span class="trust">● read-only · local · no egress</span>
      <span id="live-status" class="live-status" role="status" aria-live="polite">live updates pending</span>
    </header>
    <section class="controls" aria-label="Explorer controls">
      <div class="views" role="group" aria-label="Architecture view">${viewLinks}</div>
      <div class="levels" role="group" aria-label="Semantic level">${levelLinks}</div>
      <label class="budget">budget <span>${projection.page.returnedNodes}/${projection.page.budget.maxNodes} nodes · ${projection.page.returnedRelations}/${projection.page.budget.maxRelations} relations</span></label>
    </section>
    ${breadcrumb}
    ${projection.cursor.observedAvailability.status === "unavailable" ? `<div class="notice" role="status">Observed facts unavailable: ${escapeHtml(projection.cursor.observedAvailability.reasonCode ?? "unavailable")}. Declared system map remains authoritative; task and pressure views stay disabled.</div>` : ""}
    ${projection.page.truncated ? `<div class="notice" role="status">Bounded result: ${projection.page.omittedNodeCount} nodes and ${projection.page.omittedRelationCount} relations omitted.</div>` : ""}
    <div class="layout">
      <aside class="sidebar" aria-label="Occurrences">
        <label class="search-label" for="search">Filter current bounded result</label>
        <input id="search" type="search" autocomplete="off" placeholder="Name, kind, status…">
        <div class="stats">
          <span>${subjects.length} subjects</span><span>${groups.length} groups</span>
          <span>${verificationCounts.DRIFT ?? 0} drift</span><span>${authorityCounts.UNBOUND_OBSERVED ?? 0} unbound</span>
        </div>
        <div id="occurrence-list" class="occurrence-list">${projection.occurrences.map(renderOccurrence).join("") || empty("No occurrences in this bounded view.")}</div>
      </aside>
      <section class="content">
        <section class="card" aria-labelledby="map-heading">
          <div class="card-head"><div><span class="eyebrow">${escapeHtml(projection.view.question)}</span><h1 id="map-heading">${escapeHtml(projection.view.title)}</h1></div><div class="topology-actions" role="group" aria-label="Topology view controls"><button type="button" data-topology-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-topology-action="fit" aria-label="Fit topology">Fit</button><button type="button" data-topology-action="zoom-in" aria-label="Zoom in">+</button><code>${escapeHtml(projection.semanticLevel)}</code></div></div>
          ${topology.svg}
        </section>
        <section class="card" aria-labelledby="relations-heading">
          <div class="card-head"><h2 id="relations-heading">Relations</h2><span>${projection.relations.length}</span></div>
          ${renderRelations(projection.relations, byOccurrence)}
        </section>
        <section class="card inspector" aria-labelledby="inspector-heading">
          <div class="card-head"><div><span class="eyebrow">Canonical subject</span><h2 id="inspector-heading">Inspector</h2></div></div>
          ${focus ? renderInspector(focus, projection) : empty("Select a subject to inspect authority, constraints and backlinks.")}
        </section>
      </section>
    </div>
  </main>
  <script>${runtimeScript(eventUrl, projection.projectionDigest, projection.cursor.viewDefinitionDigest)}</script>
</body>
</html>`;
}

function renderViewLink(view: ExplorerProjectionV2["availableViews"][number], active: string): string {
  return `<button type="button" class="view-button" data-view="${view.id}" aria-pressed="${view.id === active}"${view.enabled ? "" : " disabled"}${view.reason ? ` title="${escapeHtml(view.reason)}"` : ""}>${escapeHtml(titleCase(view.id))}${view.enabled ? "" : " · unavailable"}</button>`;
}

function renderBreadcrumb(item: ExplorerProjectionV2["breadcrumbs"][number], byOccurrence: Map<string, ExplorerOccurrenceV2>): string {
  const occurrence = byOccurrence.get(item.occurrenceId);
  if (occurrence?.role === "subject") {
    const id = occurrence.subjectRefs.find((ref) => ref.kind === "architecture-entity")?.id ?? occurrence.subjectRefs[0]?.id;
    if (id) return `<button type="button" data-breadcrumb-focus="${escapeHtml(id)}">${escapeHtml(item.label)}</button>`;
  }
  return `<button type="button" data-breadcrumb-level="overview">${escapeHtml(item.label)}</button>`;
}

function renderOccurrence(occurrence: ExplorerOccurrenceV2): string {
  if (occurrence.role === "derived-group") {
    return `<button type="button" class="occurrence group" data-expand="${escapeHtml(occurrence.occurrenceId)}" aria-label="Expand ${escapeHtml(occurrence.name)}"><span>▸ ${escapeHtml(occurrence.name)}</span><small>${occurrence.childrenCount} children · derived</small></button>`;
  }
  const subjectId = occurrence.subjectRefs.find((ref) => ref.kind === "architecture-entity")?.id ?? occurrence.subjectRefs[0]?.id ?? "";
  return `<button type="button" class="occurrence subject" data-focus="${escapeHtml(subjectId)}" data-search="${escapeHtml([occurrence.name, occurrence.kind, occurrence.verificationStatus, occurrence.authorityState, ...occurrence.pressure.signals].join(" ").toLowerCase())}"><span>${escapeHtml(occurrence.name)}</span><small>${escapeHtml(occurrence.kind)} · ${escapeHtml(occurrence.verificationStatus)} · ${escapeHtml(occurrence.authorityState)}</small></button>`;
}

function renderRelations(relations: ExplorerRelationOccurrenceV2[], byOccurrence: Map<string, ExplorerOccurrenceV2>): string {
  if (relations.length === 0) return empty("No relations in this bounded projection.");
  return `<div class="table-wrap"><table><thead><tr><th>Kind</th><th>Source</th><th>Target</th><th>Authority</th></tr></thead><tbody>${relations.map((relation) => {
    const source = byOccurrence.get(relation.sourceOccurrenceId);
    const target = byOccurrence.get(relation.targetOccurrenceId);
    const authority = relation.provenance.declaredRelationIds.length > 0 ? "declared" : "observed";
    return `<tr><td><code>${escapeHtml(relation.kind)}</code></td><td>${escapeHtml(source?.name ?? relation.sourceOccurrenceId)}</td><td>${escapeHtml(target?.name ?? relation.targetOccurrenceId)}</td><td>${authority}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function renderInspector(focus: ExplorerSubjectOccurrenceV2, projection: ExplorerProjectionV2): string {
  const refs = focus.subjectRefs.map((ref) => `<code>${escapeHtml(`${ref.kind}:${ref.id}`)}</code>`).join(" ");
  const constraints = focus.inspector.constraints.map((item) => `<li><code>${escapeHtml(item.id)}</code> ${escapeHtml(item.summary ?? item.kind)}${item.severity ? ` · ${escapeHtml(item.severity)}` : ""}</li>`).join("");
  const decisions = focus.inspector.decisions.map(renderInspectorEvent).join("");
  const historyEvents = focus.inspector.historyEvents.map(renderInspectorEvent).join("");
  const selectors = focus.inspector.sourceSelectors.map((item) => `<li><code>${escapeHtml(item.path)}${item.symbolId ? `#${escapeHtml(item.symbolId)}` : ""}</code></li>`).join("");
  const backlinks = focus.backlinks;
  return `<div class="inspector-grid">
    <div><h3>${escapeHtml(focus.name)}</h3><p>${escapeHtml(focus.inspector.summary ?? "No declared summary.")}</p><p><strong>Responsibility:</strong> ${escapeHtml(focus.inspector.responsibility ?? "Not declared.")}</p><div class="refs">${refs}</div></div>
    <dl><dt>Verification</dt><dd>${focus.verificationStatus}</dd><dt>Authority</dt><dd>${focus.authorityState}</dd><dt>Pressure</dt><dd>${focus.pressure.evaluated ? `${focus.pressure.level} ${focus.pressure.score}` : "not evaluated"}</dd><dt>Bindings</dt><dd>${focus.inspector.evidenceBindingIds.length}</dd></dl>
    <div><h3>Constraints</h3>${constraints ? `<ul>${constraints}</ul>` : emptyInline("None")}</div>
    <div><h3>Decisions</h3>${decisions ? `<ul>${decisions}</ul>` : emptyInline("None")}</div>
    <div><h3>History</h3>${historyEvents ? `<ul>${historyEvents}</ul>` : emptyInline("None")}</div>
    <div><h3>Source selectors</h3>${selectors ? `<ul>${selectors}</ul>` : emptyInline("None")}</div>
    <div><h3>Evidence bindings</h3>${renderCodeList(focus.inspector.evidenceBindingIds)}</div>
    <div><h3>Backlinks</h3><dl><dt>Views</dt><dd>${renderCodeList(backlinks.appearsInViews)}</dd><dt>Tasks</dt><dd>${renderCodeList(backlinks.affectedByTaskSessionIds)}</dd><dt>Constraints</dt><dd>${renderCodeList(backlinks.constrainedByIds)}</dd><dt>Evidence</dt><dd>${renderCodeList(backlinks.evidencedByBindingIds)}</dd><dt>Changed by</dt><dd>${renderCodeList(backlinks.changedByEventIds)}</dd><dt>Decided by</dt><dd>${renderCodeList(backlinks.decidedByEventIds)}</dd><dt>Incoming relations</dt><dd>${renderCodeList(backlinks.incomingRelationIds)}</dd><dt>Outgoing relations</dt><dd>${renderCodeList(backlinks.outgoingRelationIds)}</dd></dl></div>
    <details class="technical-details"><summary>Technical details</summary><dl><dt>Authority cursor</dt><dd><code>${escapeHtml(projection.cursor.authorityCursor?.eventId ?? "git-authority")}</code></dd><dt>Evidence cursor</dt><dd><code>${escapeHtml(projection.cursor.evidenceAuthorityCursor?.eventId ?? "none")}</code></dd><dt>Manifest</dt><dd><code>${escapeHtml(projection.inputManifest.manifestDigest)}</code></dd><dt>Projection</dt><dd><code>${escapeHtml(projection.projectionDigest)}</code></dd><dt>Graph</dt><dd><code>${escapeHtml(projection.cursor.graphDigest)}</code></dd><dt>View definition</dt><dd><code>${escapeHtml(projection.cursor.viewDefinitionDigest)}</code></dd></dl></details>
  </div>`;
}

function renderInspectorEvent(item: { eventId: string; title?: string; rationale?: string }): string {
  const metadata = [item.title, item.rationale].filter((value): value is string => Boolean(value));
  return `<li><code>${escapeHtml(item.eventId)}</code>${metadata.length > 0 ? ` ${escapeHtml(metadata.join(" · "))}` : ""}</li>`;
}

function renderCodeList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `<code>${escapeHtml(item)}</code>`).join(" ") : `<span class="muted">none</span>`;
}

function focusOccurrence(subjects: ExplorerSubjectOccurrenceV2[], subjectId?: string | null): ExplorerSubjectOccurrenceV2 | undefined {
  if (!subjectId) return undefined;
  return subjects.find((item) => item.subjectRefs.some((ref) => ref.id === subjectId));
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) result[key(item)] = (result[key(item)] ?? 0) + 1;
  return result;
}

function runtimeScript(eventUrl: string, projectionDigest: string, viewDefinitionDigest: string): string {
  return `(function(){"use strict";
  function navigate(change){var u=new URL(window.location.href);Object.keys(change.set||{}).forEach(function(key){u.searchParams.set(key,change.set[key]);});(change.remove||[]).forEach(function(key){u.searchParams.delete(key);});window.location.href=u.toString();}
  function toggleExpand(value){var u=new URL(window.location.href);var values=u.searchParams.getAll("expand");u.searchParams.delete("expand");var found=false;values.forEach(function(current){if(current===value){found=true;}else{u.searchParams.append("expand",current);}});if(!found)u.searchParams.append("expand",value);window.location.href=u.toString();}
  document.querySelectorAll("[data-view]").forEach(function(el){el.addEventListener("click",function(){navigate({set:{view:el.getAttribute("data-view")}});});});
  document.querySelectorAll("[data-level]").forEach(function(el){el.addEventListener("click",function(){navigate({set:{level:el.getAttribute("data-level")}});});});
  document.querySelectorAll("[data-focus]").forEach(function(el){el.addEventListener("click",function(){navigate({set:{focus:el.getAttribute("data-focus"),level:"detail"}});});});
  document.querySelectorAll("[data-expand]").forEach(function(el){el.addEventListener("click",function(){toggleExpand(el.getAttribute("data-expand"));});});
  document.querySelectorAll("[data-breadcrumb-focus]").forEach(function(el){el.addEventListener("click",function(){navigate({set:{focus:el.getAttribute("data-breadcrumb-focus"),level:"detail"}});});});
  document.querySelectorAll("[data-breadcrumb-level]").forEach(function(el){el.addEventListener("click",function(){navigate({set:{level:el.getAttribute("data-breadcrumb-level")},remove:["focus"]});});});
  var search=document.getElementById("search");if(search){search.addEventListener("input",function(){var q=search.value.trim().toLowerCase();document.querySelectorAll("[data-search]").forEach(function(el){el.hidden=!!q&&!(el.getAttribute("data-search")||"").includes(q);});});}
  var viewport=document.querySelectorAll("[data-topology-viewport]")[0];var svg=document.querySelectorAll(".topology-svg")[0];var scale=1,tx=0,ty=0,drag=null;
  function applyTransform(){if(viewport)viewport.setAttribute("transform","translate("+Math.round(tx)+" "+Math.round(ty)+") scale("+scale.toFixed(2)+")");}
  function zoom(delta){scale=Math.max(.5,Math.min(2.5,Math.round((scale+delta)*100)/100));applyTransform();}
  document.querySelectorAll("[data-topology-action]").forEach(function(el){el.addEventListener("click",function(){var action=el.getAttribute("data-topology-action");if(action==="zoom-in")zoom(.2);else if(action==="zoom-out")zoom(-.2);else{scale=1;tx=0;ty=0;applyTransform();}});});
  if(svg){svg.addEventListener("wheel",function(event){if(event.preventDefault)event.preventDefault();zoom(event.deltaY<0?.1:-.1);});svg.addEventListener("pointerdown",function(event){drag={x:event.clientX,y:event.clientY,tx:tx,ty:ty};if(svg.setPointerCapture&&event.pointerId!==undefined)svg.setPointerCapture(event.pointerId);});svg.addEventListener("pointermove",function(event){if(!drag)return;tx=drag.tx+event.clientX-drag.x;ty=drag.ty+event.clientY-drag.y;applyTransform();});svg.addEventListener("pointerup",function(){drag=null;});svg.addEventListener("pointercancel",function(){drag=null;});}
  window.addEventListener("keydown",function(event){var target=event.target||{};var tag=(target.tagName||"").toUpperCase();if(target.isContentEditable||tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return;if(event.key==="+"){zoom(.2);}else if(event.key==="-"){zoom(-.2);}else if(event.key==="0"){scale=1;tx=0;ty=0;applyTransform();}else{return;}if(event.preventDefault)event.preventDefault();});
  var current=${JSON.stringify(projectionDigest)};var currentView=${JSON.stringify(viewDefinitionDigest)};var live=document.getElementById("live-status");var reloadTimer=null;var source=null;
  function liveState(value){if(live){live.textContent=value;live.setAttribute("data-live-state",value==="live updates connected"?"connected":"disconnected");}}
  function disconnect(){if(reloadTimer!==null){window.clearTimeout(reloadTimer);reloadTimer=null;}if(source)source.close();liveState("live updates disconnected");}
  function scheduleReload(){if(reloadTimer!==null)return;reloadTimer=window.setTimeout(function(){reloadTimer=null;window.location.reload();},120);}
  var token=new URL(window.location.href).searchParams.get("token");if(token&&window.EventSource){source=new window.EventSource(${JSON.stringify(eventUrl)}+"?token="+encodeURIComponent(token));source.addEventListener("open",function(){liveState("live updates connected");});source.addEventListener("authority-changed",function(){scheduleReload();});source.addEventListener("projection-invalidated",function(event){try{var data=JSON.parse(event.data);if(data.viewDefinitionDigest===currentView&&data.projectionDigest&&data.projectionDigest!==current)scheduleReload();}catch(_){disconnect();}});source.addEventListener("error",disconnect);}else{liveState("live updates disconnected");}
})();`;
}

function empty(message: string): string { return `<div class="empty">${escapeHtml(message)}</div>`; }
function emptyInline(message: string): string { return `<span class="muted">${escapeHtml(message)}</span>`; }
function short(value: string): string { return value.length <= 12 ? value : `${value.slice(0, 12)}…`; }
function titleCase(value: string): string { return value.split("-").map((item) => item.charAt(0).toUpperCase() + item.slice(1)).join(" "); }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }

const STYLE = `:root{color-scheme:light;--paper:#f4f6f2;--panel:#fff;--ink:#18211b;--muted:#627067;--line:#d3dbd5;--green:#176b57;--green-soft:#e3f0ea;--red:#ad402f;--red-soft:#f6e6e1;--blue:#315e9f;--blue-soft:#e8eef7;--amber:#a66d16;--amber-soft:#fbf1dc;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-size:14px}button,input{font:inherit}:focus-visible{outline:3px solid var(--blue);outline-offset:2px}.topbar{display:flex;align-items:center;gap:14px;padding:14px 20px;background:#112019;color:#eef6f1}.topbar code{margin-left:auto}.topbar span{color:#aebbb3}.trust{font-size:12px;color:#94d2bd!important}.controls{display:flex;gap:16px;align-items:center;padding:12px 20px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}.views,.levels{display:flex;gap:6px}.view-button,.seg{border:1px solid var(--line);background:var(--panel);padding:7px 10px;border-radius:7px;cursor:pointer}.view-button[aria-pressed=true],.seg[aria-pressed=true]{background:var(--green);border-color:var(--green);color:#fff}.view-button:disabled{cursor:not-allowed;opacity:.45}.budget{margin-left:auto;color:var(--muted);font-size:12px}.breadcrumb{padding:10px 20px;display:flex;gap:8px;color:var(--muted);font-size:12px}.notice{margin:0 20px 10px;padding:9px 12px;background:var(--amber-soft);color:var(--amber);border:1px solid #ead3a5;border-radius:7px}.layout{display:grid;grid-template-columns:minmax(280px,350px) minmax(0,1fr);gap:16px;padding:0 20px 20px}.sidebar,.card{background:var(--panel);border:1px solid var(--line);border-radius:10px}.sidebar{padding:14px;align-self:start;position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto}.search-label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}#search{width:100%;padding:9px;border:1px solid var(--line);border-radius:7px}.stats{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.stats span{font-size:11px;background:var(--paper);border:1px solid var(--line);padding:4px 7px;border-radius:99px}.occurrence-list{display:grid;gap:6px}.occurrence{text-align:left;border:1px solid var(--line);background:var(--panel);border-radius:7px;padding:9px 10px;cursor:pointer}.occurrence:hover{border-color:var(--green)}.occurrence span,.occurrence small{display:block}.occurrence small{margin-top:4px;color:var(--muted)}.group{background:var(--green-soft)}.content{display:grid;gap:16px}.card{padding:16px}.card-head{display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:14px}.card-head h1,.card-head h2{margin:3px 0 0}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.topology{overflow:auto;border:1px solid var(--line);border-radius:9px;background:linear-gradient(90deg,transparent 19px,var(--line) 20px,transparent 21px),linear-gradient(transparent 19px,var(--line) 20px,transparent 21px);background-size:20px 20px}.topology-svg{display:block;min-width:640px}.topology-band rect{fill:var(--paper);stroke:var(--line);stroke-dasharray:4 4;opacity:.9}.topology-band.status-drift rect{fill:var(--red-soft);stroke:var(--red)}.topology-band text{font-size:10px;font-weight:700;letter-spacing:.05em;fill:var(--muted)}.topology-edge polyline{stroke:var(--line);stroke-width:1.5;vector-effect:non-scaling-stroke}.topology-edge text{font-size:10px;fill:var(--muted);font-family:ui-monospace,monospace}.topology-edge marker path,#topology-arrow path{fill:var(--muted)}.topology-node{cursor:pointer}.topology-node rect{fill:var(--panel);stroke:var(--muted);stroke-width:1.5;vector-effect:non-scaling-stroke}.topology-node.group rect{fill:var(--green-soft);stroke:var(--green)}.topology-node.status-verified rect{stroke:var(--green)}.topology-node.status-matched rect{stroke:var(--blue)}.topology-node.status-drift rect{stroke:var(--red);stroke-width:2.5;stroke-dasharray:6 4}.topology-name{font-size:13px;font-weight:700;fill:var(--ink)}.topology-meta{font-size:10px;fill:var(--muted);font-family:ui-monospace,monospace}.topology-empty{font-size:13px;fill:var(--muted)}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}th{font-size:11px;text-transform:uppercase;color:var(--muted)}.inspector-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.inspector h3{margin:0 0 7px}.inspector p,.inspector ul,.inspector dl{margin:0}.inspector ul{padding-left:18px}.inspector li{margin:5px 0}.inspector dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px}.inspector dt{color:var(--muted)}.refs{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.refs code{padding:3px 6px;background:var(--paper);border-radius:4px}.empty{padding:24px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:8px}.muted{color:var(--muted)}@media(max-width:850px){.layout{grid-template-columns:1fr}.sidebar{position:static;max-height:none}.inspector-grid{grid-template-columns:1fr}.budget{margin-left:0}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;
const INTERACTION_STYLE = `.live-status{font-size:11px;color:#aebbb3}.live-status[data-live-state=connected]{color:#94d2bd}.live-status[data-live-state=disconnected]{color:#f0bd72}.breadcrumb button{appearance:none;border:0;background:transparent;color:inherit;padding:0;text-decoration:underline;cursor:pointer}.topology-actions{display:flex;align-items:center;gap:6px}.topology-actions button{border:1px solid var(--line);background:var(--panel);border-radius:6px;min-width:32px;height:30px;cursor:pointer}.topology-actions code{margin-left:4px}.topology-svg{cursor:grab;touch-action:none}.topology-svg:active{cursor:grabbing}[data-topology-viewport]{transform-origin:0 0}@media(prefers-reduced-motion:reduce){[data-topology-viewport]{transition:none!important}}`;
const INSPECTOR_STYLE = `.technical-details{grid-column:1/-1;border-top:1px solid var(--line);padding-top:12px}.technical-details summary{cursor:pointer;color:var(--muted);font-weight:600}.technical-details dl{margin-top:10px}.inspector-grid dd code{overflow-wrap:anywhere}.inspector-grid p+ p{margin-top:8px}`;
