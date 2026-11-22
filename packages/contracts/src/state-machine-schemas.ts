import {
  Const,
  NonEmptyStringSchema,
  OneOf,
  PositiveIntSchema,
  RawEnum,
  Ref,
  SchemaDocument,
  StrictObject,
  Type,
  TypedUnsafe
} from "./schema-kit";
import {
  STATE_MACHINE_CHECK_SCHEMA_VERSION,
  type StateMachineGlobalState,
  type StateMachinePathStep
} from "./state-machine-types";

const StateMachineLocalIdSchema = Type.String({ pattern: "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" });
const StateMachineStepIndexSchema = Type.Integer({
  minimum: 1,
  description: "The 1-based index of the step in its event."
});
const StateMachineGlobalStateDefSchema = TypedUnsafe<StateMachineGlobalState>({
  description: "One state per region, keyed by region id in declaration order.",
  type: "object",
  minProperties: 1,
  propertyNames: { $ref: "#/$defs/localId" },
  additionalProperties: { $ref: "#/$defs/localId" }
});
const StateMachinePathDefSchema = Type.Array(
  StrictObject({
    event: Ref<string>("#/$defs/localId"),
    step: Ref<number>("#/$defs/stepIndex")
  }),
  { description: "The shortest sequence of fired steps from the initial global state." }
);

const StateMachineRuleResultSchema = StrictObject(
  {
    id: Ref<string>("#/$defs/localId"),
    kind: RawEnum(["never", "final"] as const),
    status: RawEnum(["holds", "broken", "finding-open", "finding-resolved"] as const),
    tracking: Type.Optional(
      Type.String({
        pattern:
          "^https://[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::[0-9]{1,5})?(?:[/?#][^\\s]*)?$"
      })
    ),
    state: Type.Optional(Ref<StateMachineGlobalState>("#/$defs/globalState")),
    path: Type.Optional(Ref<StateMachinePathStep[]>("#/$defs/path")),
    protectedBy: Type.Optional(
      Type.Array(
        StrictObject({
          event: Ref<string>("#/$defs/localId"),
          step: Ref<number>("#/$defs/stepIndex"),
          region: Ref<string>("#/$defs/localId")
        }),
        { description: "The guards whose removal breaks this holding rule, in declaration order of the guards." }
      )
    )
  },
  {
    allOf: [
      {
        if: { properties: { status: { enum: ["broken", "finding-open"] } } },
        then: { required: ["state", "path"], not: { required: ["protectedBy"] } },
        else: { not: { anyOf: [{ required: ["state"] }, { required: ["path"] }] } }
      },
      {
        if: { properties: { status: { enum: ["finding-open", "finding-resolved"] } } },
        then: { required: ["tracking"] },
        else: { not: { required: ["tracking"] } }
      }
    ]
  }
);

const StateMachineBreakDefSchema = OneOf([
  StrictObject({
    kind: Const("unreachable-state"),
    region: Ref<string>("#/$defs/localId"),
    state: Ref<string>("#/$defs/localId")
  }),
  StrictObject({
    kind: Const("dead-step"),
    event: Ref<string>("#/$defs/localId"),
    step: Ref<number>("#/$defs/stepIndex")
  }),
  StrictObject({
    kind: Const("deadlock"),
    state: Ref<StateMachineGlobalState>("#/$defs/globalState"),
    path: Ref<StateMachinePathStep[]>("#/$defs/path"),
    count: Type.Integer({ minimum: 1, description: "The number of deadlocked reachable global states." })
  })
]);

const StateMachineAnchorDefSchema = StrictObject(
  {
    owner: RawEnum(["region", "event"] as const),
    ownerId: Ref<string>("#/$defs/localId"),
    path: NonEmptyStringSchema,
    symbol: Type.Optional(NonEmptyStringSchema),
    status: RawEnum([
      "anchor-missing-path",
      "anchor-language-unsupported",
      "anchor-missing-symbol",
      "anchor-ambiguous-symbol",
      "unchecked",
      "anchor-unconfirmed",
      "anchor-changed",
      "confirmed"
    ] as const),
    digest: Type.Optional(
      Type.String({
        pattern: "^sha256:[0-9a-f]{64}$",
        description: "The file content, or a JSON array of the lines of the one matching declaration and of each direct callee, with CRLF read as LF."
      })
    ),
    callees: Type.Optional(
      Type.Array(
        StrictObject({
          path: NonEmptyStringSchema,
          qualifiedName: NonEmptyStringSchema
        }),
        { description: "The direct callees that the digest of a symbol anchor covers, in digest order." }
      )
    ),
    reason: Type.Optional(
      RawEnum(["index-missing", "index-open-failed", "index-stale"] as const, {
        description:
          "Why the symbol reader is unavailable, or that the index does not hold the current content of the anchor's file or of a callee's file."
      })
    )
  },
  {
    allOf: [
      {
        if: { required: ["symbol", "digest"] },
        then: { required: ["callees"] },
        else: { not: { required: ["callees"] } }
      },
      {
        if: { properties: { status: { enum: ["anchor-unconfirmed", "anchor-changed", "confirmed"] } } },
        then: { required: ["digest"] },
        else: { not: { required: ["digest"] } }
      },
      {
        if: { properties: { status: { const: "unchecked" } } },
        then: { required: ["reason", "symbol"] },
        else: { not: { required: ["reason"] } }
      }
    ]
  }
);

export const StateMachineCheckReportBodySchema = StrictObject({
  schemaVersion: Const(STATE_MACHINE_CHECK_SCHEMA_VERSION),
  machines: Type.Array(
    StrictObject({
      id: Type.String({ pattern: "^state-machine\\.[a-z][a-z0-9-]*(\\.[a-z0-9][a-z0-9-]*)*$" }),
      capabilityId: Type.String({ pattern: "^capability\\.[a-z][a-z0-9-]*(\\.[a-z0-9][a-z0-9-]*)*$" }),
      reachableStates: PositiveIntSchema,
      transitions: Type.Integer({
        minimum: 0,
        description: "Pairs of a reachable global state and an enabled step that changes it."
      }),
      rules: Type.Array(StateMachineRuleResultSchema, { description: "In declaration order." }),
      breaks: Type.Array(StateMachineBreakDefSchema, {
        description: "Every unreachable state, then every dead step, each in declaration order, then at most one deadlock."
      }),
      anchors: Type.Array(StateMachineAnchorDefSchema, {
        description: "Every code source of a region or an event, regions first, then events, each in declaration order, with its status against the current file."
      })
    }),
    { description: "Sorted by machine id." }
  )
});

export const StateMachineCheckReportSchema = SchemaDocument({
  $id: "https://archcontext.dev/schemas/runtime/state-machine-check.schema.json",
  title: "StateMachineCheckV1",
  description:
    "The data of `archctx state-machines check`: for every declared state machine, the size of its reachable global state space, the result of each declared rule, the built-in breaks and the status of each code anchor. The same model gives the same bytes.",
  schema: StateMachineCheckReportBodySchema,
  $defs: {
    localId: StateMachineLocalIdSchema,
    stepIndex: StateMachineStepIndexSchema,
    globalState: StateMachineGlobalStateDefSchema,
    path: StateMachinePathDefSchema
  }
});
