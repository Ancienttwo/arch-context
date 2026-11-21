import {
  Type,
  type ArrayOptions,
  type IntegerOptions,
  type NumberOptions,
  type ObjectOptions,
  type SchemaOptions,
  type Static,
  type StringOptions,
  type TProperties,
  type TSchema,
  type TUnsafe
} from "@sinclair/typebox";
import type { Json } from "./schema";

export { Type, type Static, type TSchema };

export const JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema" as const;

export const SHA256_DIGEST_REGEX = "^sha256:[a-f0-9]{64}$";
export const GIT_OID_REGEX = "^(?:[a-f0-9]{40}|[a-f0-9]{64})$";
export const GIT_COMMIT_SHA_REGEX = "^[a-f0-9]{40}$";
export const SEMVER_REGEX = "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$";
export const STRICT_SEMVER_REGEX =
  "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$";

export function StrictObject<T extends TProperties>(properties: T, options: ObjectOptions = {}) {
  return Type.Object(properties, { additionalProperties: false, ...options });
}

export function LooseObject<T extends TProperties>(properties: T, options: ObjectOptions = {}) {
  return Type.Object(properties, options);
}

export function StringEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  options: SchemaOptions = {}
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({ ...options, type: "string", enum: [...values] });
}

export function RawEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  options: SchemaOptions = {}
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({ ...options, enum: [...values] });
}

export function Const<const T extends string | number | boolean>(
  value: T,
  options: SchemaOptions = {}
): TUnsafe<T> {
  return Type.Unsafe<T>({ ...options, const: value });
}

export function OneOf<const T extends TSchema[]>(
  schemas: [...T],
  options: SchemaOptions = {}
): TUnsafe<{ [K in keyof T]: T[K] extends TSchema ? Static<T[K]> : never }[number]> {
  return Type.Unsafe({ ...options, oneOf: schemas });
}

export function AnyOf<const T extends TSchema[]>(
  schemas: [...T],
  options: SchemaOptions = {}
): TUnsafe<{ [K in keyof T]: T[K] extends TSchema ? Static<T[K]> : never }[number]> {
  return Type.Unsafe({ ...options, anyOf: schemas });
}

export function Nullable<T extends TSchema>(schema: T, options: SchemaOptions = {}): TUnsafe<Static<T> | null> {
  return OneOf([schema, Type.Null()], options) as TUnsafe<Static<T> | null>;
}

export function NullableType<const P extends "string" | "integer" | "number" | "boolean">(
  primitive: P,
  options: SchemaOptions & StringOptions & NumberOptions & IntegerOptions = {}
): TUnsafe<
  (P extends "string" ? string : P extends "boolean" ? boolean : number) | null
> {
  return Type.Unsafe({ ...options, type: [primitive, "null"] });
}

export function RecordOf<T extends TSchema>(
  valueSchema: T,
  options: SchemaOptions = {}
): TUnsafe<Record<string, Static<T>>> {
  return Type.Unsafe<Record<string, Static<T>>>({
    ...options,
    type: "object",
    additionalProperties: valueSchema
  });
}

export function Ref<Out = unknown>(ref: string, options: SchemaOptions = {}): TUnsafe<Out> {
  return Type.Unsafe<Out>({ ...options, $ref: ref });
}

export function TypedUnsafe<Out>(rawSchema: Record<string, unknown>): TUnsafe<Out> {
  return Type.Unsafe<Out>(rawSchema);
}

export function UniqueStringArray<T extends TSchema = typeof BoundedStringSchema>(
  itemSchema: T = BoundedStringSchema as unknown as T,
  options: ArrayOptions = {}
) {
  return Type.Array(itemSchema, { uniqueItems: true, ...options });
}

export function SchemaDocument<T extends TSchema>(input: {
  $id: string;
  title: string;
  schema: T;
  description?: string;
  $defs?: Record<string, TSchema>;
}): T {
  const { $id, title, schema, description, $defs } = input;
  const { $schema: _s, $id: _i, title: _t, description: _d, ...body } = schema as unknown as Record<string, unknown>;
  const ordered: Record<string, unknown> = {
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    $id,
    title
  };
  if (description !== undefined) ordered.description = description;
  else if (typeof schema.description === "string") ordered.description = schema.description;
  for (const [key, value] of Object.entries(body)) {
    ordered[key] = value;
  }
  if ($defs && Object.keys($defs).length > 0) {
    ordered.$defs = $defs;
  }
  return ordered as unknown as T;
}

export function serializeSchemaDocument(schema: TSchema): string {
  const plain = JSON.parse(JSON.stringify(schema)) as unknown;
  return `${JSON.stringify(plain, null, 2)}\n`;
}

export const NonEmptyStringSchema = Type.String({ minLength: 1 });
export const BoundedStringSchema = Type.String({ minLength: 1, maxLength: 1024 });
export const CountSchema = Type.Integer({ minimum: 0 });
export const PositiveIntSchema = Type.Integer({ minimum: 1 });
export const Sha256DigestSchema = Type.String({ pattern: SHA256_DIGEST_REGEX });
export const GitOidSchema = Type.String({ pattern: GIT_OID_REGEX });
export const GitCommitShaSchema = Type.String({ pattern: GIT_COMMIT_SHA_REGEX });
export const SemverSchema = Type.String({ pattern: SEMVER_REGEX });
export const StrictSemverSchema = Type.String({ pattern: STRICT_SEMVER_REGEX });

export const RepoPathSchema: TUnsafe<string> = TypedUnsafe<string>({
  type: "string",
  minLength: 1,
  not: {
    anyOf: [
      { pattern: "^/" },
      { pattern: "\\\\" },
      { pattern: "(^|/)\\.\\.(/|$)" }
    ]
  }
});

export const JsonValueSchema: TUnsafe<Json> = Type.Unsafe<Json>({});
export const JsonObjectSchema: TUnsafe<{ [key: string]: Json }> = Type.Unsafe<{ [key: string]: Json }>({
  type: "object"
});

export const SeveritySchema = RawEnum(["notice", "warning", "error", "critical"] as const);

export const CodeFactsStateSchema = StringEnum([
  "ready",
  "not-ready",
  "index-missing",
  "unavailable"
] as const);

export const ArchContextErrorSchema = StrictObject({
  code: Type.String({ pattern: "^AC_[A-Z_]+$" }),
  message: Type.String(),
  severity: SeveritySchema,
  retryable: Type.Boolean(),
  action: Type.String(),
  reasonCode: Type.Optional(Type.String()),
  details: Type.Optional(JsonObjectSchema)
});
