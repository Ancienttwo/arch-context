import type { Json } from "./schema";

export const STATE_MACHINE_SCHEMA_VERSION = "archcontext.state-machine/v1";
export const STATE_MACHINE_CHECK_SCHEMA_VERSION = "archcontext.state-machine-check/v1";
/** The largest product of region sizes that a model may declare; the check enumerates at most this many global states. */
export const STATE_MACHINE_PRODUCT_LIMIT = 100_000;

export interface StateMachineCodeSource {
  kind: "code";
  /** A repository-relative POSIX path. */
  path: string;
  symbol?: string;
  confirmedDigest?: string;
}

export interface StateMachineEnvironmentSource {
  kind: "environment";
}

export interface StateMachineState {
  id: string;
  label: string;
  terminal?: boolean;
}

export interface StateMachineRegion {
  id: string;
  label: string;
  initial: string;
  states: StateMachineState[];
  /** The code that owns the region. A region without one is a history region. */
  source?: StateMachineCodeSource;
}

/** `when` maps a region to the states the step accepts; `then` maps a region to the state the step writes. */
export interface StateMachineStep {
  when: Record<string, string[]>;
  then: Record<string, string>;
}

export interface StateMachineEvent {
  id: string;
  label: string;
  source: StateMachineCodeSource | StateMachineEnvironmentSource;
  steps: StateMachineStep[];
}

export interface StateMachineFinding {
  /** An https URL of the issue that tracks the known break. */
  tracking: string;
}

interface StateMachineRuleBase {
  id: string;
  label: string;
  finding?: StateMachineFinding;
}

/** No reachable global state has every named region in one of its listed states. */
export interface StateMachineNeverRule extends StateMachineRuleBase {
  never: Record<string, string[]>;
  final?: never;
}

/** Once its one region is in a listed state, no enabled step moves it to another state. */
export interface StateMachineFinalRule extends StateMachineRuleBase {
  final: Record<string, string[]>;
  never?: never;
}

export type StateMachineRule = StateMachineNeverRule | StateMachineFinalRule;

/** `schemas/repo/architecture-state-machine.schema.json`, one file under `.archcontext/model/state-machines/`. */
export interface StateMachineV1 {
  schemaVersion: typeof STATE_MACHINE_SCHEMA_VERSION;
  id: string;
  capabilityId: string;
  name: string;
  regions: StateMachineRegion[];
  events: StateMachineEvent[];
  rules: StateMachineRule[];
}

export type StateMachineInvariant =
  | "state-machine-id-duplicate"
  | "state-machine-capability-missing"
  | "state-machine-initial-unknown"
  | "state-machine-region-unknown"
  | "state-machine-state-unknown"
  | "state-machine-step-source-missing"
  | "state-machine-product-too-large";

export interface StateMachineIssue {
  /** The machine id. */
  entityId: string;
  /** The path of the value inside the machine, for example `regions[1].initial`. */
  field: string;
  invariant: StateMachineInvariant;
}

/** One state per region, keyed by region id in declaration order. */
export type StateMachineGlobalState = Record<string, string>;

/** `step` is the 1-based index of the step in its event. */
export interface StateMachinePathStep {
  event: string;
  step: number;
}

export interface StateMachineGuard {
  event: string;
  step: number;
  region: string;
}

export type StateMachineRuleStatus = "holds" | "broken" | "finding-open" | "finding-resolved";

export interface StateMachineRuleResult {
  id: string;
  kind: "never" | "final";
  status: StateMachineRuleStatus;
  /** Present when the rule carries a finding. */
  tracking?: string;
  /** Present when the rule is broken. */
  state?: StateMachineGlobalState;
  /** Present when the rule is broken: the shortest path to `state`; for a `final` rule it ends with the step that moves the region. */
  path?: StateMachinePathStep[];
  /** Present when the rule holds and the check ran the protection analysis. */
  protectedBy?: StateMachineGuard[];
}

export type StateMachineBreak =
  | { kind: "unreachable-state"; region: string; state: string }
  | { kind: "dead-step"; event: string; step: number }
  | { kind: "deadlock"; state: StateMachineGlobalState; path: StateMachinePathStep[]; count: number };

export interface StateMachineMachineReport {
  id: string;
  capabilityId: string;
  reachableStates: number;
  transitions: number;
  rules: StateMachineRuleResult[];
  breaks: StateMachineBreak[];
}

/** `schemas/runtime/state-machine-check.schema.json`, the data of `archctx state-machines check`. */
export interface StateMachineCheckReportV1 {
  schemaVersion: typeof STATE_MACHINE_CHECK_SCHEMA_VERSION;
  /** Sorted by machine id. */
  machines: StateMachineMachineReport[];
}

type NodeRecord = Readonly<Record<string, Json | undefined>>;

/**
 * Cross-entity rules of the state machine model that the per-file schema cannot state. The
 * loader and the YAML model store both call this one function on schema-valid machines, so
 * `archctx validate` and `archctx state-machines check` cannot disagree.
 *
 * A lookup that meets a duplicate id uses the first declaration. A region that the machine does
 * not declare is reported once; its states are not checked. Issues come out sorted by entity id,
 * then field and invariant.
 */
export function stateMachineModelIssues(model: { nodes: readonly NodeRecord[]; stateMachines: readonly StateMachineV1[] }): StateMachineIssue[] {
  const issues: StateMachineIssue[] = [];
  const capabilities = new Set(model.nodes.filter((node) => node.kind === "capability" && typeof node.id === "string").map((node) => node.id as string));
  const machineIds = new Set<string>();
  for (const machine of model.stateMachines) {
    const report = (field: string, invariant: StateMachineInvariant) => issues.push({ entityId: machine.id, field, invariant });
    if (machineIds.has(machine.id)) report("id", "state-machine-id-duplicate");
    machineIds.add(machine.id);
    if (!capabilities.has(machine.capabilityId)) report("capabilityId", "state-machine-capability-missing");
    const regions = new Map<string, Set<string>>();
    let product = 1;
    machine.regions.forEach((region, regionIndex) => {
      if (regions.has(region.id)) report(`regions[${regionIndex}].id`, "state-machine-id-duplicate");
      const states = new Set<string>();
      region.states.forEach((state, stateIndex) => {
        if (states.has(state.id)) report(`regions[${regionIndex}].states[${stateIndex}].id`, "state-machine-id-duplicate");
        states.add(state.id);
      });
      if (!states.has(region.initial)) report(`regions[${regionIndex}].initial`, "state-machine-initial-unknown");
      if (!regions.has(region.id)) regions.set(region.id, states);
      product *= region.states.length;
    });
    if (product > STATE_MACHINE_PRODUCT_LIMIT) report("regions", "state-machine-product-too-large");
    const checkStates = (field: string, entries: Record<string, string | string[]>) => {
      for (const [regionId, value] of Object.entries(entries)) {
        const states = regions.get(regionId);
        if (!states) {
          report(`${field}.${regionId}`, "state-machine-region-unknown");
          continue;
        }
        if (typeof value === "string") {
          if (!states.has(value)) report(`${field}.${regionId}`, "state-machine-state-unknown");
          continue;
        }
        value.forEach((state, index) => {
          if (!states.has(state)) report(`${field}.${regionId}[${index}]`, "state-machine-state-unknown");
        });
      }
    };
    const eventIds = new Set<string>();
    machine.events.forEach((event, eventIndex) => {
      if (eventIds.has(event.id)) report(`events[${eventIndex}].id`, "state-machine-id-duplicate");
      eventIds.add(event.id);
      event.steps.forEach((step, stepIndex) => {
        const field = `events[${eventIndex}].steps[${stepIndex}]`;
        checkStates(`${field}.when`, step.when);
        checkStates(`${field}.then`, step.then);
        for (const regionId of Object.keys(step.then)) {
          if (!Object.hasOwn(step.when, regionId)) report(`${field}.then.${regionId}`, "state-machine-step-source-missing");
        }
      });
    });
    const ruleIds = new Set<string>();
    machine.rules.forEach((rule, ruleIndex) => {
      if (ruleIds.has(rule.id)) report(`rules[${ruleIndex}].id`, "state-machine-id-duplicate");
      ruleIds.add(rule.id);
      if (rule.never) checkStates(`rules[${ruleIndex}].never`, rule.never);
      else checkStates(`rules[${ruleIndex}].final`, rule.final);
    });
  }
  return issues.sort((left, right) => compare(left.entityId, right.entityId) || compare(left.field, right.field) || compare(left.invariant, right.invariant));
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
