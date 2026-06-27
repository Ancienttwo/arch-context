# AL9 Complete Task Projection Gate and Agent Draft Provenance Readback

Status: verified

## P1 Map

`complete_task` consumes a deterministic projection drift summary from the runtime daemon. `agent-orchestrator` plans agent-authored prose as advisory documentation drafts, separate from accepted projections.

## P2 Trace

The traced path is `docs/architecture/.projection-manifest.json` activation -> `complete` drift failure -> `docs apply` ChangeSet projection -> `docs drift` clean -> `complete` pass. Agent prose traces from `AgentJob/v1` and `InvestigationReport/v1` into an advisory proposal plan.

## P3 Decision

The completion gate validates projections but does not write them. Agent prose remains `acceptedProjection:false` with `write-docs` and `apply-changeset` forbidden until deterministic validation and explicit approval.

## Assertions

- AL9-09: pass
- AL9-10: pass
- AL9-14: pass
- AL9-16: pass
- AL9-EG1: pass
- AL9-EG4: pass
- AL9-EG5: pass
