import type { StateMachinePathStep, StateMachineV1 } from "@archcontext/contracts";
import { checkStateMachines } from "@archcontext/core/state-machine-engine";

/** Model-only §2.1 for one capability; absent machines add no bytes to its document. */
export function renderStateMachineSection(machines: readonly StateMachineV1[]): string[] {
  if (machines.length === 0) return [];
  const reports = checkStateMachines(machines, { protection: true });
  const byId = new Map(machines.map((machine) => [machine.id, machine]));
  const lines = ["", "### 2.1 狀態機"];
  for (const report of reports.machines) {
    const machine = byId.get(report.id)!;
    const events = new Map(machine.events.map((event) => [event.id, event]));
    const regions = new Map(machine.regions.map((region) => [region.id, region]));
    const stateId = (region: string, state: string) => `${region}__${state}`.replaceAll("-", "_");
    const eventLabel = (step: StateMachinePathStep) => {
      const event = events.get(step.event)!;
      return `${event.label}${event.steps.length > 1 ? ` #${step.step}` : ""}`;
    };
    const pathLabel = (path: StateMachinePathStep[] | undefined) => path === undefined ? "—"
      : path.length === 0 ? "初始狀態" : path.map(eventLabel).join(" → ");
    lines.push("", `#### ${machine.name}`, "", `- ID:\`${machine.id}\``,
      `- 檢查:\`${report.reachableStates}\` 個可達全域狀態 / \`${report.transitions}\` 次轉移`,
      "", "```mermaid", "stateDiagram-v2", "  direction LR");
    for (const region of machine.regions) {
      const composite = machine.regions.length > 1;
      const indent = composite ? "    " : "  ";
      // Local IDs normalize to single underscores only; three keeps containers disjoint from states.
      if (composite) lines.push(`  state "${region.label}" as region___${region.id.replaceAll("-", "_")} {`);
      for (const state of region.states) lines.push(`${indent}state "${state.label}" as ${stateId(region.id, state.id)}`);
      lines.push(`${indent}[*] --> ${stateId(region.id, region.initial)}`);
      const arrows = new Map<string, string[]>();
      for (const event of machine.events) {
        for (const step of event.steps) {
          const target = step.then[region.id];
          if (target === undefined) continue;
          const guards = machine.regions.filter((other) => other.id !== region.id && step.when[other.id] !== undefined)
            .map((other) => ` [when ${other.label} is ${step.when[other.id]!.map((id) => other.states.find((state) => state.id === id)!.label).join(" or ")}]`).join("");
          for (const source of step.when[region.id]!) {
            if (source === target) continue;
            const arrow = `${stateId(region.id, source)} --> ${stateId(region.id, target)}`;
            const labels = arrows.get(arrow) ?? [];
            labels.push(`${event.label}${guards}`);
            arrows.set(arrow, labels);
          }
        }
      }
      for (const [arrow, labels] of arrows) lines.push(`${indent}${arrow}: ${labels.join(" / ")}`);
      for (const state of region.states) if (state.terminal) lines.push(`${indent}${stateId(region.id, state.id)} --> [*]`);
      if (composite) lines.push("  }");
    }
    const broken = new Set<string>();
    const unreachable = new Set<string>();
    for (const result of report.rules) {
      if (result.state === undefined) continue;
      const rule = machine.rules.find((rule) => rule.id === result.id)!;
      const named = rule.never ?? rule.final;
      for (const region of machine.regions) {
        if (Object.hasOwn(named, region.id)) broken.add(stateId(region.id, result.state[region.id]!));
      }
    }
    for (const failure of report.breaks) {
      if (failure.kind === "unreachable-state") unreachable.add(stateId(failure.region, failure.state));
      if (failure.kind === "deadlock") {
        for (const region of machine.regions) broken.add(stateId(region.id, failure.state[region.id]!));
      }
    }
    if (broken.size > 0) lines.push("  classDef broken fill:#7f1d1d,color:#ffffff,stroke:#fecaca,stroke-width:2px", `  class ${[...broken].join(",")} broken`);
    if (unreachable.size > 0) lines.push("  classDef unreachable fill:#334155,color:#ffffff,stroke:#94a3b8,stroke-dasharray:5 5", `  class ${[...unreachable].join(",")} unreachable`);
    lines.push("```", "", "| 規則 | 類型 | 結果 | 最短路徑 | 守衛 | 追蹤 |", "| --- | --- | --- | --- | --- | --- |");
    for (const rule of machine.rules) {
      const result = report.rules.find((result) => result.id === rule.id)!;
      const protection = result.protectedBy === undefined ? "—" : result.protectedBy.length === 0 ? "無"
        : result.protectedBy.map((guard) => `${eventLabel(guard)} / ${regions.get(guard.region)!.label}`).join("、");
      lines.push(`| \`${rule.id}\` ${rule.label} | \`${result.kind}\` | \`${result.status}\` | ${pathLabel(result.path)} | ${protection} | ${result.tracking ?? "—"} |`);
    }
    for (const failure of report.breaks) {
      const subject = failure.kind === "unreachable-state" ? `${failure.region}.${failure.state}`
        : failure.kind === "dead-step" ? `${failure.event}#${failure.step}`
          : machine.regions.map((region) => `${region.id}=${failure.state[region.id]}`).join("、");
      lines.push(`| \`${subject}\` | \`${failure.kind}\` | \`broken\` | ${pathLabel(failure.kind === "deadlock" ? failure.path : undefined)} | — | — |`);
    }
    lines.push("", "| 事件 | 來源 |", "| --- | --- |");
    for (const event of machine.events) {
      const source = event.source.kind === "environment" ? "environment"
        : `\`${event.source.path}${event.source.symbol === undefined ? "" : `#${event.source.symbol}`}\``;
      lines.push(`| \`${event.id}\` ${event.label} | ${source} |`);
    }
  }
  return lines;
}
