import type { StateMachineMachineReport, StateMachinePathStep, StateMachineRegion, StateMachineV1 } from "@archcontext/contracts";
import { checkStateMachines } from "@archcontext/core/state-machine-engine";

/** Model-only §2.1 for one capability, machines in id order; absent machines add no bytes to its document. */
export function renderStateMachineSection(machines: readonly StateMachineV1[]): string[] {
  if (machines.length === 0) return [];
  const ordered = [...machines].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const reports = checkStateMachines(ordered, { protection: true });
  return ["", "### 2.1 狀態機", ...ordered.flatMap((machine, index) => machineLines(machine, reports[index]!))];
}

function machineLines(machine: StateMachineV1, report: StateMachineMachineReport): string[] {
  return [
    "", `#### ${machine.name}`, "", `- ID:\`${machine.id}\``,
    `- 檢查:\`${report.reachableStates}\` 個可達全域狀態 / \`${report.transitions}\` 次轉移`,
    "", "```mermaid", "stateDiagram-v2", "  direction LR",
    ...machine.regions.flatMap((region) => regionLines(machine, region)),
    ...classLines(machine, report),
    "```", "", "| 規則 | 類型 | 結果 | 最短路徑 | 守衛 | 追蹤 |", "| --- | --- | --- | --- | --- | --- |",
    ...resultRows(machine, report),
    "", "| 事件 | 來源 |", "| --- | --- |",
    ...eventRows(machine)
  ];
}

function stateNodeId(region: string, state: string): string {
  return `${region}__${state}`.replaceAll("-", "_");
}

/** The states and arrows of one region; a machine with several regions draws each as a composite state. */
function regionLines(machine: StateMachineV1, region: StateMachineRegion): string[] {
  const composite = machine.regions.length > 1;
  const indent = composite ? "    " : "  ";
  const lines: string[] = [];
  // Local IDs normalize to single underscores only; three keeps containers disjoint from states.
  if (composite) lines.push(`  state "${region.label}" as region___${region.id.replaceAll("-", "_")} {`);
  for (const state of region.states) lines.push(`${indent}state "${state.label}" as ${stateNodeId(region.id, state.id)}`);
  lines.push(`${indent}[*] --> ${stateNodeId(region.id, region.initial)}`);
  const arrows = new Map<string, string[]>();
  for (const event of machine.events) {
    for (const step of event.steps) {
      const target = step.then[region.id];
      if (target === undefined) continue;
      const guards = machine.regions.filter((other) => other.id !== region.id && step.when[other.id] !== undefined)
        .map((other) => ` [when ${other.label} is ${step.when[other.id]!.map((id) => other.states.find((state) => state.id === id)!.label).join(" or ")}]`).join("");
      for (const source of step.when[region.id]!) {
        if (source === target) continue;
        const arrow = `${stateNodeId(region.id, source)} --> ${stateNodeId(region.id, target)}`;
        const labels = arrows.get(arrow) ?? [];
        labels.push(`${event.label}${guards}`);
        arrows.set(arrow, labels);
      }
    }
  }
  for (const [arrow, labels] of arrows) lines.push(`${indent}${arrow}: ${labels.join(" / ")}`);
  for (const state of region.states) if (state.terminal) lines.push(`${indent}${stateNodeId(region.id, state.id)} --> [*]`);
  if (composite) lines.push("  }");
  return lines;
}

/** `broken` marks the states of each broken rule and of the reported deadlock; `unreachable` marks each unreachable state. */
function classLines(machine: StateMachineV1, report: StateMachineMachineReport): string[] {
  const broken = new Set<string>();
  const unreachable = new Set<string>();
  for (const result of report.rules) {
    if (result.state === undefined) continue;
    const rule = machine.rules.find((rule) => rule.id === result.id)!;
    const named = rule.never ?? rule.final;
    for (const region of machine.regions) {
      if (Object.hasOwn(named, region.id)) broken.add(stateNodeId(region.id, result.state[region.id]!));
    }
  }
  for (const failure of report.breaks) {
    if (failure.kind === "unreachable-state") unreachable.add(stateNodeId(failure.region, failure.state));
    if (failure.kind === "deadlock") {
      for (const region of machine.regions) broken.add(stateNodeId(region.id, failure.state[region.id]!));
    }
  }
  const lines: string[] = [];
  if (broken.size > 0) lines.push("  classDef broken fill:#7f1d1d,color:#ffffff,stroke:#fecaca,stroke-width:2px", `  class ${[...broken].join(",")} broken`);
  if (unreachable.size > 0) lines.push("  classDef unreachable fill:#334155,color:#ffffff,stroke:#94a3b8,stroke-dasharray:5 5", `  class ${[...unreachable].join(",")} unreachable`);
  return lines;
}

/** One row per declared rule in declaration order, then one row per built-in break. */
function resultRows(machine: StateMachineV1, report: StateMachineMachineReport): string[] {
  const events = new Map(machine.events.map((event) => [event.id, event]));
  const regions = new Map(machine.regions.map((region) => [region.id, region]));
  const eventLabel = (step: StateMachinePathStep) => {
    const event = events.get(step.event)!;
    return `${event.label}${event.steps.length > 1 ? ` #${step.step}` : ""}`;
  };
  const pathLabel = (path: StateMachinePathStep[] | undefined) => path === undefined ? "—"
    : path.length === 0 ? "初始狀態" : path.map(eventLabel).join(" → ");
  const rows = machine.rules.map((rule) => {
    const result = report.rules.find((result) => result.id === rule.id)!;
    const protection = result.protectedBy === undefined ? "—" : result.protectedBy.length === 0 ? "無"
      : result.protectedBy.map((guard) => `${eventLabel(guard)} / ${regions.get(guard.region)!.label}`).join("、");
    return `| \`${rule.id}\` ${rule.label} | \`${result.kind}\` | \`${result.status}\` | ${pathLabel(result.path)} | ${protection} | ${result.tracking ?? "—"} |`;
  });
  for (const failure of report.breaks) {
    const subject = failure.kind === "unreachable-state" ? `${failure.region}.${failure.state}`
      : failure.kind === "dead-step" ? `${failure.event}#${failure.step}`
        : machine.regions.map((region) => `${region.id}=${failure.state[region.id]}`).join("、");
    rows.push(`| \`${subject}\` | \`${failure.kind}\` | \`broken\` | ${pathLabel(failure.kind === "deadlock" ? failure.path : undefined)} | — | — |`);
  }
  return rows;
}

function eventRows(machine: StateMachineV1): string[] {
  return machine.events.map((event) => {
    const source = event.source.kind === "environment" ? "environment"
      : `\`${event.source.path}${event.source.symbol === undefined ? "" : `#${event.source.symbol}`}\``;
    return `| \`${event.id}\` ${event.label} | ${source} |`;
  });
}
