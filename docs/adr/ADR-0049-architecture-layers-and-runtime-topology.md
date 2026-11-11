---
schemaVersion: archcontext.adr/v1
id: adr.0049.architecture-layers-and-runtime-topology
title: Architecture Layers and the Runtime Topology View
status: proposed
decidedAt: 2026-10-25
appliesTo:
  - module.architecture-context.contracts
  - component.architecture-context.projection-renderer
  - module.architecture-context.surfaces
supersedes: []
---

# ADR-0049: Architecture Layers and the Runtime Topology View

## Context

Projects that adopt archctx want two more generated architecture views, published by the
rolling writer (ADR-0048) with no second generator (issue #402):

1. A layered architecture diagram, with nodes grouped by layer.
2. A runtime topology diagram: processes, the namespaces they run in, and the mount layers
   they see.

Before this decision `exportMermaidModel` wrote a flat `flowchart LR` with one line per node and
one edge per relation. The node schema had `parent` but no layer. Node kinds included
`deployment` and relation kinds included `deployed-on`, but the model had no process, namespace
or mount concept. The only code-facts provider (CodeGraph) does not index compose, Kubernetes,
systemd or launchd configuration, where runtime topology lives.

Many nodes already carry a `parent` chain. It drives capability ownership and source-footprint
roll-up, and the diagram exporters ignore it today.

## Decision

### 1. Layer authority is an explicit optional `layer` node field

`schemas/repo/architecture-node.schema.json` gains an optional `layer`: a lowercase kebab slug
(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`). It is the only layer authority. A layer is never derived from
an id prefix, a name or the `parent` chain. Grouping by `parent` would change committed diagram
output for every adopter and would give one field two meanings.

One function, `architectureLayerGroups` in `@archcontext/core/projection-engine`, computes the
grouping: layers sorted by name, each with its nodes sorted by id, plus the nodes without a
layer. Every diagram exporter uses it, so the exports cannot disagree:

- Mermaid (`exportMermaidModel`): one `subgraph layer__<slug>["<layer>"]` … `end` block per
  layer. Nodes without a layer keep their original lines and edges are unchanged. A node's
  Mermaid id never contains `__`, so a subgraph id cannot collide with a node id.
- LikeC4 (documentation export and `adapter-likec4`): one view `group "<layer>" { include … }`
  per layer inside `view index`, ahead of `include *`, because an element stays in the first
  group that includes it.
- Structurizr (documentation export and `adapter-structurizr`): the element `group` property is
  the node's layer.

The model loader and the grouping function fail closed with `architecture-node-layer-invalid` on
a layer that is not a slug. They never drop or coerce it.

### 2. Topology uses new node kinds `process`, `namespace` and `mount`

New kinds, not a `deployment` subkind. New kinds allow per-kind schema rules (for example, a
`mount` requires `mount.target`) and leave `deployment` as it is. Kind-specific data lives in
`namespace` and `mount` objects, which are rejected on other kinds:

- A `namespace` node requires `namespace.type`: `host`, `container`, `pod`, `kubernetes`, or a
  Linux namespace kind (`pid`, `mount`, `net`, `user`).
- A `mount` node requires `mount.target` (an absolute path with no empty segment), `mount.mode`
  (`ro` or `rw`) and `mount.order` (an integer, 0 or more). `mount.source` is optional, because
  some mounts (an anonymous `tmpfs`, for example) have none. `order` is required so a stack never
  depends on a default: a stack renders by `order`, then by id. Nothing is inferred for an
  absent mode or order; the schema rejects the node.

Topology nodes may declare `source.include`: the configuration files they describe (see 6).

### 3. Topology relations `spawns`, `runs-in` and `mounts`

Endpoint-kind rules live in one shared cross-entity check, `runtimeTopologyModelIssues` in
`@archcontext/contracts`. Native-context validation, the YAML model store (`archctx check`) and
the topology renderer all call it, and each fails closed on any issue:

- `spawns` connects two processes, `runs-in` a process to a namespace, and `mounts` a process or a
  namespace to a mount (`topology-relation-source-kind-invalid`,
  `topology-relation-target-kind-invalid`, `topology-relation-endpoint-missing`).
- A process `runs-in` at most one namespace, the innermost one
  (`topology-process-namespace-ambiguous`). Outer namespaces come from the namespace `parent`
  chain, so a diagram never has to place one process in two subgraphs.
- A mount has at most one mounter (`topology-mount-mounter-ambiguous`): a mount node is one entry
  of one mount table.
- A namespace `parent`, when present, is another namespace with no cycle
  (`topology-namespace-parent-missing`, `topology-namespace-parent-kind-invalid`,
  `topology-namespace-parent-cycle`). It is the nesting the view draws.

These relations do not declare capability dependencies, the same as `deployed-on`.

### 4. Topology targets appear only for models with topology nodes

The new target types are `diagram-runtime-topology` (Mermaid,
`docs/architecture/diagrams/runtime-topology.mmd`) and `runtime-topology-summary` (Markdown,
`docs/architecture/runtime-topology.md`), both scoped `{ kind: "diagram", id: "runtime-topology" }`.
Layout adds them only when the model has topology nodes, and the index page links them only then.
Both are `generated` (whole-file) targets, the summary page included: the targets come and go with
the model's topology, and a whole-file output whose manifest row the layout no longer renders is
an orphan, so removing the topology removes the files.

The Mermaid view is a `flowchart TB`. Each namespace is a subgraph that holds the processes that
run in it and its nested namespaces; a process with no namespace sits at the top level. Each
mounting process or namespace gets one stack subgraph with its mounts in stack order, held in order
by invisible links. Edges are `spawns`, `mounts`, and `deployed-on` relations whose target is a
topology node, so the view links to the logical components. The summary page lists namespaces,
processes and every mount stack, and links the diagram the way the index links diagrams.

In the other exporters a topology kind maps explicitly. LikeC4 declares `element process`,
`element namespace` and `element mount` only when the model has such a node. Structurizr maps a
namespace to `Deployment Node`, a process to `Container Instance` and a mount to
`Infrastructure Node`. The semantic P1 flowchart keeps its four node styles, so a topology
participant there is styled as a component; a new style would rewrite every P1 diagram. The renderer version does not change: a model with no layer and no topology
data renders byte-identical output and digests in every exporter, the architecture index and
every committed output.

### 5. Topology nodes get no entity-summary pages

The topology summary page covers them.

### 6. Topology configuration files are listed, not tracked

> Amended by [#549](https://github.com/Ancienttwo/arch-context/issues/549) on 2026-11-12. ADR-0056 §7 removed the topology stamps this section first defined.

The topology is model-authored. An agent reads compose, Kubernetes or other configuration and
writes the topology into the model through a normal ChangeSet; archctx validates and renders it.
archctx never parses that configuration and never infers topology from it.

A topology node may list the configuration files it describes in `source.include` (for example
`compose.yaml` or `k8s/*.yaml`). The list tells a reader which files to read when they check the
topology.

- The summary page lists every topology node's `source.include` patterns. A node without them is
  shown as model-authored with no source anchor.
- No command reports a change to a listed file. Topology rows carry no stamps (ADR-0056 §7), a
  topology node has no confirmed digest, and no architecture debt kind covers it. The change that
  edits a listed file is the one that keeps the topology in step with it.

There is no replacement signal, for three reasons:

- No model that projects a topology lists a configuration file. On 2026-11-12 aimpact-inc/repo-harness
  had 14 topology nodes, none with `source.include` now or in its history, and this repository had none.
- The stamp signal never confirmed anything. Re-projecting, including the rolling writer's own
  publish, re-stamped the rows whether or not anyone had read the change.
- A confirmed digest (ADR-0054 §7) on a configuration file can only cover the whole file, because no
  symbol reader parses YAML. Every edit to the file, such as an image tag or an environment value,
  would become debt, and every debt item blocks `complete` until a ChangeSet writes a new digest.

A later decision may add confirmed-digest anchors for topology nodes once a repository lists
configuration files and asks for the signal. It would extend ADR-0054 §7 and §8 and would not
change the projection.

### 7. Mermaid check tool

`scripts/check-architecture-mermaid.mjs` (`bun run check:architecture-mermaid`, part of `verify`
and `verify:pre`) checks every Mermaid block under `docs/architecture/`: generated `.mmd` files and
the Mermaid fences of every Markdown file, generated regions and human-authored text alike.

- Syntax check (CI): it runs `mermaid.parse` in Node on each block and prints JSON with `file`,
  `line`, `heading`, `ok` and `error` per block. Any parse error makes it exit non-zero. Mermaid
  needs a `window` only for its DOMPurify hooks, so a linkedom window is the DOM shim; no browser
  starts.
- Render check (agent): `--render-page [<dir>]` also writes `index.html` with every block embedded
  and a copy of `mermaid.min.js` beside it, so the page works offline. Opened in an agent's own
  browser, it runs `mermaid.parse` and `mermaid.render` per block and publishes one result per
  block (ok or error, SVG width and height) in `window.__results`. The page is temporary output and
  is never committed.

`mermaid` is a devDependency pinned to one exact version, which the script checks. The release
package still declares no Mermaid or browser runtime, and the tool adds no Chromium, Playwright or
mermaid-cli.

## Invariants

- One field, `layer`, is the layer authority. One function turns it into groups for every
  exporter.
- A model without `layer` and without topology nodes renders exactly the bytes it rendered
  before this decision.
- The same model always renders byte-identical output.

## Non-goals

- No explicit layer stack order. Layers sort by name.
- No live process discovery (`ps`, `/proc`, container runtime APIs).
- No configuration parser. archctx does not read compose or Kubernetes manifests in any phase. A
  configuration file is only a path that the model lists.
- No cross-repository landscape views.

## Consequences

- Sorting layers by name gives no explicit stack order. An ordered layer list can be added later
  without changing the `layer` field.
- Adopters opt in per node. A model gains layered diagrams only when its nodes declare `layer`,
  so existing committed diagrams stay unchanged until someone edits the model.
- At 10x scale the topology Mermaid diagram becomes unreadable first. Per-namespace pages would
  be the next cut.
