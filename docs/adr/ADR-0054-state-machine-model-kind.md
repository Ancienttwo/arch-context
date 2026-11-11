---
schemaVersion: archcontext.adr/v1
id: adr.0054.state-machine-model-kind
title: State Machine Model Kind and Statechart Projection
status: accepted
decidedAt: 2026-11-10
appliesTo:
  - module.architecture-context.contracts
  - module.architecture-context.core
  - component.architecture-context.projection-renderer
  - component.architecture-context.core.review-engine
  - component.architecture-context.local-runtime.runtime-daemon
  - component.architecture-context.surfaces.cli
supersedes: []
---

# ADR-0054: State Machine Model Kind and Statechart Projection

> **Origin**: [#507](https://github.com/Ancienttwo/arch-context/issues/507). The owner approved the direction on 2026-11-10, and the Decisions section of that issue records it.
>
> **Input**: [#508](https://github.com/Ancienttwo/arch-context/issues/508), the facts and requests of the first adopter, repo-harness.

## Context

The architecture model records structure (nodes, relations, constraints) and call paths (flows).
It does not record behaviour: the states a subsystem can be in, the transitions between them and
the combinations that must never occur. That behaviour exists in the code as implicit state
machines. `AGENT_JOB_STATE_TRANSITIONS` in `packages/core/agent-orchestrator/src/index.ts` is one
example at `main@5d70cd53`. It lists the legal agent job transitions, and only tests and one
readback script call `transitionAgentJobStatus`, the function that enforces it.
`retryRuntimeAgentJob` and `cancelRuntimeAgentJob` in `local-store-sqlite` write a job status
without reading the current one.

The `pstack` skills `create-formal-verification-skill` and `statechart`
([cursor/plugins@de8ee15](https://github.com/cursor/plugins/tree/de8ee15dd1194627d21eb5fcd41cb1873208dabb/pstack))
model such machines in TLA+, check them with TLC and draw the reachable graph as a Mermaid
statechart. Three of their rules carry over:

1. A model must be able to fail. A model that cannot report a break proves nothing.
2. A known break stays a recorded finding. Nobody weakens a rule to make a check pass.
3. A model records the code it covers, so that a change to that code is noticed.

The toolchain does not carry over. TLC needs a JVM and a first-run download, and a TLA+ model
lives in a skill directory, outside the model that `prepare`, `checkpoint` and `complete` read.

A trial in repo-harness on 2026-11-10 followed the two skills by hand and wrote seven TLA+ models
of its operator console
([research note](https://github.com/aimpact-inc/repo-harness/blob/6a927ae8b5285b77fbe6bd767208e04e2ba5b705/docs/researches/20261110-state-machine-trial.md)).
Four of its results bound this design:

- Six of the seven models are finite regions with guards. The seventh has guards that do
  arithmetic over an append-only log and a clock.
- Nine of the 22 rules of those six models need a history variable: a region that no code symbol
  backs.
- A run with one guard turned off found a model that was wrong and still green.
- repo-harness gives `archctx checkpoint` three seconds at edit time. It validates every debt
  report against the schema of its pinned `archctx-contracts`, and two of its readers have a
  closed list of debt kinds.

One existing rule shapes the design. `review-engine` turns every architecture debt item into an
error finding, so one item blocks `complete`. A check that reported a known, tracked break as debt
would block every task in the repository.

## Decision

### 1. State machines are a model kind beside flows

A state machine is one YAML file, `.archcontext/model/state-machines/<id>.yaml`, with
`schemaVersion: archcontext.state-machine/v1`. `schemas/repo/architecture-state-machine.schema.json`
defines its shape. The id matches `^state-machine\.[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$`, and
`capabilityId` names a node of kind `capability`. The directory is `state-machines`, not
`machines`: the model already has `process`, `namespace` and `mount` nodes for the runtime
topology (ADR-0049).

The directory is Git-visible model authority and is committed with the rest of the model. A
ChangeSet writes a state machine file with the entity operations that write every other model
file. No tool and no agent writes the directory another way.

State machines are not part of the native model snapshot (`nodes`, `relations`, `flows`). One
loader, `loadStateMachinesFromArchContext` in `@archcontext/core/state-machine-engine`, reads the
directory. The semantic state, the native-context export and the ledger do not read it (see 9).

### 2. A machine is regions, events and rules

```yaml
schemaVersion: archcontext.state-machine/v1
id: state-machine.checkout.order
capabilityId: capability.checkout
name: Order and payment
regions:
  - id: order
    label: Order
    initial: open
    states:
      - { id: open, label: Open }
      - { id: shipped, label: Shipped, terminal: true }
      - { id: cancelled, label: Cancelled, terminal: true }
  - id: payment
    label: Payment
    initial: unpaid
    states:
      - { id: unpaid, label: Unpaid }
      - { id: captured, label: Captured }
      - { id: refunded, label: Refunded }
events:
  - id: capture
    label: Capture the payment
    source: { kind: code, path: src/payment.ts, symbol: PaymentService.capture }
    steps:
      - when: { order: [open], payment: [unpaid] }
        then: { payment: captured }
  - id: ship
    label: Ship the order
    source: { kind: code, path: src/order.ts, symbol: shipOrder }
    steps:
      - when: { order: [open] }
        then: { order: shipped }
  - id: cancel
    label: Cancel the order
    source: { kind: code, path: src/order.ts, symbol: cancelOrder }
    steps:
      - when: { order: [open], payment: [unpaid] }
        then: { order: cancelled }
      - when: { order: [open], payment: [captured] }
        then: { order: cancelled, payment: refunded }
rules:
  - id: paid-before-shipped
    label: An order never ships without a captured payment
    never: { order: [shipped], payment: [unpaid, refunded] }
  - id: closed-order-stays-closed
    label: A shipped or cancelled order never changes
    final: { order: [shipped, cancelled] }
```

- A **region** is one finite variable. It has an `initial` state, and a state may be `terminal`.
  A region may name the code that stores it in `source`. A region with no `source` is a history
  region: it records what has happened, so that a rule can refer to the past. No code stores it,
  and only the steps of the events change it.
- An **event** is something that happens: a function runs, a message arrives, a timer fires. Its
  `source` is `{ kind: code, path, symbol? }`, or `{ kind: environment }` for an event that no
  code in the repository performs. An event has one or more **steps**. `when` gives, for each
  region it names, the states that region may be in. `then` gives the next state of each region it
  names. Every region in `then` is also in `when`, so a step always states where it starts.
- A **rule** is declared intent. `never` names two or more regions with states: no reachable
  global state has every named region in a listed state. `final` names one region with states:
  once the region is in a listed state, no step moves it to another state.

A global state is one state per region. A step is enabled in a global state when every region in
its `when` is in a listed state. Firing it sets every region in `then`, as one atomic transition.
In the example `ship` does not look at the payment, so `paid-before-shipped` breaks after one
event. That is the point of rule 1 in the context.

Region, state, event and rule ids are lowercase kebab slugs (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`).
Each has a `label` for readers.

### 3. One shared validator

`stateMachineModelIssues` in `@archcontext/contracts` holds the rules that a JSON schema cannot
express, in the way `runtimeTopologyModelIssues` does for the topology. The loader fails closed on
any issue, and the YAML model store reports the same issues in `archctx validate`. The check and
the renderer take the loaded value and do not validate it again.

- `state-machine-id-duplicate`: an id is used twice in its scope. Machine ids are unique in the
  model, region, event and rule ids in a machine, and state ids in a region.
- `state-machine-capability-missing`: `capabilityId` names no capability node.
- `state-machine-initial-unknown`: `initial` is not a state of its region.
- `state-machine-region-unknown` and `state-machine-state-unknown`: a step or a rule names a
  region or a state that the machine does not declare.
- `state-machine-step-source-missing`: a region in `then` is not in `when`.
- `state-machine-product-too-large`: the product of the region sizes is more than 100,000. The
  bound is static, so the check never starts a search that it cannot finish.

### 4. The check is a built-in pure function

`checkStateMachine` in `@archcontext/core/state-machine-engine` visits the reachable global states
breadth-first from the initial global state. It takes events and steps in declaration order. It
needs no TLC, no JVM and no other tool, and it reads no file.

Built-in checks apply to every machine:

- `unreachable-state`: no reachable global state contains a declared state.
- `dead-step`: a step is enabled in no reachable global state.
- `deadlock`: a reachable global state that is not final has no step that changes it. A global
  state is final when at least one region declares a terminal state and every region that declares
  one is in a terminal state.

Declared rules are `never` and `final` (see 2). Every break carries the shortest path to it, as
the list of events and steps from the initial global state. The report contract is
`archcontext.state-machine-check/v1`. The same model always gives byte-identical report bytes.

For every declared rule that holds, the report also lists the guards that protect it. A guard is
the `when` entry of one step for one region, when it lists fewer states than the region has.
`stateMachineRuleProtection` removes one guard at a time and runs the check again. The guards
whose removal breaks a rule are its `protectedBy` list. This is the guard-off run of the trial,
made for every guard on every run.

- An empty `protectedBy` list is reported and is not debt. Two guards that each protect a rule
  alone leave the list empty.
- The run shows that a rule can fail in the model. It cannot show that the model has the guards
  of the code. The trial found that error by hand, and here it stays with the review of the
  ChangeSet that adds or confirms the machine (see 7).

### 5. A known break is a recorded finding

A declared rule may carry `finding: { tracking: <issue URL> }`. It says that the code breaks the
rule today and that the issue tracks the fix.

- The rule is broken and carries a finding: the report says `finding-open`. It is not debt.
- The rule holds and still carries a finding: the report says `finding-resolved`. It is debt until
  a ChangeSet removes `finding`, so a fixed break cannot return unnoticed.
- The rule is broken and carries no finding: the report says `broken`. It is debt.

A built-in check cannot carry a finding. An unreachable state, a dead step or a deadlock is an
error in the model, and the model is what gets fixed.

### 6. The statechart is projected into the capability document

A capability that declares a state machine gets `### 2.1 狀態機` at the end of §2 of its entity
summary, inside the machine region. The heading is a fixed string, like the other machine-region
headings. A capability with no state machine renders byte-identical output, and the renderer
version does not change.

Each machine renders, in id order:

- One Mermaid `stateDiagram-v2` block with `direction LR`. A machine with one region is drawn
  flat. A machine with two or more regions draws each region as one composite state with the
  region label, so that a guard on another region names something the reader can see.
- A step is one arrow for each from-state in each region that it changes. The arrow label is the
  event label, then `[when <region label> is <state label>]` for each other region in `when`.
  Arrows with the same source and target merge into one arrow whose label joins theirs with
  ` / `, in declaration order.
- Labels are plain text. The schema refuses the characters that Mermaid or a Markdown table
  would need escaped, so the renderer has no escape table.
- The states of a broken rule have the class `broken`. An unreachable state has the class
  `unreachable`.
- A rule table: every declared rule and every built-in break, with its status, its shortest path,
  its tracking link and the guards that protect it.
- An event table: every event with its source anchor.
- One line with the number of reachable global states and transitions that the check visited.

The document shows no digest and no anchor status. Both change with the code, and the document
changes only with the model. The Mermaid check of ADR-0049 §7 parses the new blocks as it parses
every other block under `docs/architecture/`.

### 7. Code anchors keep a machine in step with the code (phase 3)

> **Amended 2026-11-11** ([#539](https://github.com/Ancienttwo/arch-context/issues/539), 0.14.0): a symbol anchor also covers its direct callees in the repository.

A `source` of kind `code` may carry `confirmedDigest`: the digest of the anchored code at the time
someone last confirmed that the machine matches it.

- An anchor with no `symbol` covers the file. Its digest is `sha256:` over the file content with
  CRLF read as LF, the digest that source stamps already use.
- An anchor with a `symbol` (`name` or `Type.name`) covers one declaration and its direct callees.
  The declaration is matched the way prose anchors match a symbol, among the declarations that the
  CodeGraph index holds for the file.
- A callee is a declaration that the index records as the target of a `calls` or `references` edge
  from the anchored declaration, when the target is a function, method, property, constant or
  variable, lies in a Git-visible file and lies outside the anchored declaration. The walk is one
  hop. Types, interfaces, classes and modules are not callees, and neither is code outside the
  repository.
- The digest of a symbol anchor is `sha256:` over the UTF-8 bytes of a JSON array of strings: the
  lines of the anchored declaration, then the lines of each callee, each with CRLF read as LF.
  Callees are ordered by path, qualified name, kind and start line. Only the text is hashed; the
  identity of a callee only sets its place in the order.

A reference that CodeGraph does not resolve to a declaration is not covered. Most such references
name a built-in or a package, and the check does not guess which of the others belong to the
repository. The report lists the callees of each symbol anchor, so the person who confirms it sees
what the digest covers and what it leaves out.

The declaration and its callees come from the read-only CodeGraph handle that the check opens in
its own process. The check runs no CodeGraph command, copies no snapshot and never syncs the index.
It uses the index only for a file that the index holds at its current content, by CodeGraph's own
change test: the SHA-256 of the file's UTF-8 text equals the recorded content hash. When the index
does not hold the anchor's file or a callee's file at its current content, the anchor is
`unchecked` with reason `index-stale`. `complete` syncs the index before it reads debt; a
checkpoint reads the index as it is.

This changes what a checkpoint shows right after an edit. Under 0.13.0 an edited anchored
function showed `anchor-changed` at a checkpoint even when the index was behind, because the check
parsed the current file. From 0.14.0 it shows `unchecked` with `index-stale` until the index is
synced, and the debt check is `partial` meanwhile. A checkpoint does not sync the index, so that
it stays within its edit-time budget.

Anchor status is one of `confirmed`, `anchor-unconfirmed` (no `confirmedDigest`), `anchor-changed`,
`anchor-missing-path`, `anchor-missing-symbol`, `anchor-ambiguous-symbol`,
`anchor-language-unsupported` (CodeGraph does not parse the file's language; use a file anchor)
and `unchecked`, with the reason `index-missing`, `index-open-failed` or `index-stale`.

The check report lists every anchor with its status and its current digest. A symbol anchor with a
digest also lists its callees (`path`, `qualifiedName`) in digest order. To confirm a machine, read
the changed code, the anchored declaration and each listed callee, change the machine if its
behaviour changed, and write the reported digest into `confirmedDigest`, all in one ChangeSet. No
command writes a digest on its own: a one-step restamp would turn the check into a formality.

When the index is missing or cannot be opened, every symbol anchor is `unchecked` with that reason
and the debt check has `partial` coverage, as it has for `index-stale`. The check never reports an
anchor as confirmed or changed without reading the declaration and its callees from an index that
holds their current content.

The digest has no version field and no migrator. Each symbol anchor confirmed before 0.14.0
reports `anchor-changed` once and is confirmed again by hand through the runbook. File anchors keep
their digest.

Anchor results, callees included, are not an input of any projection render. The capability
document shows no digest, no anchor status and no callee, so ADR-0056 render equivalence does not
change.

### 8. Debt has one new check and two new kinds (phase 3)

`archcontext.architecture-debt/v1` gains the check `state-machines`, after `flows`, and the kinds
`state-machine-rule` and `state-machine-stale`. The contract lists every producer in every report,
so every report then has six checks. A model with no state machine reports `state-machines` with
`complete` coverage and no item.

- `state-machine-rule`: reason codes `rule-broken`, `finding-resolved`, `deadlock`,
  `unreachable-state` and `dead-step`.
- `state-machine-stale`: every anchor status of 7 except `confirmed` and `unchecked`. An
  `unchecked` anchor is a coverage gap, not an item.
- The action of both kinds is `archctx state-machines check --json`.

In the repository scope the check covers every machine: the rule check and every anchor. `complete`
uses that scope, and a changed `.archcontext/` path already widens a checkpoint to it. In a
changed-paths scope the check evaluates an anchor when its own path changed or when the index
records a callee of it in a changed path. It finds those anchors by inverting the callee sets of
all symbol anchors, read in one batch from the same handle. When the callees of a symbol anchor
cannot be read, because there is no usable index or the index does not hold the anchor's file at
its current content, the anchor is evaluated as `unchecked`. It runs no rule check there, because
a rule result depends only on the model. A debt item keeps the anchor's path, so a checkpoint and
`complete` give it the same identity.

The debt read is on the edit-time path, where a consumer may allow three seconds for the whole
checkpoint. It never runs the protection run and parses no file; it reads each anchored or callee
file at most once. Its budget is 250 ms added to the edit-time read for ten machines anchored on
one changed file.

### 9. Command surface, and what does not change

`archctx state-machines check [--json]` is a stateless read: no daemon, no local store, no task
session and no ChangeSet. Its envelope id is `state-machines.check`. It returns the report for a
valid model and fails closed on an invalid one.

A state machine change is not an architecture major change. No semantic facet, reason code or
refresh signal covers it, and a capability's semantic fingerprint does not include its machines.
The MCP tool set, the `prepare` context, the ledger, the native-context export, the Explorer and
the LikeC4 and Structurizr exports do not change.

## Rollout

Three phases, each mergeable on its own. Phases 2 and 3 need only phase 1.

1. Model kind, validator, check and command. This repository's model gets its first machine, the
   agent job lifecycle. Every rule that the code breaks today carries a finding.
2. Statechart projection.
3. Code anchors and debt.

## Invariants

- `.archcontext/model/state-machines/` is the only authority for state machines. The check
  report, the statechart and the debt items are projections of it.
- Nothing writes the directory except a ChangeSet. `confirmedDigest` changes the same way.
- No tool relaxes or deletes a rule or a finding to make a check pass. An update to a machine
  starts from the code, never from a failing result.
- A model without state machines renders the bytes and the digests that it rendered before this
  decision. Its debt report changes in one place: the `state-machines` check row.
- The same model always gives byte-identical check reports and statecharts.

## Non-goals

- No TLC, JVM or other model-checker dependency. No TLA+ or XState export.
- No nested states, UML history pseudo-states, timers, data variables, fairness or liveness
  properties. A history region (see 2) is an ordinary region.
- No constants and no design variants. A machine describes one design, the code as built.
- No inference of states or transitions from code, and no code generation from a machine.
- No ledger tracking, native-context export, Explorer view, LikeC4 or Structurizr view, MCP tool or
  `prepare` change.
- No proof that the code implements a machine. The anchors show that confirmed code has not
  changed; they do not show that the confirmation was right.

## Consequences

- A machine expresses finite regions and guards on them. Counters, queues, timestamps and
  message ordering are outside it, and so is a comparison of the design as built with a target
  design. A subsystem that needs them keeps a TLA+ model outside the kernel, for example with the
  `pstack` skills. In the trial one model of seven stayed there, and "for each repository" became
  one set of regions for each repository.
- The first fidelity of a machine rests on the review of the ChangeSet that adds or confirms it.
  The tooling shows that the machine is consistent with itself and that its anchored code is
  unchanged since then.
- An older release neither validates nor renders the directory.
- The debt contract changes in place under `v1`: two kinds, one check, and `checks` grows from
  five rows to six. A validator from an older `archctx-contracts` rejects a new report, so a
  consumer upgrades `archctx` and `archctx-contracts` together. A reader with its own closed kind
  list must learn the two kinds in the same change; repo-harness tracks its readers in
  aimpact-inc/repo-harness#2178.
- At 10x scale the statechart becomes unreadable first, at about 20 arrows; the fix is to split
  the machine. Next is the confirmation work: every edit to an anchored declaration or to one of
  its callees needs a ChangeSet, and a helper that many anchors call turns all of them stale at
  once. Anchors belong on the functions that perform transitions, with the deciding logic in
  helpers they call directly. A deciding value that a callee reads is not covered: here
  `AGENT_JOB_STATE_TRANSITIONS` is read through `agentJobStatusesAccepting`, and CodeGraph does not
  resolve that reference.
