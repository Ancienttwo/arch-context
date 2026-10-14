import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { NativeContextError } from "@archcontext/contracts";
import { assertNativeGitRevision, decodeGitBlobBatch, decodeGitTreeEntries, readOnlyGit } from "../src/blob-reader";
const objectId = (body: Buffer, algorithm = "sha1") => createHash(algorithm).update(`blob ${body.length}\0`).update(body).digest("hex");
const oid = objectId(Buffer.from("x"));
const blob = (body: Buffer, oid = objectId(body)) => Buffer.concat([Buffer.from(`${oid} blob ${body.length}\n`), body, Buffer.from("\n")]);
describe("checked Git blob reader", () => {
  test("exact raw bodies, binary newlines and empty blobs round trip in request order", () => {
    const body = Buffer.from("café\r\n\0last\n", "utf8");
    const other = objectId(Buffer.alloc(0), "sha256");
    expect(decodeGitBlobBatch(Buffer.concat([blob(body), blob(Buffer.alloc(0), other)]), [{ objectId: objectId(body), byteLength: body.length }, { objectId: other, byteLength: 0 }])).toEqual([body, Buffer.alloc(0)]);
  });
  test.each([
    ["wrong OID", Buffer.from(`${"b".repeat(40)} blob 1\nx\n`)],
    ["wrong type", Buffer.from(`${oid} tree 1\nx\n`)],
    ["missing", Buffer.from(`${oid} missing\n`)],
    ["missing header", Buffer.from("not terminated")],
    ["short body", Buffer.from(`${oid} blob 8\nx\n`)],
    ["bad terminator", Buffer.from(`${oid} blob 1\nx!`)],
    ["extra response", Buffer.from(`${oid} blob 1\nx\nextra`)]
  ])("refuses %s", (_name, bytes) => { expect(() => decodeGitBlobBatch(bytes, [{ objectId: oid }])).toThrow("native-context-blob-unavailable"); });
  test("recorded size mismatch and unsafe numeric size fail before body use", () => {
    expect(() => decodeGitBlobBatch(blob(Buffer.from("x")), [{ objectId: oid, byteLength: 2 }])).toThrow("native-context-blob-unavailable");
    expect(() => decodeGitBlobBatch(Buffer.from(`${oid} blob 9007199254740992\n`), [{ objectId: oid }])).toThrow("native-context-limit-exceeded");
  });
  test("file, total and protocol bounds are independently enforced", () => {
    const body = blob(Buffer.from("123"));
    const request = { objectId: objectId(Buffer.from("123")) };
    expect(() => decodeGitBlobBatch(body, [request], { fileBytes: 2, inputBytes: 9, responseBytes: 100 })).toThrow("native-context-limit-exceeded");
    expect(() => decodeGitBlobBatch(body, [request], { fileBytes: 9, inputBytes: 2, responseBytes: 100 })).toThrow("native-context-limit-exceeded");
    expect(() => decodeGitBlobBatch(body, [request], { fileBytes: 9, inputBytes: 9, responseBytes: body.length - 1 })).toThrow("native-context-limit-exceeded");
    expect(decodeGitBlobBatch(body, [request], { fileBytes: 3, inputBytes: 3, responseBytes: body.length })[0]!.toString()).toBe("123");
  });
  test("NUL tree records preserve quoted-looking names and SHA-256 object IDs", () => {
    const path = 'src/"café".yaml';
    const entries = decodeGitTreeEntries(Buffer.from(`100644 blob ${"b".repeat(64)} 42\t${path}\0`));
    expect(entries).toEqual([{ mode: "100644", type: "blob", objectId: "b".repeat(64), byteLength: 42, path, utf8Valid: true }]);
  });
  test("invalid UTF-8 names are retained as unsafe evidence instead of erased", () => {
    const entry = decodeGitTreeEntries(Buffer.concat([Buffer.from(`120000 blob ${oid} 1\t.archcontext/model/nodes/`), Buffer.from([0xff]), Buffer.from(".yaml\0")]))[0]!;
    expect(entry.utf8Valid).toBe(false); expect(entry.mode).toBe("120000");
  });
  test.each([Buffer.from(`100644 blob ${oid}\ta.yaml`), Buffer.from("bad\tx\0"), Buffer.from(`100644 blob ${oid}\t\0`)])("malformed tree record cannot become an empty tree", bytes => { expect(() => decodeGitTreeEntries(bytes)).toThrow(); });
  test.each(["", "--output=outside", "-v", "main ref", "a\n", "a\0", "a\x01", "a\x7f"])("unsafe revision %j fails before Git", ref => { expect(() => assertNativeGitRevision(ref)).toThrow("native-context-ref-unsafe"); });
  test("safe commit-ish forms survive the shared lexical guard", () => {
    for (const ref of ["HEAD", "HEAD~1", "v1.2.3", oid, "refs/heads/topic", "a".repeat(64)]) expect(() => assertNativeGitRevision(ref)).not.toThrow();
  });
  test("Git output cap is typed and contains no stderr body", () => {
    try { readOnlyGit(process.cwd(), "rev-parse", ["HEAD"], { maxBytes: 1 }); throw new Error("expected cap failure"); }
    catch (error) { expect(error).toBeInstanceOf(NativeContextError); expect((error as NativeContextError).reasonCode).toBe("native-context-limit-exceeded"); expect((error as NativeContextError).details).not.toHaveProperty("stderr"); }
  });
});
