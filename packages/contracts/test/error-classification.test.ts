import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { failureIssues, toEnvelope } from "../src/index";

test.each([new Error("private"), new TypeError("private"), new RangeError("private"), new SyntaxError("private"), new ReferenceError("private"), new URIError("private"), new EvalError("private"), new AggregateError([], "private")])("unknown exceptions expose only the built-in family: %j", error => {
  const expected = Object.getPrototypeOf(error) === TypeError.prototype ? "TypeError" : error.name;
  const result = toEnvelope("fixture", error, "public-operation");
  expect(result.error.details).toEqual({ stage: "public-operation", errorClass: expected });
  expect(failureIssues(result.error)).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("private");
});

test("custom class names and diagnostic getters are never read", () => {
  let reads = 0;
  class PrivateProviderClass extends TypeError {}
  const error = new PrivateProviderClass();
  for (const key of ["name", "message", "stack"]) Object.defineProperty(error, key, { get() { reads++; throw new Error("private diagnostic"); }, configurable: true });
  const result = toEnvelope("fixture", error, "public-operation");
  expect(reads).toBe(0);
  expect(result.error.details).toEqual({ stage: "public-operation", errorClass: "TypeError" });
  expect(JSON.stringify(result)).not.toContain("PrivateProviderClass");
});

test("non-error throws remain unclassified without copying their content", () => {
  const result = toEnvelope("fixture", { secret: "private" }, "cli");
  expect(result.error.details).toEqual({ stage: "cli", errorClass: "NonError" });
  expect(JSON.stringify(result)).not.toContain("private");
});

test("native error identity handles other realms and rejects forged Error prototypes", () => {
  expect(toEnvelope("fixture", runInNewContext("new Error('private')"), "cli").error.details.errorClass).toBe("Error");
  expect(toEnvelope("fixture", Object.create(Error.prototype), "cli").error.details.errorClass).toBe("NonError");
});
