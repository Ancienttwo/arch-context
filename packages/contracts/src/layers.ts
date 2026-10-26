/** Explicit ordered layer authority; no path, parent or name inference. */
export function orderedLayerIssues(layers: unknown, nodes: readonly { id?: unknown; layer?: unknown }[] = []): string[] {
  if (layers === undefined) return [];
  if (!Array.isArray(layers) || layers.length === 0 || layers.some(layer => typeof layer !== "string" || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(layer)) || new Set(layers).size !== layers.length) return ["architecture-layer-order-invalid"];
  return nodes.filter(node => node.layer !== undefined && !layers.includes(node.layer)).map(node => `architecture-node-layer-undeclared: ${String(node.id)} (${String(node.layer)})`);
}
