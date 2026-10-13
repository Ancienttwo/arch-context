import { describe, expect, test } from "bun:test";
import { digestJson, type Json } from "@archcontext/contracts";
import type { ProjectionOwnedFile } from "@archcontext/core/projection-engine";
import { projectionFilesBoundToRenderInput } from "../src/projection-service";

describe("projection write preconditions bind to the render's read", () => {
  test("hash the raw bytes of the read and keep their line endings", () => {
    const read: ProjectionOwnedFile = { path: "docs/a.md", body: "a\nb\n", onDisk: "a\r\nb\r\n" };
    expect(projectionFilesBoundToRenderInput([read], [{ path: "docs/a.md", body: "a\nc\n" }, { path: "docs/new.md", body: "n\n" }])).toEqual([
      { path: "docs/a.md", expectedHash: digestJson({ body: "a\r\nb\r\n" } as unknown as Json), body: "a\r\nc\r\n" },
      { path: "docs/new.md", expectedHash: "missing", body: "n\n" }
    ]);
  });

  test("fails closed when a read file carries no raw bytes", () => {
    const withoutBytes = [{ path: "docs/a.md", body: "a\n" }] as unknown as ProjectionOwnedFile[];
    expect(() => projectionFilesBoundToRenderInput(withoutBytes, [{ path: "docs/a.md", body: "a\n" }]))
      .toThrow("projection render input carries no on-disk bytes: docs/a.md");
  });
});
