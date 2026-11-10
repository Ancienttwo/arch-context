# State machines

A state machine records the lifecycle that one capability's code implements, so that an agent
can check a declared rule before it changes that code. ADR-0054 is the design record. This
runbook covers writing a machine, reading `archctx state-machines check`, recording a known
break and confirming a machine after its code changed.

## Write a machine

A machine is one file, `.archcontext/model/state-machines/<id>.yaml`, with
`schemaVersion: archcontext.state-machine/v1`, an `id` that starts with `state-machine.` and the
`capabilityId` of the capability whose code it describes. Write and change it through a
ChangeSet (`archctx plan` and `archctx apply`), like every other model file.

- **Regions.** A region is one finite variable: an `id`, a `label`, an `initial` state and its
  `states`. Mark a state `terminal: true` when the code never leaves it. Give the region a
  `source` (`{ kind: code, path, symbol? }`) that names the code that stores it.
- **History regions.** A region with no `source` is a history region. No code stores it; it
  records what has happened so that a rule can talk about the past, for example "a refund was
  issued". Only the steps of events change it.
- **Events.** An event is something that happens: a function runs, a message arrives, a timer
  fires. Its `source` is the code that performs it, or `{ kind: environment }` when no code in
  the repository performs it. An event has one or more steps.
- **Steps.** `when` maps each region the step looks at to the states it accepts; `then` maps each
  region the step writes to its next state. Every region in `then` is also in `when`. A step
  fires atomically: every region in `then` changes at once.
- **Rules.** `never` names two or more regions with states that must never hold together.
  `final` names one region with states that no step may leave.

A machine holds one design: the code as built. Do not model a planned design next to it, and do
not keep a second machine for the same code. A machine has no constants: a region has a fixed,
finite list of states, and a guard can only compare a region with a list of its states.

The kind does not hold a guard that is arithmetic over values that a step writes, a log or a
clock, for example "retry while `attempts < maxAttempts`" or "expire when the lease is older
than 30 s". Model the outcome as states (`retrying`, `exhausted`; `leased`, `expired`) and leave
the arithmetic to the code review of the ChangeSet that adds or confirms the machine.

## Read the check report

`archctx state-machines check --json` returns `archcontext.state-machine-check/v1`. It starts no
daemon and writes nothing. For each machine, sorted by id:

- `reachableStates` and `transitions`: the size of the reachable global state space.
- `rules`: each declared rule with `holds`, `broken`, `finding-open` or `finding-resolved`. A
  broken rule carries the global `state` that breaks it and the shortest `path` of event steps
  from the initial state.
- `protectedBy`: for a rule that holds, the guards (`event`, `step`, `region`) whose removal
  breaks it. A step that drops one of them breaks the rule. An empty list is not debt: two
  guards that each protect the rule alone leave it empty.
- `breaks`: every `unreachable-state`, every `dead-step` and at most one `deadlock`. Each is an
  error in the model; fix the model.
- `anchors`: every `code` source of a region or an event, regions first, with its `status` and,
  when the code was read, its current `digest`.

| Anchor status | Meaning |
|---|---|
| `confirmed` | The digest equals `confirmedDigest`. |
| `anchor-unconfirmed` | The anchor has no `confirmedDigest` yet. |
| `anchor-changed` | The anchored code changed since it was confirmed. |
| `anchor-missing-path` | The path is not a Git-visible file. |
| `anchor-missing-symbol` | No declaration in the file matches the symbol. |
| `anchor-ambiguous-symbol` | More than one declaration matches; use `Type.name`. |
| `anchor-language-unsupported` | CodeGraph cannot parse the file; use a file anchor. |
| `unchecked` | No CodeGraph index could be opened (`reason`); the symbol was not read. |

A file anchor's digest covers the whole file; a symbol anchor's digest covers only the lines of
its one declaration, so an edit elsewhere in the file leaves it `confirmed`. Both read CRLF as LF.

## Record a known break

When the code breaks a rule today and an issue tracks the fix, add
`finding: { tracking: <issue URL> }` to the rule in a ChangeSet. The rule then reports
`finding-open` and is not debt. When the fix lands the rule holds and reports
`finding-resolved`, which is debt until a ChangeSet removes the finding. A built-in break
cannot carry a finding. Never relax or delete a rule to make the check pass.

## Confirm a machine after `state-machine-stale`

`archctx checkpoint` and `complete` report a `state-machine-stale` debt item when an anchor is
not `confirmed`; `archctx state-machines check --json` lists the anchor and its digest.

1. Read the change to the anchored code (`git diff` of the anchor's path).
2. If the behaviour changed, change the machine's regions, events, steps or rules to match.
3. Write the reported `digest` into the anchor's `confirmedDigest`, in the same ChangeSet.

No command and no flag writes `confirmedDigest`; only a reviewed ChangeSet does. A symbol anchor
needs a CodeGraph index: without one it stays `unchecked` and the debt check is `partial`.
