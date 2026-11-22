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

/** The built-in check of one machine by the model alone: rules and breaks, no code read. */
export interface StateMachineMachineReport {
  id: string;
  capabilityId: string;
  reachableStates: number;
  transitions: number;
  rules: StateMachineRuleResult[];
  breaks: StateMachineBreak[];
}

export type StateMachineAnchorStatus =
  | "anchor-missing-path"
  | "anchor-language-unsupported"
  | "anchor-missing-symbol"
  | "anchor-ambiguous-symbol"
  | "unchecked"
  | "anchor-unconfirmed"
  | "anchor-changed"
  | "confirmed";

/** The status of one `code` source of a region or an event, measured against the current file. */
export interface StateMachineAnchor {
  owner: "region" | "event";
  ownerId: string;
  path: string;
  symbol?: string;
  status: StateMachineAnchorStatus;
  /** Present for `anchor-unconfirmed`, `anchor-changed` and `confirmed`. */
  digest?: string;
  /** Present for a symbol anchor with a digest: the direct callees that the digest covers, in digest order. */
  callees?: StateMachineAnchorCallee[];
  /**
   * Present for `unchecked`: the symbol reader is unavailable, or the index does not hold the
   * current content of the anchor's file or of a callee's file.
   */
  reason?: "index-missing" | "index-open-failed" | "index-stale";
}

export interface StateMachineAnchorCallee {
  path: string;
  qualifiedName: string;
}

export interface StateMachineCheckMachineV1 extends StateMachineMachineReport {
  /** Every code anchor, regions first, then events, each in declaration order. */
  anchors: StateMachineAnchor[];
}

/** `schemas/runtime/state-machine-check.schema.json`, the data of `archctx state-machines check`. */
export interface StateMachineCheckReportV1 {
  schemaVersion: typeof STATE_MACHINE_CHECK_SCHEMA_VERSION;
  /** Sorted by machine id. */
  machines: StateMachineCheckMachineV1[];
}
