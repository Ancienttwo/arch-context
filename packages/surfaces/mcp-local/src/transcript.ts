/**
 * Terminal transcript renderer for the ArchContext MCP tool-loop surface.
 *
 * Data model:
 *
 *   ToolLoopStep
 *     tool     — one of the five archcontext_* tool names
 *     arg      — short arg/phase label shown on the prompt line (e.g. 'task: "unify …"')
 *     lines    — ordered output lines produced by the tool call
 *
 *   ToolLoopLine
 *     kind     — semantic kind: "out" | "ok" | "warn" | "block" | "verify" | "note"
 *     text     — display text (no emoji, no ESC codes stored here)
 *     detail?  — optional key/value pairs rendered as indented sub-lines
 *
 *   ToolLoopTranscript
 *     title    — daemon title string, e.g. 'archctxd · 127.0.0.1:7420 · egress none'
 *     steps    — ordered list of ToolLoopStep (the full SOP loop)
 *
 * Render options:
 *   color    — emit ANSI SGR codes (default: false — test-friendly, deterministic)
 *   width    — wrap column (default: 76)
 *
 * Status is always expressed as a word+mark ([ok], [pressure], [block], [note],
 * [verified]) so the transcript reads unambiguously without color.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolLoopLineKind = "out" | "ok" | "warn" | "block" | "verify" | "note";

export interface ToolLoopLine {
  kind: ToolLoopLineKind;
  text: string;
  /** Optional key/value detail pairs rendered as indented sub-lines. */
  detail?: Array<[string, string]>;
}

export interface ToolLoopStep {
  /** One of the five archcontext_* tool names. */
  tool: string;
  /** Short argument / phase label shown on the prompt line. */
  arg: string;
  lines: ToolLoopLine[];
}

export interface ToolLoopTranscript {
  /** Daemon title bar text, e.g. "archctxd · 127.0.0.1:7420 · egress none". */
  title: string;
  steps: ToolLoopStep[];
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const SGR = {
  green: "\x1b[32m",
  amber: "\x1b[33m",
  brick: "\x1b[31m",
  slate: "\x1b[90m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
} as const;

type AnsiKey = keyof typeof SGR;

function ansi(color: boolean, key: AnsiKey, text: string): string {
  if (!color) return text;
  return `${SGR[key]}${text}${SGR.reset}`;
}

// ---------------------------------------------------------------------------
// Kind → mark + color
// ---------------------------------------------------------------------------

const KIND_MARK: Record<ToolLoopLineKind, string> = {
  out: "    ",
  ok: "[ok]",
  warn: "[pressure]",
  block: "[block]",
  verify: "[verified]",
  note: "[note]",
};

const KIND_COLOR: Record<ToolLoopLineKind, AnsiKey | null> = {
  out: null,
  ok: "green",
  warn: "amber",
  block: "brick",
  verify: "green",
  note: "slate",
};

// ---------------------------------------------------------------------------
// Word-wrap
// ---------------------------------------------------------------------------

function wrap(text: string, width: number, indent: string): string[] {
  const effective = width - indent.length;
  if (effective <= 0 || text.length <= effective) return [indent + text];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > effective && current) {
      lines.push(indent + current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(indent + current);
  return lines;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export interface RenderOptions {
  color?: boolean;
  width?: number;
}

export function renderToolLoopTranscript(
  transcript: ToolLoopTranscript,
  opts: RenderOptions = {}
): string {
  const color = opts.color ?? false;
  const width = opts.width ?? 76;

  const out: string[] = [];

  // ── Title bar ──────────────────────────────────────────────────────────
  const bullets = color
    ? `${SGR.brick}●${SGR.reset} ${SGR.amber}●${SGR.reset} ${SGR.green}●${SGR.reset}`
    : "● ● ●";
  const titleText = ansi(color, "slate", transcript.title);
  out.push(`┌${"─".repeat(width - 2)}┐`);
  out.push(`│ ${bullets}  ${titleText.padEnd(color ? width - 18 : width - 9)} │`.slice(0, width + (color ? 30 : 0)) + (color ? "" : ""));
  // Simpler: build without padding arithmetic
  const titleBar = `│ ${bullets}  ${titleText}`;
  out[out.length - 1] = titleBar;
  out.push(`├${"─".repeat(width - 2)}┤`);

  // ── Steps ──────────────────────────────────────────────────────────────
  for (let si = 0; si < transcript.steps.length; si++) {
    const step = transcript.steps[si];
    const isLast = si === transcript.steps.length - 1;

    // prompt line: agent ▸ tool  arg
    const toolLabel = ansi(color, "green", step.tool);
    const argLabel = ansi(color, "slate", step.arg);
    out.push(`│`);
    out.push(`│  ${ansi(color, "slate", "agent ▸")} ${toolLabel}  ${argLabel}`);

    // output lines
    for (let li = 0; li < step.lines.length; li++) {
      const line = step.lines[li];
      const mark = KIND_MARK[line.kind];
      const col = KIND_COLOR[line.kind];
      const isVeryLast = isLast && li === step.lines.length - 1;

      const markStr = col ? ansi(color, col, mark) : mark;
      // Blank pad for continuation lines — same width as the mark, preserving alignment.
      const contPad = " ".repeat(mark.length);

      // word-wrap the text portion
      const prefixLen = 2 + mark.length + 1; // "│  " + mark + " "
      const prefixFirst = `│  ${mark} `;
      const prefixCont  = `│  ${contPad} `;
      const textLines = wrap(line.text, width - prefixLen, "");

      for (let tli = 0; tli < textLines.length; tli++) {
        const raw = textLines[tli];
        const isCaretLine = isVeryLast && tli === textLines.length - 1;
        const caret = isCaretLine ? " █" : "";
        const isFirstLine = tli === 0;
        if (color && col) {
          const linePrefix = isFirstLine ? `│  ${markStr} ` : `│  ${contPad} `;
          out.push(`${linePrefix}${ansi(color, col, raw)}${caret}`);
        } else {
          const linePrefix = isFirstLine ? prefixFirst : prefixCont;
          out.push(`${linePrefix}${raw}${caret}`);
        }
      }

      // detail key/value pairs
      if (line.detail) {
        for (const [k, v] of line.detail) {
          const detailLine = `${k}: ${v}`;
          const detailPrefix = `│      `;
          const detailWrapped = wrap(detailLine, width - 7, "");
          for (const dl of detailWrapped) {
            if (color) {
              out.push(`${detailPrefix}${ansi(color, "slate", dl)}`);
            } else {
              out.push(`${detailPrefix}${dl}`);
            }
          }
        }
      }
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  out.push(`│`);
  const sopLabel = ansi(color, "slate", "prepare → checkpoint → plan_update → apply_update → complete_task");
  out.push(`│  ${sopLabel}`);
  out.push(`└${"─".repeat(width - 2)}┘`);

  // ── Legend ─────────────────────────────────────────────────────────────
  out.push("");
  out.push("Legend:");
  const legendEntries: Array<[string, string]> = [
    ["[ok]", "ok / verified"],
    ["[pressure]", "architecture pressure (amber)"],
    ["[block]", "ArchContext blocked this change (brick)"],
    ["[verified]", "gate passed (green)"],
    ["[note]", "informational (slate)"],
  ];
  for (const [mark, desc] of legendEntries) {
    const markStr = color ? ansi(color, KIND_COLOR[markToKind(mark)]!, mark) : mark;
    out.push(`  ${markStr}  ${desc}`);
  }

  return out.join("\n");
}

/** Map a legend mark string back to its kind for color lookup. */
function markToKind(mark: string): ToolLoopLineKind {
  switch (mark) {
    case "[ok]": return "ok";
    case "[pressure]": return "warn";
    case "[block]": return "block";
    case "[verified]": return "verify";
    case "[note]": return "note";
    default: return "out";
  }
}

// ---------------------------------------------------------------------------
// Canonical SOP-loop demo transcript
// ---------------------------------------------------------------------------

/**
 * Returns the canonical SOP-loop demo data for the ArchContext primary flow:
 *   prepare_task → checkpoint → plan_update (BLOCK) → apply_update → complete_task
 *
 * Callers and tests use this to get the signature scenario without rebuilding it.
 */
export function defaultArchContextLoopTranscript(): ToolLoopTranscript {
  return {
    title: "archctxd · 127.0.0.1:7420 · egress none",
    steps: [
      {
        tool: "archcontext_prepare_task",
        arg: 'task: "unify subscription & payment state"',
        lines: [
          {
            kind: "out",
            text: "compiling architecture context for task...",
          },
          {
            kind: "note",
            text: "repo archctx.repoharness.com · head dccf0a6 · dirty",
            detail: [
              ["context-ids", "module.subscription  module.payment  symbol.SubscriptionManagerV1"],
            ],
          },
          {
            kind: "warn",
            text: "pressure 88/100  signals: duplicate-lifecycle-owner, unjustified-compatibility-path",
          },
          {
            kind: "out",
            text: "confidence 61/100   posture: proof-required",
          },
        ],
      },
      {
        tool: "archcontext_checkpoint",
        arg: "phase: intervention",
        lines: [
          {
            kind: "out",
            text: "worktree digest captured · baseline pressure 88/100",
          },
          {
            kind: "warn",
            text: "two lifecycle owners detected: module.subscription  symbol.SubscriptionManagerV1",
          },
          {
            kind: "ok",
            text: "intervention proposed → structural-refactor (staged)",
          },
          {
            kind: "note",
            text: "thesis: subscription owns subscription state; payment exposes payment facts",
          },
        ],
      },
      {
        tool: "archcontext_plan_update",
        arg: "add permanent Mapper(v1 → v2)",
        lines: [
          {
            kind: "block",
            text: "BLOCKED  unjustified compatibility path — no real contract behind Mapper(v1→v2)",
          },
          {
            kind: "out",
            text: "generated caller-migration plan + kill list instead",
            detail: [
              ["kill-list", "symbol.SubscriptionManagerV1"],
              ["remaining-v1-callers", "7"],
              ["callers", "svc.billing  svc.web  svc.mobile  svc.analytics  svc.admin  svc.export  svc.notify"],
            ],
          },
          {
            kind: "note",
            text: "completion criterion: remaining-v1-callers == 0",
          },
        ],
      },
      {
        tool: "archcontext_apply_update",
        arg: "strategy: staged  approved: true",
        lines: [
          {
            kind: "out",
            text: "approved gate passed · applying caller migration...",
          },
          {
            kind: "out",
            text: "moving cancellation transition into module.subscription...",
          },
          {
            kind: "ok",
            text: "migration  required 7 · completed 6 · remaining 1",
          },
          {
            kind: "note",
            text: "1 external consumer unconfirmed → falsifier queued",
          },
          {
            kind: "warn",
            text: "pressure 88 → 41  migration in progress",
          },
        ],
      },
      {
        tool: "archcontext_complete_task",
        arg: "reconcile + verify",
        lines: [
          {
            kind: "out",
            text: "reconciling model with your code...",
          },
          {
            kind: "ok",
            text: "remaining-v1-callers: 0  kill list resolved",
          },
          {
            kind: "verify",
            text: "VERIFIED  single lifecycle owner · remaining-v1-callers == 0",
          },
          {
            kind: "ok",
            text: "pressure 88 → 23  LOW",
          },
          {
            kind: "note",
            text: "signed review emitted · attestation bound to dccf0a6 · egress none",
          },
        ],
      },
    ],
  };
}
