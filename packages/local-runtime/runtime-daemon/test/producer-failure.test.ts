import { expect, test } from "bun:test";
import { selectedProducerFailureEnvelope } from "../src/producer-failure";

test("a changing native error prototype cannot escape the selected failure adapter", () => {
  let probes = 0;
  const error = new Error("private source");
  Object.setPrototypeOf(error, new Proxy({}, { getPrototypeOf() {
    if (++probes >= 5) throw new Error("private metadata probe");
    return Error.prototype;
  } }));
  const result = selectedProducerFailureEnvelope("fixture", error, "docs-anchors");
  expect(result).toMatchObject({ ok: false, error: { code: "AC_UNCLASSIFIED_FAILURE", reasonCode: "failure-unclassified", details: { stage: "failure-metadata" } } });
  expect(JSON.stringify(result)).not.toContain("private");
});
