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
`namespace` and `mount` objects, which are rejected on other kinds.

### 3. Topology relations `spawns`, `runs-in` and `mounts`

Endpoint-kind rules (for example, a `runs-in` target must be a `namespace`) live in one shared
cross-entity check that both the model store and native-context validation call. These relations
do not declare capability dependencies, the same as `deployed-on`.

### 4. Topology targets appear only for models with topology nodes

The new target types are `diagram-runtime-topology` (Mermaid) and `runtime-topology-summary`
(Markdown). Layout adds them only when the model has topology nodes, and the index page links
them only then. The renderer version does not change: a model with no layer and no topology
data renders byte-identical output and digests in every exporter, the architecture index and
every committed output.

### 5. Topology nodes get no entity-summary pages

The topology summary page covers them.

### 6. Topology targets are whole-model and carry no source stamps

Phase 1 topology is model-authored. Freshness must not report these targets as verified by code
facts. A config-facts provider that reads compose and Kubernetes manifests is a separate phase.
When it is missing or fails, its check fails closed. It never infers topology.

## Invariants

- One field, `layer`, is the layer authority. One function turns it into groups for every
  exporter.
- A model without `layer` and without topology nodes renders exactly the bytes it rendered
  before this decision.
- The same model always renders byte-identical output.

## Non-goals

- No explicit layer stack order. Layers sort by name.
- No live process discovery (`ps`, `/proc`, container runtime APIs).
- No config-facts provider in this phase.
- No cross-repository landscape views.

## Consequences

- Sorting layers by name gives no explicit stack order. An ordered layer list can be added later
  without changing the `layer` field.
- Adopters opt in per node. A model gains layered diagrams only when its nodes declare `layer`,
  so existing committed diagrams stay unchanged until someone edits the model.
- At 10x scale the topology Mermaid diagram becomes unreadable first. Per-namespace pages would
  be the next cut.
