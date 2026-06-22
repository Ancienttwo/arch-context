import type { Json } from "./schema";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

type JsonSchema = {
  type?: string | string[];
  const?: Json;
  enum?: Json[];
  pattern?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minItems?: number;
  minimum?: number;
  maximum?: number;
};

export function validateJsonSchema(schema: JsonSchema, value: Json): ValidationResult {
  const issues: ValidationIssue[] = [];
  visit(schema, value, "$", issues);
  return { valid: issues.length === 0, issues };
}

function visit(schema: JsonSchema, value: Json, path: string, issues: ValidationIssue[]): void {
  if (schema.oneOf) {
    const matched = schema.oneOf.filter((candidate) => {
      const candidateIssues: ValidationIssue[] = [];
      visit(candidate, value, path, candidateIssues);
      return candidateIssues.length === 0;
    }).length;
    if (matched !== 1) {
      issues.push({ path, message: `expected exactly one matching schema, got ${matched}` });
      return;
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    issues.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
    return;
  }
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    issues.push({ path, message: `expected one of ${schema.enum.map(String).join(", ")}` });
  }
  if (schema.type && !matchesType(schema.type, value)) {
    issues.push({ path, message: `expected type ${Array.isArray(schema.type) ? schema.type.join("|") : schema.type}` });
    return;
  }
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    issues.push({ path, message: `does not match ${schema.pattern}` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path, message: `below minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path, message: `above maximum ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({ path, message: `expected at least ${schema.minItems} items` });
    }
    if (schema.items) value.forEach((item, index) => visit(schema.items!, item, `${path}[${index}]`, issues));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const objectValue = value as Record<string, Json>;
    for (const key of schema.required ?? []) {
      if (!(key in objectValue)) issues.push({ path: `${path}.${key}`, message: "required" });
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in objectValue) visit(child, objectValue[key], `${path}.${key}`, issues);
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(objectValue)) {
        if (!(key in schema.properties)) issues.push({ path: `${path}.${key}`, message: "additional property denied" });
      }
    }
  }
}

function matchesType(type: string | string[], value: Json): boolean {
  const allowed = Array.isArray(type) ? type : [type];
  return allowed.some((candidate) => {
    if (candidate === "array") return Array.isArray(value);
    if (candidate === "null") return value === null;
    if (candidate === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (candidate === "integer") return Number.isInteger(value);
    return typeof value === candidate;
  });
}
