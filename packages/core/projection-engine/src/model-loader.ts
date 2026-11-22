import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  orderedLayerIssues,
  NativeContextError,
  type ArchitectureFlowV1,
  type Json
} from "@archcontext/contracts";
import { parseJsonOrStableYaml, type NativeModel, type NativeNode, type NativeRelation } from "@archcontext/core/architecture-domain";
import { assertOrderedLayers, nativeNodeLayer } from "./exports-dsl";

export function loadNativeModelFromArchContext(root: string): NativeModel {
  const manifestPath = resolve(root, ".archcontext/manifest.yaml");
  const manifest = existsSync(manifestPath) ? parseYaml(readFileSync(manifestPath, "utf8")) as { model?: { layers?: unknown } } : undefined;
  return nativeModelFromYamlObjects({
    layers: manifest?.model?.layers,
    nodes: readYamlObjects(resolve(root, ".archcontext/model/nodes")),
    relations: readYamlObjects(resolve(root, ".archcontext/model/relations")),
    flows: readYamlObjects(resolve(root, ".archcontext/model/flows"))
  });
}

/** Direct YAML entries read by the native model loader. */
export function isSemanticModelPath(path: string): boolean {
  return /^\.archcontext\/model\/(nodes|relations|flows)\/[^/]+\.ya?ml$/.test(path);
}

/**
 * The same model `loadNativeModelFromArchContext` builds, from bytes the caller already read: keys
 * are repo-relative paths, and only direct YAML children of the model directories count. Lets a
 * caller hash and parse one snapshot instead of re-reading the tree between the two.
 */
export function loadNativeModelFromModelFiles(files: ReadonlyMap<string, string>): NativeModel {
  const objects = (directory: "nodes" | "relations" | "flows") => [...files.entries()]
    .map(([path, body]) => ({ path, body, name: path.slice(`.archcontext/model/${directory}/`.length) }))
    .filter((file) => file.path.startsWith(`.archcontext/model/${directory}/`) && !file.name.includes("/") && /\.ya?ml$/.test(file.name))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map((file) => parseJsonOrStableYaml(file.body, file.path) as Record<string, Json>);
  const body = files.get(".archcontext/manifest.yaml");
  const manifest = body === undefined ? undefined : parseYaml(body) as { model?: { layers?: unknown } };
  return nativeModelFromYamlObjects({ layers: manifest?.model?.layers, nodes: objects("nodes"), relations: objects("relations"), flows: objects("flows") });
}

function nativeModelFromYamlObjects(input: { layers?: unknown; nodes: Record<string, Json>[]; relations: Record<string, Json>[]; flows: Record<string, Json>[] }): NativeModel {
  const nodes = input.nodes as NativeNode[];
  assertOrderedLayers(input.layers, nodes);
  for (const node of nodes) {
    if (node.schemaVersion !== "archcontext.node/v2") {
      throw new Error(`architecture-node-schema-version-unsupported: ${node.id || "unknown"} (${String(node.schemaVersion)})`);
    }
    assertArchitectureNodeSourceV2(node);
    nativeNodeLayer(node);
  }
  const flows = input.flows;
  for (const flow of flows) assertArchitectureFlowV1(flow);
  return {
    ...(input.layers === undefined ? {} : { layers: [...input.layers] }),
    nodes,
    relations: input.relations as unknown as NativeRelation[],
    flows: flows as unknown as ArchitectureFlowV1[]
  };
}

function assertArchitectureNodeSourceV2(node: NativeNode): void {
  if (node.source === undefined) return;
  const source = architectureRecord(node.source, `architecture-node-source-invalid: ${node.id}`);
  architectureExactKeys(source, ["include", "exclude", "entrypoints"], `architecture-node-source-invalid: ${node.id}`);
  for (const key of ["include", "exclude"] as const) {
    if (source[key] !== undefined) architectureStringArray(source[key], `architecture-node-source-invalid: ${node.id}.${key}`);
  }
  if (source.entrypoints === undefined) return;
  const entrypoints = architectureArray(source.entrypoints, `architecture-node-source-invalid: ${node.id}.entrypoints`);
  for (const [entrypointIndex, value] of entrypoints.entries()) {
    const entrypoint = architectureRecord(value, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}]`);
    architectureExactKeys(entrypoint, ["id", "path", "symbols"], `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}]`);
    architectureNonEmptyString(entrypoint.id, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].id`);
    architectureNonEmptyString(entrypoint.path, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].path`);
    const symbols = architectureArray(entrypoint.symbols, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols`, true);
    for (const [symbolIndex, symbolValue] of symbols.entries()) {
      const symbol = architectureRecord(symbolValue, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}]`);
      architectureExactKeys(symbol, ["name", "sinks"], `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}]`);
      architectureNonEmptyString(symbol.name, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].name`);
      const sinks = architectureArray(symbol.sinks, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].sinks`, true);
      for (const [sinkIndex, sinkValue] of sinks.entries()) {
        const sink = architectureRecord(sinkValue, `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].sinks[${sinkIndex}]`);
        architectureExactKeys(sink, ["id", "path", "symbol"], `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].sinks[${sinkIndex}]`);
        for (const key of ["id", "path", "symbol"] as const) {
          architectureNonEmptyString(sink[key], `architecture-node-source-invalid: ${node.id}.entrypoints[${entrypointIndex}].symbols[${symbolIndex}].sinks[${sinkIndex}].${key}`);
        }
      }
    }
  }
}

function assertArchitectureFlowV1(value: Record<string, Json>): void {
  const flow = architectureRecord(value, "architecture-flow-invalid");
  if (flow.schemaVersion !== "archcontext.flow/v1") {
    throw new Error(`architecture-flow-schema-version-unsupported: ${String(flow.id ?? "unknown")} (${String(flow.schemaVersion)})`);
  }
  for (const key of ["id", "capabilityId", "name", "applicability"] as const) {
    architectureNonEmptyString(flow[key], `architecture-flow-invalid: ${String(flow.id ?? "unknown")}.${key}`);
  }
  const flowId = String(flow.id);
  if (flow.applicability === "not-applicable") {
    architectureExactKeys(flow, ["schemaVersion", "id", "capabilityId", "name", "applicability", "rationale"], `architecture-flow-invalid: ${flowId}`);
    architectureNonEmptyString(flow.rationale, `architecture-flow-invalid: ${flowId}.rationale`);
    return;
  }
  if (flow.applicability !== "required") throw new Error(`architecture-flow-invalid: ${flowId}.applicability`);
  architectureExactKeys(flow, ["schemaVersion", "id", "capabilityId", "name", "applicability", "participants", "steps", "outcomes"], `architecture-flow-invalid: ${flowId}`);
  const participants = architectureArray(flow.participants, `architecture-flow-invalid: ${flowId}.participants`, true);
  for (const [index, participantValue] of participants.entries()) {
    const participant = architectureRecord(participantValue, `architecture-flow-invalid: ${flowId}.participants[${index}]`);
    architectureExactKeys(participant, ["id", "nodeId"], `architecture-flow-invalid: ${flowId}.participants[${index}]`);
    architectureNonEmptyString(participant.id, `architecture-flow-invalid: ${flowId}.participants[${index}].id`);
    architectureNonEmptyString(participant.nodeId, `architecture-flow-invalid: ${flowId}.participants[${index}].nodeId`);
  }
  const steps = architectureArray(flow.steps, `architecture-flow-invalid: ${flowId}.steps`, true);
  steps.forEach((step, index) => assertArchitectureFlowStep(step, `${flowId}.steps[${index}]`));
  const outcomes = architectureArray(flow.outcomes, `architecture-flow-invalid: ${flowId}.outcomes`, true);
  if (!outcomes.some((value) => architectureRecord(value, `architecture-flow-invalid: ${flowId}.outcomes`).kind === "success")
    || !outcomes.some((value) => architectureRecord(value, `architecture-flow-invalid: ${flowId}.outcomes`).kind === "error")) {
    throw new Error(`architecture-flow-invalid: ${flowId}.outcomes requires success and error`);
  }
  for (const [index, outcomeValue] of outcomes.entries()) {
    const outcome = architectureRecord(outcomeValue, `architecture-flow-invalid: ${flowId}.outcomes[${index}]`);
    architectureExactKeys(outcome, ["id", "kind", "label", "steps", "terminal"], `architecture-flow-invalid: ${flowId}.outcomes[${index}]`);
    architectureNonEmptyString(outcome.id, `architecture-flow-invalid: ${flowId}.outcomes[${index}].id`);
    architectureNonEmptyString(outcome.label, `architecture-flow-invalid: ${flowId}.outcomes[${index}].label`);
    if (outcome.kind !== "success" && outcome.kind !== "error") throw new Error(`architecture-flow-invalid: ${flowId}.outcomes[${index}].kind`);
    architectureArray(outcome.steps, `architecture-flow-invalid: ${flowId}.outcomes[${index}].steps`, true)
      .forEach((step, stepIndex) => assertArchitectureFlowStep(step, `${flowId}.outcomes[${index}].steps[${stepIndex}]`));
    const terminal = architectureRecord(outcome.terminal, `architecture-flow-invalid: ${flowId}.outcomes[${index}].terminal`);
    architectureExactKeys(terminal, ["participant", "label"], `architecture-flow-invalid: ${flowId}.outcomes[${index}].terminal`);
    architectureNonEmptyString(terminal.participant, `architecture-flow-invalid: ${flowId}.outcomes[${index}].terminal.participant`);
    architectureNonEmptyString(terminal.label, `architecture-flow-invalid: ${flowId}.outcomes[${index}].terminal.label`);
  }
}

function assertArchitectureFlowStep(value: unknown, path: string): void {
  const step = architectureRecord(value, `architecture-flow-invalid: ${path}`);
  architectureExactKeys(step, ["id", "from", "to", "label", "evidence"], `architecture-flow-invalid: ${path}`);
  for (const key of ["id", "from", "to", "label"] as const) architectureNonEmptyString(step[key], `architecture-flow-invalid: ${path}.${key}`);
  const evidence = architectureRecord(step.evidence, `architecture-flow-invalid: ${path}.evidence`);
  architectureExactKeys(evidence, ["entrypointId", "sourceSymbol", "sinkId"], `architecture-flow-invalid: ${path}.evidence`);
  for (const key of ["entrypointId", "sourceSymbol", "sinkId"] as const) architectureNonEmptyString(evidence[key], `architecture-flow-invalid: ${path}.evidence.${key}`);
}

function architectureRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function architectureArray(value: unknown, message: string, nonEmpty = false): unknown[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) throw new Error(message);
  return value;
}

function architectureStringArray(value: unknown, message: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(message);
}

function architectureNonEmptyString(value: unknown, message: string): void {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
}

function architectureExactKeys(value: Record<string, unknown>, allowed: string[], message: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${message}.unknown-field:${unknown.sort().join(",")}`);
}

function readYamlObjects(dir: string): Record<string, Json>[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => {
      const path = resolve(dir, file);
      return parseJsonOrStableYaml(readFileSync(path, "utf8"), path) as Record<string, Json>;
    });
}
