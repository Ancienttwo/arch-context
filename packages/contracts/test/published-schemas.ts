import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { jsonSchemaResolver, validateJsonSchema, type Json, type JsonSchemaResolver, type ValidationIssue } from "../src";

/** The repository's published `schemas/` tree. */
export const PUBLISHED_SCHEMAS_ROOT = join(import.meta.dir, "../../../schemas");

type SchemaDocument = Parameters<typeof validateJsonSchema>[0];

let cached: JsonSchemaResolver | undefined;

/**
 * Every published schema that can be addressed by URI, keyed by its `$id`, so a relative `$ref`
 * such as `evidence-binding.schema.json` resolves exactly the way a full JSON Schema validator
 * (Ajv and friends) loading the same directory would resolve it. A document without an `$id`
 * cannot be the target of a URI reference, so it is not part of the addressable set.
 */
export function publishedSchemaResolver(): JsonSchemaResolver {
  if (cached) return cached;
  const documents = publishedSchemaFiles()
    .map((path) => JSON.parse(readFileSync(path, "utf8")) as SchemaDocument)
    .filter((document) => typeof document.$id === "string");
  cached = jsonSchemaResolver(documents);
  return cached;
}

/** Validates against a published schema with every `$ref` — local and cross-file — resolved. */
export function publishedSchemaIssues(schemaPath: string, value: unknown): ValidationIssue[] {
  const schema = JSON.parse(readFileSync(join(PUBLISHED_SCHEMAS_ROOT, schemaPath), "utf8")) as SchemaDocument;
  return validateJsonSchema(schema, value as Json, { resolveSchema: publishedSchemaResolver() }).issues;
}

export function publishedSchemaFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".schema.json")) files.push(path);
    }
  };
  walk(PUBLISHED_SCHEMAS_ROOT);
  return files.sort((left, right) => relative(PUBLISHED_SCHEMAS_ROOT, left).localeCompare(relative(PUBLISHED_SCHEMAS_ROOT, right)));
}
