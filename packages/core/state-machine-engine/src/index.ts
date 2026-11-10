import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FailureError,
  STATE_MACHINE_CHECK_SCHEMA_VERSION,
  stateMachineModelIssuesByMachine,
  validateJsonSchema,
  type Json,
  type StateMachineBreak,
  type StateMachineCheckReportV1,
  type StateMachineGlobalState,
  type StateMachineGuard,
  type StateMachineMachineReport,
  type StateMachinePathStep,
  type StateMachineRuleResult,
  type StateMachineV1
} from "@archcontext/contracts";
import { parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import stateMachineSchema from "../../../../schemas/repo/architecture-state-machine.schema.json";

export const STATE_MACHINES_MODEL_DIRECTORY = ".archcontext/model/state-machines";
/** The failure details keep whole issues inside the closed failure budget; the rest are counted. */
const FAILURE_ISSUE_LIMIT = 16;
const FAILURE_ISSUE_MAX_BYTES = 256;

type NodeRecord = Readonly<Record<string, Json | undefined>>;

/**
 * Reads the direct `*.yaml` and `*.yml` children of `.archcontext/model/state-machines/` in file
 * name order, validates each against the schema and then the whole set against
 * `stateMachineModelIssuesByMachine`. Any issue fails closed with `state-machine-model-invalid`; every
 * reader takes the returned value and does not validate it again.
 */
export function loadStateMachinesFromArchContext(root: string, nodes: readonly NodeRecord[]): StateMachineV1[] {
  const directory = resolve(root, STATE_MACHINES_MODEL_DIRECTORY);
  if (!existsSync(directory)) return [];
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareStrings);
  const issues: string[] = [];
  const machines: StateMachineV1[] = [];
  const machinePaths: string[] = [];
  for (const name of files) {
    const path = `${STATE_MACHINES_MODEL_DIRECTORY}/${name}`;
    let value: Json;
    try {
      value = parseJsonOrStableYaml(readFileSync(resolve(directory, name), "utf8"), path);
    } catch (error) {
      issues.push(`${path}: $: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const schemaIssues = validateJsonSchema(stateMachineSchema as Parameters<typeof validateJsonSchema>[0], value).issues;
    for (const issue of schemaIssues) issues.push(`${path}: ${issue.path}: ${issue.message}`);
    if (schemaIssues.length > 0) continue;
    const machine = value as unknown as StateMachineV1;
    machines.push(machine);
    machinePaths.push(path);
  }
  stateMachineModelIssuesByMachine({ nodes, stateMachines: machines }).forEach((machineIssues, index) => {
    for (const issue of machineIssues) issues.push(`${machinePaths[index]}: ${issue.field}: ${issue.invariant}`);
  });
  if (issues.length > 0) {
    const reported = issues.filter((issue) => Buffer.byteLength(issue) <= FAILURE_ISSUE_MAX_BYTES).slice(0, FAILURE_ISSUE_LIMIT);
    const omittedCount = issues.length - reported.length;
    throw new FailureError("AC_SCHEMA_INVALID", "state-machine-model-invalid", { issues: reported, ...(omittedCount > 0 ? { omittedCount } : {}) });
  }
  return machines;
}

interface CompiledStep {
  event: string;
  step: number;
  when: Array<{ region: number; states: ReadonlySet<number> }>;
  then: Array<{ region: number; state: number }>;
}

interface Exploration {
  machine: StateMachineV1;
  steps: CompiledStep[];
  /** Reachable global states in breadth-first order; each is one state index per region. */
  states: number[][];
  /** For each reachable state, the index of its parent and the step that reached it first. */
  parents: Array<{ parent: number; step: number } | undefined>;
}

function compile(machine: StateMachineV1): { stateIndex: Array<Map<string, number>>; steps: CompiledStep[] } {
  const regionIndex = new Map(machine.regions.map((region, index) => [region.id, index]));
  const stateIndex = machine.regions.map((region) => new Map(region.states.map((state, index) => [state.id, index])));
  const steps = machine.events.flatMap((event) => event.steps.map((step, index): CompiledStep => ({
    event: event.id,
    step: index + 1,
    when: Object.entries(step.when).map(([region, states]) => {
      const r = regionIndex.get(region)!;
      return { region: r, states: new Set(states.map((state) => stateIndex[r].get(state)!)) };
    }),
    then: Object.entries(step.then).map(([region, state]) => {
      const r = regionIndex.get(region)!;
      return { region: r, state: stateIndex[r].get(state)! };
    })
  })));
  return { stateIndex, steps };
}

function enabled(step: CompiledStep, state: readonly number[]): boolean {
  return step.when.every((entry) => entry.states.has(state[entry.region]));
}

function fire(step: CompiledStep, state: readonly number[]): number[] {
  const next = [...state];
  for (const entry of step.then) next[entry.region] = entry.state;
  return next;
}

function changes(step: CompiledStep, state: readonly number[]): boolean {
  return step.then.some((entry) => state[entry.region] !== entry.state);
}

/** Breadth-first from the initial global state, steps in declaration order: the first path found to a state is a shortest one. */
function explore(machine: StateMachineV1): Exploration {
  const { stateIndex, steps } = compile(machine);
  const initial = machine.regions.map((region, index) => stateIndex[index].get(region.initial)!);
  const states: number[][] = [initial];
  const parents: Exploration["parents"] = [undefined];
  const seen = new Set<string>([initial.join(",")]);
  for (let cursor = 0; cursor < states.length; cursor++) {
    const state = states[cursor];
    steps.forEach((step, stepIndex) => {
      if (!enabled(step, state)) return;
      const next = fire(step, state);
      const key = next.join(",");
      if (seen.has(key)) return;
      seen.add(key);
      states.push(next);
      parents.push({ parent: cursor, step: stepIndex });
    });
  }
  return { machine, steps, states, parents };
}

function globalState(exploration: Exploration, index: number): StateMachineGlobalState {
  const state = exploration.states[index];
  return Object.fromEntries(exploration.machine.regions.map((region, r) => [region.id, region.states[state[r]].id]));
}

function pathTo(exploration: Exploration, index: number): StateMachinePathStep[] {
  const path: StateMachinePathStep[] = [];
  for (let parent = exploration.parents[index]; parent; parent = exploration.parents[parent.parent]) {
    const step = exploration.steps[parent.step];
    path.unshift({ event: step.event, step: step.step });
  }
  return path;
}

/** The first violation of each rule in search order, or undefined when the rule holds. */
function ruleViolations(exploration: Exploration): Array<{ state: number; step?: number } | undefined> {
  const { machine, steps, states } = exploration;
  const regionIndex = new Map(machine.regions.map((region, index) => [region.id, index]));
  const listed = (entries: Record<string, string[]>) => Object.entries(entries).map(([region, ids]) => {
    const r = regionIndex.get(region)!;
    return { region: r, states: new Set(ids.map((id) => machine.regions[r].states.findIndex((state) => state.id === id))) };
  });
  return machine.rules.map((rule) => {
    if (rule.never) {
      const never = listed(rule.never);
      const index = states.findIndex((state) => never.every((entry) => entry.states.has(state[entry.region])));
      return index < 0 ? undefined : { state: index };
    }
    const [final] = listed(rule.final);
    for (let index = 0; index < states.length; index++) {
      const state = states[index];
      if (!final.states.has(state[final.region])) continue;
      const step = steps.findIndex((candidate) => enabled(candidate, state) && fire(candidate, state)[final.region] !== state[final.region]);
      if (step >= 0) return { state: index, step };
    }
    return undefined;
  });
}

/**
 * The built-in check of one machine. A global state is one state per region; a step is enabled
 * when every region of its `when` is in a listed state, and firing it sets every region of its
 * `then`. A rule with a finding reports `finding-open` when broken and `finding-resolved` when it
 * holds. Pure: the same machine gives the same report.
 */
export function checkStateMachine(machine: StateMachineV1): StateMachineMachineReport {
  const exploration = explore(machine);
  const { steps, states } = exploration;
  const violations = ruleViolations(exploration);
  const rules = machine.rules.map((rule, index): StateMachineRuleResult => {
    const violation = violations[index];
    const status = rule.finding ? (violation ? "finding-open" : "finding-resolved") : (violation ? "broken" : "holds");
    const result: StateMachineRuleResult = { id: rule.id, kind: rule.never ? "never" : "final", status };
    if (rule.finding) result.tracking = rule.finding.tracking;
    if (violation) {
      result.state = globalState(exploration, violation.state);
      result.path = pathTo(exploration, violation.state);
      if (violation.step !== undefined) result.path.push({ event: steps[violation.step].event, step: steps[violation.step].step });
    }
    return result;
  });
  const breaks: StateMachineBreak[] = [];
  machine.regions.forEach((region, r) => {
    const reached = new Set(states.map((state) => state[r]));
    region.states.forEach((state, s) => {
      if (!reached.has(s)) breaks.push({ kind: "unreachable-state", region: region.id, state: state.id });
    });
  });
  for (const step of steps) {
    if (!states.some((state) => enabled(step, state))) breaks.push({ kind: "dead-step", event: step.event, step: step.step });
  }
  const terminalRegions = machine.regions.flatMap((region, r) => region.states.some((state) => state.terminal) ? [r] : []);
  const isFinal = (state: readonly number[]) => terminalRegions.length > 0 && terminalRegions.every((r) => machine.regions[r].states[state[r]].terminal === true);
  let transitions = 0;
  const deadlocks: number[] = [];
  states.forEach((state, index) => {
    const moving = steps.filter((step) => enabled(step, state) && changes(step, state)).length;
    transitions += moving;
    if (moving === 0 && !isFinal(state)) deadlocks.push(index);
  });
  if (deadlocks.length > 0) breaks.push({ kind: "deadlock", state: globalState(exploration, deadlocks[0]), path: pathTo(exploration, deadlocks[0]), count: deadlocks.length });
  return { id: machine.id, capabilityId: machine.capabilityId, reachableStates: states.length, transitions, rules, breaks };
}

/**
 * For each holding rule, the guards that protect it. A guard is the `when` entry of one step for
 * one region that lists fewer states than the region has. Removing it (the step no longer looks at
 * the region) and checking again, a guard protects every rule that holds in the machine and is
 * broken in that run. Keys are the ids of the holding rules in declaration order; each list is in
 * declaration order of the guards and may be empty.
 */
export function stateMachineRuleProtection(machine: StateMachineV1): Map<string, StateMachineGuard[]> {
  const holding = ruleViolations(explore(machine)).map((violation) => violation === undefined);
  const protection = new Map<string, StateMachineGuard[]>();
  machine.rules.forEach((rule, index) => { if (holding[index]) protection.set(rule.id, []); });
  const regionSize = new Map(machine.regions.map((region) => [region.id, region.states.length]));
  machine.events.forEach((event, eventIndex) => event.steps.forEach((step, stepIndex) => {
    for (const [region, states] of Object.entries(step.when)) {
      if (states.length >= regionSize.get(region)!) continue;
      const { [region]: _removed, ...when } = step.when;
      const events = machine.events.map((candidate, candidateIndex) => candidateIndex !== eventIndex ? candidate : {
        ...candidate,
        steps: candidate.steps.map((original, originalIndex) => originalIndex === stepIndex ? { ...original, when } : original)
      });
      const violations = ruleViolations(explore({ ...machine, events }));
      machine.rules.forEach((rule, ruleIndex) => {
        if (holding[ruleIndex] && violations[ruleIndex]) protection.get(rule.id)!.push({ event: event.id, step: stepIndex + 1, region });
      });
    }
  }));
  return protection;
}

/** The `archcontext.state-machine-check/v1` report, machines sorted by id. Without `protection` no rule carries `protectedBy`. */
export function checkStateMachines(machines: readonly StateMachineV1[], options: { protection: boolean }): StateMachineCheckReportV1 {
  return {
    schemaVersion: STATE_MACHINE_CHECK_SCHEMA_VERSION,
    machines: [...machines].sort((left, right) => compareStrings(left.id, right.id)).map((machine) => {
      const report = checkStateMachine(machine);
      if (!options.protection) return report;
      const protection = stateMachineRuleProtection(machine);
      for (const rule of report.rules) {
        const protectedBy = protection.get(rule.id);
        if (protectedBy) rule.protectedBy = protectedBy;
      }
      return report;
    })
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
