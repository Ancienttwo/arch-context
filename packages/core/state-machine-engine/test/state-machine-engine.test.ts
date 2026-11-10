import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FailureError, type StateMachineV1 } from "@archcontext/contracts";
import { checkStateMachine, checkStateMachines, loadStateMachinesFromArchContext } from "../src";

const fixtures = resolve(import.meta.dir, "../../../contracts/fixtures/valid");
const example = (): StateMachineV1 => JSON.parse(readFileSync(join(fixtures, "architecture-state-machine.json"), "utf8"));
const nodes = [{ id: "capability.checkout", kind: "capability" }];

function withMachines(machines: Record<string, unknown>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "state-machine-engine-"));
  try {
    mkdirSync(join(root, ".archcontext/model/state-machines"), { recursive: true });
    for (const [name, machine] of Object.entries(machines)) writeFileSync(join(root, ".archcontext/model/state-machines", name), JSON.stringify(machine));
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function loadIssues(machine: unknown, modelNodes: Array<Record<string, string>> = nodes): unknown {
  let thrown: unknown;
  withMachines({ "order.yaml": machine }, (root) => {
    try { loadStateMachinesFromArchContext(root, modelNodes); } catch (error) { thrown = error; }
  });
  expect(thrown).toBeInstanceOf(FailureError);
  expect((thrown as FailureError).failure).toMatchObject({ code: "AC_SCHEMA_INVALID", reasonCode: "state-machine-model-invalid" });
  return (thrown as FailureError).details.issues;
}

describe("loadStateMachinesFromArchContext", () => {
  test("a repository without the directory has no machines", () => {
    const root = mkdtempSync(join(tmpdir(), "state-machine-engine-empty-"));
    try { expect(loadStateMachinesFromArchContext(root, nodes)).toEqual([]); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("reads the direct YAML children in file name order", () => {
    const second = { ...example(), id: "state-machine.checkout.second" };
    withMachines({ "b.yaml": second, "a.yml": example(), "notes.txt": {} }, (root) => {
      expect(loadStateMachinesFromArchContext(root, nodes).map((machine) => machine.id)).toEqual(["state-machine.checkout.order", "state-machine.checkout.second"]);
    });
  });

  test("a schema violation fails closed with its path and field", () => {
    expect(loadIssues({ ...example(), name: "Order: payment" })).toEqual([`.archcontext/model/state-machines/order.yaml: $.name: does not match ^[^"#;:<>\\\\|\\r\\n]+$`]);
  });

  test("non-canonical source paths and non-URL tracking values are schema violations", () => {
    const machine: any = example();
    machine.events[0].source.path = "src//payment.ts";
    machine.events[1].source.path = ".";
    machine.rules[0].finding = { tracking: "https://:" };
    expect(loadIssues(machine)).toEqual([
      expect.stringContaining("order.yaml: $.events[0].source: expected exactly one matching schema, got 0"),
      expect.stringContaining("order.yaml: $.events[1].source: expected exactly one matching schema, got 0"),
      expect.stringContaining("order.yaml: $.rules[0].finding.tracking: does not match ^https://")
    ]);
  });

  test("the failure keeps whole issues inside its budget and counts the rest", () => {
    const loadDetails = (machines: Record<string, unknown>) => {
      let thrown: unknown;
      withMachines(machines, (root) => {
        try { loadStateMachinesFromArchContext(root, nodes); } catch (error) { thrown = error; }
      });
      return (thrown as FailureError).details;
    };
    expect(loadDetails({ [`${"a".repeat(230)}.yaml`]: { ...example(), capabilityId: "capability.missing" } })).toEqual({ issues: [], issueCount: 1, omittedCount: 1 });
    const machine = example();
    machine.rules = Array.from({ length: 18 }, () => ({ ...machine.rules[1] }));
    const details = loadDetails({ "order.yaml": machine });
    expect(details).toMatchObject({ issueCount: 17, omittedCount: 1 });
    expect(details.issues).toHaveLength(16);
  });

  test("each issue names its own file when two machines share an id", () => {
    const first: any = example();
    first.regions[0].initial = "closed";
    const second: any = example();
    second.rules[1].id = "paid-before-shipped";
    let thrown: unknown;
    withMachines({ "a.yaml": first, "b.yaml": second }, (root) => {
      try { loadStateMachinesFromArchContext(root, nodes); } catch (error) { thrown = error; }
    });
    expect((thrown as FailureError).details.issues).toEqual([
      ".archcontext/model/state-machines/a.yaml: regions[0].initial: state-machine-initial-unknown",
      ".archcontext/model/state-machines/b.yaml: id: state-machine-id-duplicate",
      ".archcontext/model/state-machines/b.yaml: rules[1].id: state-machine-id-duplicate"
    ]);
  });

  const path = ".archcontext/model/state-machines/order.yaml";
  const cases: Array<[string, (machine: any) => void, string, Array<Record<string, string>>?]> = [
    ["state-machine-id-duplicate", (machine) => { machine.rules[1].id = "paid-before-shipped"; }, "rules[1].id"],
    ["state-machine-capability-missing", () => undefined, "capabilityId", []],
    ["state-machine-initial-unknown", (machine) => { machine.regions[0].initial = "closed"; }, "regions[0].initial"],
    ["state-machine-region-unknown", (machine) => { machine.rules[0].never = { order: ["shipped"], billing: ["unpaid"] }; }, "rules[0].never.billing"],
    ["state-machine-state-unknown", (machine) => { machine.events[1].steps[0].then = { order: "delivered" }; }, "events[1].steps[0].then.order"],
    ["state-machine-step-source-missing", (machine) => { machine.events[1].steps[0].when = { payment: ["captured"] }; }, "events[1].steps[0].then.order"],
    ["state-machine-product-too-large", (machine) => {
      machine.regions.push({ id: "audit", label: "Audit", initial: "s0", states: Array.from({ length: 11_112 }, (_, index) => ({ id: `s${index}`, label: "S" })) });
    }, "regions"]
  ];
  for (const [invariant, mutate, field, modelNodes] of cases) {
    test(`${invariant} fails closed`, () => {
      const machine = example();
      mutate(machine);
      expect(loadIssues(machine, modelNodes)).toEqual([`${path}: ${field}: ${invariant}`]);
    });
  }
});

describe("checkStateMachine", () => {
  test("the example gives the issue report, with the guards that protect the holding rule", () => {
    // The published report adds the anchors that the runtime measures; the pure check reads no code.
    const published = JSON.parse(readFileSync(join(fixtures, "state-machine-check.json"), "utf8"));
    const withoutAnchors = { ...published, machines: published.machines.map(({ anchors: _anchors, ...machine }: Record<string, unknown>) => machine) };
    expect(checkStateMachines([example()], { protection: true })).toEqual(withoutAnchors);
  });

  test("without protection no rule carries protectedBy", () => {
    const [report] = checkStateMachines([example()], { protection: false }).machines;
    expect(report.rules.map((rule) => "protectedBy" in rule)).toEqual([false, false]);
  });

  test("a rule with a finding is finding-open when broken and finding-resolved when it holds", () => {
    const machine = example();
    const tracking = "https://github.com/example/repo/issues/1";
    for (const rule of machine.rules) rule.finding = { tracking };
    expect(checkStateMachine(machine).rules).toEqual([
      { id: "paid-before-shipped", kind: "never", status: "finding-open", tracking, state: { order: "shipped", payment: "unpaid" }, path: [{ event: "ship", step: 1 }] },
      { id: "closed-order-stays-closed", kind: "final", status: "finding-resolved", tracking }
    ]);
  });

  test("a final rule is broken by the step that moves its region, which ends the path", () => {
    const machine = example();
    machine.events[1].steps[0].when = { order: ["open", "cancelled"] };
    expect(checkStateMachine(machine).rules[1]).toEqual({
      id: "closed-order-stays-closed", kind: "final", status: "broken",
      state: { order: "cancelled", payment: "unpaid" }, path: [{ event: "cancel", step: 1 }, { event: "ship", step: 1 }]
    });
  });

  test("reports unreachable states, dead steps and the first deadlock with its count", () => {
    const states = ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id.toUpperCase() }));
    const step = (from: string, to: string) => ({ when: { r: [from] }, then: { r: to } });
    const source = { kind: "environment" as const };
    const machine: StateMachineV1 = {
      schemaVersion: "archcontext.state-machine/v1", id: "state-machine.checkout.breaks", capabilityId: "capability.checkout", name: "Breaks",
      regions: [{ id: "r", label: "R", initial: "a", states }],
      events: [
        { id: "go", label: "Go", source, steps: [step("a", "b")] },
        { id: "alt", label: "Alt", source, steps: [step("a", "c")] },
        { id: "dead", label: "Dead", source, steps: [step("e", "d")] }
      ],
      rules: []
    };
    expect(checkStateMachine(machine)).toEqual({
      id: "state-machine.checkout.breaks", capabilityId: "capability.checkout", reachableStates: 3, transitions: 2, rules: [],
      breaks: [
        { kind: "unreachable-state", region: "r", state: "d" },
        { kind: "unreachable-state", region: "r", state: "e" },
        { kind: "dead-step", event: "dead", step: 1 },
        { kind: "deadlock", state: { r: "b" }, path: [{ event: "go", step: 1 }], count: 2 }
      ]
    });
  });
});
