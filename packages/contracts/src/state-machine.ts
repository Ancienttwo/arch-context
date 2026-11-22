import type { Json } from "./schema";
import {
  STATE_MACHINE_PRODUCT_LIMIT,
  type StateMachineInvariant,
  type StateMachineIssue,
  type StateMachineV1
} from "./state-machine-types";

export * from "./state-machine-types";
export * from "./state-machine-schemas";

type NodeRecord = Readonly<Record<string, Json | undefined>>;

/**
 * Cross-entity rules of the state machine model that the per-file schema cannot state. The
 * loader and the YAML model store both run it on schema-valid machines through
 * `stateMachinesFromModelFiles`, so `archctx validate` and `archctx state-machines check` cannot
 * disagree.
 *
 * The result is aligned with `stateMachines`: entry `i` holds the issues of machine `i`, so a
 * caller can name the file of each issue even when two machines share an id. A repeated machine
 * id is reported on every machine after the first. A lookup that meets a duplicate id inside a
 * machine uses the first declaration. A region that the machine does not declare is reported
 * once; its states are not checked. Each entry is sorted by field, then invariant.
 */
export function stateMachineModelIssuesByMachine(model: { nodes: readonly NodeRecord[]; stateMachines: readonly StateMachineV1[] }): StateMachineIssue[][] {
  const capabilities = new Set(model.nodes.filter((node) => node.kind === "capability" && typeof node.id === "string").map((node) => node.id as string));
  const machineIds = new Set<string>();
  return model.stateMachines.map((machine) => {
    const issues: StateMachineIssue[] = [];
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
    return issues.sort(compareIssues);
  });
}

/** Every issue of `stateMachineModelIssuesByMachine` in one list, sorted by entity id, then field and invariant. */
export function stateMachineModelIssues(model: { nodes: readonly NodeRecord[]; stateMachines: readonly StateMachineV1[] }): StateMachineIssue[] {
  return stateMachineModelIssuesByMachine(model).flat().sort(compareIssues);
}

function compareIssues(left: StateMachineIssue, right: StateMachineIssue): number {
  return compare(left.entityId, right.entityId) || compare(left.field, right.field) || compare(left.invariant, right.invariant);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
