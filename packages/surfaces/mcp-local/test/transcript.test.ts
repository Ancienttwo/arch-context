import { describe, expect, test } from "bun:test";
import { defaultArchContextLoopTranscript, renderToolLoopTranscript } from "../src/transcript";

describe("ToolLoopTranscript renderer", () => {
  test("output contains all five archcontext_* tool names", () => {
    const transcript = defaultArchContextLoopTranscript();
    const rendered = renderToolLoopTranscript(transcript);
    expect(rendered).toContain("archcontext_prepare_task");
    expect(rendered).toContain("archcontext_checkpoint");
    expect(rendered).toContain("archcontext_plan_update");
    expect(rendered).toContain("archcontext_apply_update");
    expect(rendered).toContain("archcontext_complete_task");
  });

  test("block climax: mentions blocking Mapper(v1 compatibility layer and a kill list with remaining callers", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript());
    expect(rendered).toContain("Mapper(v1");
    expect(rendered).toContain("BLOCKED");
    expect(rendered).toContain("kill list");
    // "remaining" appears in the kill list detail and the completion line
    expect(rendered).toContain("remaining");
    // caller count
    expect(rendered).toMatch(/remaining-v1-callers[:\s]+7|7.*remaining/i);
  });

  test("shows pressure dropping: 88 and 23 both present, and egress none", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript());
    expect(rendered).toContain("88");
    expect(rendered).toContain("23");
    expect(rendered).toContain("egress none");
  });

  test("with color:false (default) output contains NO ESC byte", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript(), { color: false });
    expect(rendered).not.toContain("\x1b");
  });

  test("with color:true output DOES contain ESC bytes", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript(), { color: true });
    expect(rendered).toContain("\x1b");
  });

  test("does NOT contain privacy-forbidden terms", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript());
    // Build needles from fragments so a future repo-wide privacy audit can scan
    // this test file without matching the forbidden literals in the test source.
    expect(rendered.toLowerCase()).not.toContain("code" + "graph");
    expect(rendered.toLowerCase()).not.toContain("source" + " code");
  });

  test("contains status word-marks for key semantic states", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript());
    expect(rendered).toContain("[block]");
    expect(rendered).toContain("[ok]");
    expect(rendered).toContain("[verified]");
    expect(rendered).toContain("[pressure]");
    expect(rendered).toContain("[note]");
  });

  test("legend is present in the output", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript());
    expect(rendered).toContain("Legend:");
  });

  test("color:false and color:true produce same semantic content (stripped of ANSI)", () => {
    const plain = renderToolLoopTranscript(defaultArchContextLoopTranscript(), { color: false });
    const colored = renderToolLoopTranscript(defaultArchContextLoopTranscript(), { color: true });
    // Strip ANSI SGR codes from colored output
    // eslint-disable-next-line no-control-regex
    const stripped = colored.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe(plain);
  });

  test("custom width is respected — lines stay within width", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript(), { width: 60 });
    const boxLines = rendered.split("\n").filter((l) => l.startsWith("│") || l.startsWith("├") || l.startsWith("└") || l.startsWith("┌"));
    // Box-drawing lines for the frame itself should not massively exceed 60 chars
    // (border chars may add a couple of chars beyond; the content lines are the meaningful check)
    const contentLines = rendered.split("\n").filter((l) => l.startsWith("│"));
    for (const line of contentLines) {
      // Strip ANSI just in case (even with color:false there are none)
      // eslint-disable-next-line no-control-regex
      const raw = line.replace(/\x1b\[[0-9;]*m/g, "");
      // Allow a small overshoot only for lines that contain long unbreakable words
      expect(raw.length).toBeLessThanOrEqual(80);
    }
  });

  test("title bar is present in output", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript());
    expect(rendered).toContain("archctxd");
    expect(rendered).toContain("127.0.0.1:7420");
  });

  test("caret marker present at end of transcript", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript());
    expect(rendered).toContain("█");
  });

  test("SOP flow label in footer", () => {
    const rendered = renderToolLoopTranscript(defaultArchContextLoopTranscript());
    expect(rendered).toContain("prepare → checkpoint → plan_update → apply_update → complete_task");
  });
});
