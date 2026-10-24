import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITY_DEPENDENCY_DECLARING_RELATION_KINDS, runtimeTopologyModelIssues, validateJsonSchema, type Json } from "../src";
import nodeSchema from "../../../schemas/repo/architecture-node.schema.json";
import relationSchema from "../../../schemas/repo/architecture-relation.schema.json";

type ModelFixture = { nodes: Record<string, Json>[]; relations: Record<string, Json>[] };

const fixtures = join(import.meta.dir, "../fixtures");
const readFixture = <T = Json>(path: string): T => JSON.parse(readFileSync(join(fixtures, path), "utf8")) as T;
const nodeIssues = (value: unknown) => validateJsonSchema(nodeSchema as any, value as Json).issues;
const relationIssues = (value: unknown) => validateJsonSchema(relationSchema as any, value as Json).issues;
const topology = () => readFixture<ModelFixture>("model/valid/runtime-topology.json");

describe("runtime topology schema (ADR-0049)", () => {
  test("accepts the topology node kinds and relation kinds", () => {
    expect(nodeSchema.properties.kind.enum).toEqual(expect.arrayContaining(["process", "namespace", "mount"]));
    expect(relationSchema.properties.kind.enum).toEqual(expect.arrayContaining(["spawns", "runs-in", "mounts"]));
  });

  test("a mount carries its mount object, and a mount without a target path is rejected", () => {
    const mount = readFixture<Record<string, Json>>("valid/architecture-node-mount.json");
    expect(nodeIssues(mount)).toEqual([]);
    const { source: _source, ...withoutSource } = mount.mount as Record<string, Json>;
    expect(nodeIssues({ ...mount, mount: withoutSource })).toEqual([]);
    const missingTarget = readFixture("invalid/node-mount-missing-target.json");
    expect(nodeIssues(missingTarget)).toEqual([{ path: "$.mount.target", message: "required" }]);
    const { mount: _mount, ...bare } = mount;
    expect(nodeIssues(bare).map((issue) => issue.path)).toEqual(["$.mount"]);
    for (const field of ["mode", "order"]) {
      const { [field]: _dropped, ...partial } = mount.mount as Record<string, Json>;
      expect(nodeIssues({ ...mount, mount: partial }).map((issue) => issue.path), field).toEqual([`$.mount.${field}`]);
    }
    for (const target of ["app", "./app", "/app/", "//app", "/app//data", ""]) {
      expect(nodeIssues({ ...mount, mount: { ...(mount.mount as Record<string, Json>), target } }).length, target).toBeGreaterThan(0);
    }
    for (const target of ["/", "/app", "/app/data", "/etc/ssl certs"]) {
      expect(nodeIssues({ ...mount, mount: { ...(mount.mount as Record<string, Json>), target } }), target).toEqual([]);
    }
    for (const patch of [{ mode: "rx" }, { order: -1 }, { order: 1.5 }, { order: "0" }, { source: "" }, { extra: true }]) {
      expect(nodeIssues({ ...mount, mount: { ...(mount.mount as Record<string, Json>), ...patch } }).length, JSON.stringify(patch)).toBeGreaterThan(0);
    }
  });

  test("a namespace requires its typed namespace object and other kinds reject topology objects", () => {
    const [namespace] = topology().nodes.filter((node) => node.kind === "namespace");
    expect(nodeIssues(namespace)).toEqual([]);
    const { namespace: _namespace, ...bare } = namespace!;
    expect(nodeIssues(bare).map((issue) => issue.path)).toEqual(["$.namespace"]);
    for (const type of ["host", "container", "pod", "kubernetes", "pid", "mount", "net", "user"]) {
      expect(nodeIssues({ ...namespace, namespace: { type } }), type).toEqual([]);
    }
    expect(nodeIssues({ ...namespace, namespace: { type: "cgroup" } }).length).toBeGreaterThan(0);
    expect(nodeIssues({ ...namespace, namespace: {} }).length).toBeGreaterThan(0);
    const mountObject = { target: "/app", mode: "ro", order: 0 };
    expect(nodeIssues({ ...namespace, mount: mountObject }).length).toBeGreaterThan(0);
    const component = { schemaVersion: "archcontext.node/v2", id: "component.shop.api", kind: "component", name: "API", status: "active", summary: "API." };
    expect(nodeIssues(component)).toEqual([]);
    expect(nodeIssues({ ...component, mount: mountObject }).length).toBeGreaterThan(0);
    expect(nodeIssues({ ...component, namespace: { type: "host" } }).length).toBeGreaterThan(0);
  });

  test("topology nodes may declare source.include for later config freshness", () => {
    const [process] = topology().nodes.filter((node) => node.kind === "process");
    expect(nodeIssues({ ...process, source: { include: ["compose.yaml", "k8s/*.yaml"] } })).toEqual([]);
  });

  test("topology relations declare no capability dependency", () => {
    for (const kind of ["spawns", "runs-in", "mounts", "deployed-on"]) {
      expect((CAPABILITY_DEPENDENCY_DECLARING_RELATION_KINDS as readonly string[]).includes(kind), kind).toBe(false);
    }
  });
});

describe("model fixtures", () => {
  const valid = readdirSync(join(fixtures, "model/valid")).filter((file) => file.endsWith(".json")).sort();

  test("cover one layered model and one topology model", () => {
    expect(valid).toEqual(["layered.json", "runtime-topology.json"]);
    expect(readFixture<ModelFixture>("model/valid/layered.json").nodes.some((node) => typeof node.layer === "string")).toBe(true);
    expect(new Set(topology().nodes.map((node) => node.kind))).toEqual(new Set(["capability", "component", "namespace", "process", "mount"]));
  });

  test.each(valid)("%s validates record by record and across entities", (file) => {
    const model = readFixture<ModelFixture>(`model/valid/${file}`);
    for (const node of model.nodes) expect(nodeIssues(node), String(node.id)).toEqual([]);
    for (const relation of model.relations) expect(relationIssues(relation), String(relation.id)).toEqual([]);
    expect(runtimeTopologyModelIssues(model)).toEqual([]);
  });

  test("a runs-in relation whose target is not a namespace is rejected", () => {
    const model = readFixture<ModelFixture>("model/invalid/runtime-topology-runs-in-non-namespace.json");
    for (const node of model.nodes) expect(nodeIssues(node)).toEqual([]);
    for (const relation of model.relations) expect(relationIssues(relation)).toEqual([]);
    expect(runtimeTopologyModelIssues(model)).toEqual([
      { entityId: "relation.shop.api-runs-in-component", field: "target", invariant: "topology-relation-target-kind-invalid" }
    ]);
  });
});

describe("runtimeTopologyModelIssues", () => {
  const withRelation = (relation: Record<string, Json>): ModelFixture => {
    const model = topology();
    return { ...model, relations: [...model.relations, { schemaVersion: "archcontext.relation/v1", intent: "test", ...relation }] };
  };

  const cases: Array<[string, Record<string, Json>, string, string]> = [
    ["spawns from a namespace", { id: "relation.bad", kind: "spawns", source: "namespace.shop.pod", target: "process.shop.worker" }, "source", "topology-relation-source-kind-invalid"],
    ["spawns a mount", { id: "relation.bad", kind: "spawns", source: "process.shop.cron", target: "mount.shop.tmp" }, "target", "topology-relation-target-kind-invalid"],
    ["runs-in from a namespace", { id: "relation.bad", kind: "runs-in", source: "namespace.shop.pod", target: "namespace.shop.host" }, "source", "topology-relation-source-kind-invalid"],
    ["mounts from a component", { id: "relation.bad", kind: "mounts", source: "component.shop.api", target: "mount.shop.tmp" }, "source", "topology-relation-source-kind-invalid"],
    ["mounts a process", { id: "relation.bad", kind: "mounts", source: "process.shop.cron", target: "process.shop.worker" }, "target", "topology-relation-target-kind-invalid"],
    ["a missing endpoint", { id: "relation.bad", kind: "runs-in", source: "process.shop.cron", target: "namespace.shop.absent" }, "target", "topology-relation-endpoint-missing"]
  ];
  test.each(cases)("rejects %s", (_name, relation, field, invariant) => {
    expect(runtimeTopologyModelIssues(withRelation(relation))).toEqual([{ entityId: "relation.bad", field, invariant }]);
  });

  test("a process runs in one namespace and a mount has one mounter", () => {
    expect(runtimeTopologyModelIssues(withRelation({ id: "relation.bad", kind: "runs-in", source: "process.shop.worker", target: "namespace.shop.pod" })))
      .toEqual([{ entityId: "process.shop.worker", field: "runs-in", invariant: "topology-process-namespace-ambiguous" }]);
    expect(runtimeTopologyModelIssues(withRelation({ id: "relation.bad", kind: "mounts", source: "process.shop.cron", target: "mount.shop.tmp" })))
      .toEqual([{ entityId: "mount.shop.tmp", field: "mounts", invariant: "topology-mount-mounter-ambiguous" }]);
  });

  test("a namespace parent is an existing namespace without a cycle", () => {
    const withParent = (id: string, parent: string): ModelFixture => {
      const model = topology();
      return { ...model, nodes: model.nodes.map((node) => node.id === id ? { ...node, parent } : node) };
    };
    expect(runtimeTopologyModelIssues(withParent("namespace.shop.pod", "capability.shop")))
      .toEqual([{ entityId: "namespace.shop.pod", field: "parent", invariant: "topology-namespace-parent-kind-invalid" }]);
    expect(runtimeTopologyModelIssues(withParent("namespace.shop.pod", "namespace.shop.absent")))
      .toEqual([{ entityId: "namespace.shop.pod", field: "parent", invariant: "topology-namespace-parent-missing" }]);
    expect(runtimeTopologyModelIssues(withParent("namespace.shop.host", "namespace.shop.api-container")).map((issue) => issue.invariant))
      .toEqual(["topology-namespace-parent-cycle", "topology-namespace-parent-cycle", "topology-namespace-parent-cycle"]);
  });

  test("relations of other kinds are not constrained", () => {
    expect(runtimeTopologyModelIssues(withRelation({ id: "relation.ok", kind: "calls", source: "process.shop.cron", target: "mount.shop.tmp" }))).toEqual([]);
  });
});
