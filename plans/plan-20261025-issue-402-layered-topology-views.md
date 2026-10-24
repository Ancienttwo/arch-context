# Plan: layered architecture view and runtime topology view (#402)

> **Status**: Review
> **Owner**: Claude
> **Base**: b4d62fa7

## Authorization

The user asked to dispatch and execute downstream issue #402. Phase 1 only.
The config-facts provider (phase 2), live process discovery and cross-repo views
stay out of scope.

## P1 map

Node and relation kinds are enumerated only by `schemas/repo/architecture-node.schema.json`
and `architecture-relation.schema.json`; TS reads kinds as `string`. Cross-entity
model checks live in `nativeContextModelIssues` (`packages/contracts/src/native-context.ts`).
`YamlModelStore.validateModel` schema-checks nodes but not relations.
Diagram exporters: `exportMermaidModel`, `exportDocumentationLikeC4Model` and
`exportDocumentationStructurizrWorkspace` in `packages/core/projection-engine/src/index.ts`,
plus the surface adapters `adapter-likec4` and `adapter-structurizr`. None reads `parent`.
Target types are registered in `contracts/src/ledger.ts`, `contracts/src/projection-manifest.ts`,
the two runtime projection schemas, `projection-engine/src/layout.ts`,
`renderTargetGeneratedBody`, and the default placement rules in `model-store-yaml`.

## P2 trace

A node YAML file goes through `nativeModelFromYamlObjects` into `normalizeNativeModel`
(sorted by id), then to each exporter through `renderTargetGeneratedBody`, keyed by
the manifest target type. Layout derives the target set from the model, so a
model-conditional target is possible. Source stamps exist only for entity-summary
targets whose node declares `source.include`; whole-model targets carry no code facts.

## P3 decisions

1. **Layer authority: a first-class optional `layer` node field**, not the parent chain.
   This repository already has parent chains on 50 nodes. They drive capability
   ownership and footprint roll-up. Grouping by parent would change committed diagram
   output for every adopter and would give one field two meanings.
   `layer` is a slug string. Layers sort by name. Nodes without a layer render outside
   any group. One function in one package computes the groups and feeds every exporter.
2. **Topology: new node kinds `process`, `namespace`, `mount`**, not a `deployment`
   subkind. New kinds allow per-kind schema rules (`if kind = mount then mount.target
   required`) and leave `deployment` as it is. Kind-specific data goes in `namespace`
   and `mount` objects, which are rejected on other kinds.
3. **Relations `spawns`, `runs-in`, `mounts`**, with endpoint-kind rules in one shared
   cross-entity check that the model store and native-context validation both call.
   They do not declare capability dependencies (same as `deployed-on`).
4. **Targets `diagram-runtime-topology` (Mermaid) and `runtime-topology-summary`
   (Markdown)** appear only when the model has topology nodes. The index page links
   them only then. No renderer version bump: models without layer or topology data
   render byte-identical output.
5. Topology nodes do not get entity-summary pages; the topology summary covers them.
6. Topology targets are whole-model and carry no source stamps. Freshness must not
   report them as verified by code facts.

Tradeoff: `layer` sorted by name gives no explicit stack order. An ordered layer list
can be added later without changing the field. At 10x, the topology Mermaid becomes
unreadable first; per-namespace pages would be the next cut.

## Task Breakdown

- [x] Slice A: `layer` field, shared grouping function, grouped output in all exporters, fixtures, ADR.
- [x] Slice B: topology kinds, relations, validation, targets, renderers, fixtures.
- [x] Typecheck and affected tests; Mermaid parse check on generated output.
- [ ] Acceptance gate; open PR referencing #402.
