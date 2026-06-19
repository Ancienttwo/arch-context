/**
 * Representative eval runner for the ArchContext kernel.
 *
 * This runner adds NO decision logic. It loads labeled ground-truth datasets
 * (evals/<category>/*.jsonl), feeds them through the SAME engine functions the
 * product ships, scores the outputs, and gates the four statistical targets in
 * PRD §25.3:
 *
 *   1. Unjustified Compatibility detection Recall >= 85%   (policy-engine)
 *   2. Architecture Drift Precision            >= 90%      (pressure-engine + refactor-decision)
 *   3. Context Constraint Recall               >= 95%      (retrieval FTS5 baseline)
 *   4. Context irrelevant-content ratio        <= 20%      (retrieval FTS5 baseline)
 *
 * It also asserts the deterministic target-vs-migration separation invariant
 * (refactor-decision). The six other §25.3 deterministic targets already pass
 * via `bun run verify` and are intentionally NOT re-litigated here.
 *
 * Run:   bun evals/run.ts
 * Gate:  exits non-zero if any statistical target or the invariant is missed.
 *        The report is written either way (a miss is a measured result, not a crash).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateCompatibilityContract, type CompatibilityContractInput } from "../packages/policy-engine/src/index";
import { detectArchitecturePressure } from "../packages/pressure-engine/src/index";
import { computeRefactorConfidence, createInterventionProposal, decidePosture } from "../packages/refactor-decision/src/index";
import {
  Fts5BaselineRetriever,
  runRetrievalEval,
  type RetrievalDocument
} from "../packages/retrieval/src/index";
import type { ArchitecturePosture } from "../packages/architecture-domain/src/index";
import type { RetrievalEvalQuery, RetrievalEvalSet } from "../packages/contracts/src/index";

const DATE = "2026-06-20";

const THRESHOLDS = {
  compatibilityRecall: 0.85,
  driftPrecision: 0.9,
  contextConstraintRecall: 0.95,
  contextIrrelevantRatio: 0.2
} as const;

// Top-k budget tiers exercised for the retrieval (context-budget) eval. The
// shipping default top-k is 3; we sweep a small/medium/large budget and gate on
// the medium tier, which best represents a real task-context budget.
const RETRIEVAL_LIMITS = [3, 5, 8] as const;
const RETRIEVAL_GATE_LIMIT = 5;

function evalPath(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

function loadJsonl<T>(relative: string): T[] {
  const body = readFileSync(evalPath(relative), "utf8");
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid JSONL in ${relative} line ${index + 1}: ${(error as Error).message}`);
      }
    });
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Dataset row shapes (ground truth). `pattern`/`note` are auditing metadata and
// are ignored by the scorer — only the labeled fields drive the metric.
// ---------------------------------------------------------------------------

interface CompatibilityCase {
  id: string;
  shouldFlag: boolean;
  pattern: string;
  note: string;
  contract: CompatibilityContractInput | null;
}

interface DriftCase {
  id: string;
  pattern: string;
  note: string;
  task: string;
  symbols?: string[];
  files?: string[];
  confidence: {
    callerCoverage: number;
    testsAvailable: boolean;
    rollbackAvailable: boolean;
    externalConsumers?: string[];
    persistedData?: string[];
  };
  expectedPosture: ArchitecturePosture;
}

interface TargetMigrationCase {
  id: string;
  note: string;
  task: string;
  confidence: {
    callerCoverage: number;
    testsAvailable: boolean;
    rollbackAvailable: boolean;
    externalConsumers?: string[];
    persistedData?: string[];
  };
}

interface RetrievalQueryCase extends RetrievalEvalQuery {
  note?: string;
}

// ---------------------------------------------------------------------------
// Target 1 — Unjustified Compatibility detection Recall (policy-engine)
// ---------------------------------------------------------------------------

interface CompatibilityResult {
  recall: number;
  specificity: number;
  truePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  falsePositives: number;
  positives: number;
  negatives: number;
  total: number;
  falseNegativeIds: { id: string; pattern: string }[];
  falsePositiveIds: { id: string; pattern: string }[];
}

function scoreCompatibility(cases: CompatibilityCase[]): CompatibilityResult {
  let truePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  const falseNegativeIds: { id: string; pattern: string }[] = [];
  const falsePositiveIds: { id: string; pattern: string }[] = [];

  for (const item of cases) {
    const findings = validateCompatibilityContract(item.contract ?? undefined);
    const flagged = findings.some((finding) => finding.severity === "error");
    if (item.shouldFlag) {
      if (flagged) truePositives += 1;
      else {
        falseNegatives += 1;
        falseNegativeIds.push({ id: item.id, pattern: item.pattern });
      }
    } else {
      if (!flagged) trueNegatives += 1;
      else {
        falsePositives += 1;
        falsePositiveIds.push({ id: item.id, pattern: item.pattern });
      }
    }
  }

  const positives = truePositives + falseNegatives;
  const negatives = trueNegatives + falsePositives;
  return {
    recall: round(truePositives / Math.max(1, positives)),
    specificity: round(trueNegatives / Math.max(1, negatives)),
    truePositives,
    falseNegatives,
    trueNegatives,
    falsePositives,
    positives,
    negatives,
    total: cases.length,
    falseNegativeIds,
    falsePositiveIds
  };
}

// ---------------------------------------------------------------------------
// Target 2 — Architecture Drift Precision (pressure-engine + refactor-decision)
// "Drift detected" == posture !== "normal". Precision = correct drift calls /
// all drift calls. We also report exact-posture accuracy and drift recall so the
// known high-pressure/medium-confidence gap surfaces as a recall miss, not a
// hidden pass.
// ---------------------------------------------------------------------------

interface DriftResult {
  precision: number;
  recall: number;
  exactAccuracy: number;
  driftTruePositives: number;
  driftFalsePositives: number;
  driftFalseNegatives: number;
  driftTrueNegatives: number;
  exactMatches: number;
  total: number;
  falsePositiveIds: { id: string; pattern: string; expected: string; actual: string }[];
  falseNegativeIds: { id: string; pattern: string; expected: string; actual: string }[];
}

function scoreDrift(cases: DriftCase[]): DriftResult {
  let driftTruePositives = 0;
  let driftFalsePositives = 0;
  let driftFalseNegatives = 0;
  let driftTrueNegatives = 0;
  let exactMatches = 0;
  const falsePositiveIds: DriftResult["falsePositiveIds"] = [];
  const falseNegativeIds: DriftResult["falseNegativeIds"] = [];

  for (const item of cases) {
    const pressure = detectArchitecturePressure({ task: item.task, symbols: item.symbols, files: item.files });
    const confidence = computeRefactorConfidence(item.confidence);
    const actual = decidePosture(pressure, confidence);
    if (actual === item.expectedPosture) exactMatches += 1;

    const actualDrift = actual !== "normal";
    const expectedDrift = item.expectedPosture !== "normal";
    if (actualDrift && expectedDrift) driftTruePositives += 1;
    else if (actualDrift && !expectedDrift) {
      driftFalsePositives += 1;
      falsePositiveIds.push({ id: item.id, pattern: item.pattern, expected: item.expectedPosture, actual });
    } else if (!actualDrift && expectedDrift) {
      driftFalseNegatives += 1;
      falseNegativeIds.push({ id: item.id, pattern: item.pattern, expected: item.expectedPosture, actual });
    } else {
      driftTrueNegatives += 1;
    }
  }

  return {
    precision: round(driftTruePositives / Math.max(1, driftTruePositives + driftFalsePositives)),
    recall: round(driftTruePositives / Math.max(1, driftTruePositives + driftFalseNegatives)),
    exactAccuracy: round(exactMatches / Math.max(1, cases.length)),
    driftTruePositives,
    driftFalsePositives,
    driftFalseNegatives,
    driftTrueNegatives,
    exactMatches,
    total: cases.length,
    falsePositiveIds,
    falseNegativeIds
  };
}

// ---------------------------------------------------------------------------
// Invariant — target state never contains migration-only relations
// (refactor-decision.createInterventionProposal)
// ---------------------------------------------------------------------------

interface InvariantResult {
  pass: boolean;
  passed: number;
  total: number;
  violations: { id: string; reason: string }[];
}

function scoreTargetMigration(cases: TargetMigrationCase[]): InvariantResult {
  let passed = 0;
  const violations: { id: string; reason: string }[] = [];

  for (const item of cases) {
    const pressure = detectArchitecturePressure({ task: item.task });
    const confidence = computeRefactorConfidence(item.confidence);
    const proposal = createInterventionProposal({ task: item.task, pressure, confidence });
    const temporary = new Set(proposal.migrationState.temporaryRelations);
    const leaked = proposal.targetState.requiredRelations.filter((relation) => temporary.has(relation));
    const hasRemoved = proposal.targetState.removedConcepts.length > 0;
    const hasTemporary = proposal.migrationState.temporaryRelations.length > 0;

    if (leaked.length === 0 && hasRemoved && hasTemporary) {
      passed += 1;
    } else if (leaked.length > 0) {
      violations.push({ id: item.id, reason: `migration relation leaked into target state: ${leaked.join(", ")}` });
    } else if (!hasRemoved) {
      violations.push({ id: item.id, reason: "target state declared no removed concepts" });
    } else {
      violations.push({ id: item.id, reason: "migration state declared no temporary relations" });
    }
  }

  return { pass: violations.length === 0, passed, total: cases.length, violations };
}

// ---------------------------------------------------------------------------
// Targets 3 & 4 — Context Constraint Recall + irrelevant ratio (retrieval FTS5)
// ---------------------------------------------------------------------------

interface RetrievalTier {
  limit: number;
  contextRecall: number;
  constraintRecall: number;
  irrelevantRatio: number;
}

interface RetrievalResult {
  gateLimit: number;
  constraintRecall: number;
  irrelevantRatio: number;
  contextRecall: number;
  tiers: RetrievalTier[];
  queries: number;
  documents: number;
  missedConstraintQueries: { id: string; expected: string[] }[];
}

function scoreRetrieval(queries: RetrievalQueryCase[], documents: RetrievalDocument[]): RetrievalResult {
  const evalSet: RetrievalEvalSet = {
    schemaVersion: "archcontext.retrieval-eval/v1",
    id: "eval.archctx-m6.context-budget.v1",
    seed: 42,
    queries: queries.map((query) => ({
      id: query.id,
      text: query.text,
      expectedContextIds: query.expectedContextIds,
      expectedConstraintIds: query.expectedConstraintIds,
      prohibitedContextIds: query.prohibitedContextIds
    }))
  };

  const tiers: RetrievalTier[] = RETRIEVAL_LIMITS.map((limit) => {
    const report = runRetrievalEval({ evalSet, documents, retriever: new Fts5BaselineRetriever(), limit });
    return {
      limit,
      contextRecall: report.score.contextRecall,
      constraintRecall: report.score.constraintRecall,
      irrelevantRatio: report.score.irrelevantRatio
    };
  });

  const gate = tiers.find((tier) => tier.limit === RETRIEVAL_GATE_LIMIT) ?? tiers[0];

  // Re-run at the gate limit to attribute per-query constraint misses.
  const gateReport = runRetrievalEval({ evalSet, documents, retriever: new Fts5BaselineRetriever(), limit: gate.limit });
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const missedConstraintQueries: { id: string; expected: string[] }[] = [];
  for (const result of gateReport.queryResults) {
    const hitConstraints = new Set(result.hits.flatMap((hit) => documentById.get(hit.id)?.constraintIds ?? []));
    const missed = result.expectedConstraintIds.filter((id) => !hitConstraints.has(id));
    if (missed.length > 0) missedConstraintQueries.push({ id: result.queryId, expected: missed });
  }

  return {
    gateLimit: gate.limit,
    constraintRecall: gate.constraintRecall,
    irrelevantRatio: gate.irrelevantRatio,
    contextRecall: gate.contextRecall,
    tiers,
    queries: queries.length,
    documents: documents.length,
    missedConstraintQueries
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface GateRow {
  target: string;
  metric: string;
  threshold: string;
  observed: string;
  pass: boolean;
}

function buildReport(input: {
  compatibility: CompatibilityResult;
  drift: DriftResult;
  retrieval: RetrievalResult;
  invariant: InvariantResult;
  gates: GateRow[];
  allPass: boolean;
}): string {
  const { compatibility, drift, retrieval, invariant, gates, allPass } = input;
  const verdict = allPass ? "PASS" : "FAIL (measured gap)";

  const gateTable = [
    "| Target (§25.3) | Metric | Threshold | Observed | Result |",
    "|---|---|---:|---:|:--:|",
    ...gates.map((row) => `| ${row.target} | ${row.metric} | ${row.threshold} | ${row.observed} | ${row.pass ? "✅ PASS" : "❌ FAIL"} |`)
  ].join("\n");

  const tierTable = [
    "| Top-k budget | Context recall | Constraint recall | Irrelevant ratio |",
    "|---:|---:|---:|---:|",
    ...retrieval.tiers.map(
      (tier) => `| ${tier.limit}${tier.limit === retrieval.gateLimit ? " (gate)" : ""} | ${pct(tier.contextRecall)} | ${pct(tier.constraintRecall)} | ${pct(tier.irrelevantRatio)} |`
    )
  ].join("\n");

  const compatFn = compatibility.falseNegativeIds.length
    ? compatibility.falseNegativeIds.map((item) => `\`${item.id}\` (${item.pattern})`).join(", ")
    : "none";
  const compatFp = compatibility.falsePositiveIds.length
    ? compatibility.falsePositiveIds.map((item) => `\`${item.id}\` (${item.pattern})`).join(", ")
    : "none";
  const driftFp = drift.falsePositiveIds.length
    ? drift.falsePositiveIds.map((item) => `\`${item.id}\` (${item.pattern}: expected ${item.expected}, got ${item.actual})`).join(", ")
    : "none";
  const driftFn = drift.falseNegativeIds.length
    ? drift.falseNegativeIds.map((item) => `\`${item.id}\` (${item.pattern}: expected ${item.expected}, got ${item.actual})`).join(", ")
    : "none";

  const backlog: string[] = [];
  if (compatibility.recall < THRESHOLDS.compatibilityRecall) {
    backlog.push(
      `- **Compatibility recall ${pct(compatibility.recall)} < ${pct(THRESHOLDS.compatibilityRecall)}.** ` +
        "`validateCompatibilityContract` only catches unjustified shims via missing governance fields or a 5-phrase reason blacklist. " +
        "Representative shims with full governance fields but a non-durable free-text reason slip through. " +
        "Fix: classify reason durability (external contract / persisted-data / rollout / time-boxed) beyond the literal blacklist."
    );
  }
  if (drift.precision < THRESHOLDS.driftPrecision) {
    backlog.push(
      `- **Drift precision ${pct(drift.precision)} < ${pct(THRESHOLDS.driftPrecision)}.** ` +
        "`detectArchitecturePressure` over-fires on broad keywords (`/v1|v2|legacy|old|new/`, `/wrapper|adapter|mapper|fallback/`) so benign tasks containing those tokens are labeled drift. " +
        "Fix: require corroborating structural evidence (symbols/edges) before a high-severity signal, not task-text keywords alone."
    );
  }
  if (retrieval.constraintRecall < THRESHOLDS.contextConstraintRecall) {
    backlog.push(
      `- **Context constraint recall ${pct(retrieval.constraintRecall)} < ${pct(THRESHOLDS.contextConstraintRecall)}** at top-k ${retrieval.gateLimit}. ` +
        "The FTS5 lexical baseline misses constraints whose query uses paraphrases/synonyms absent from the document text. " +
        "Fix: expand document surface text / synonyms, or revisit the ADR-0033 embedding decision gate with this representative set."
    );
  }
  if (retrieval.irrelevantRatio > THRESHOLDS.contextIrrelevantRatio) {
    backlog.push(
      `- **Context irrelevant ratio ${pct(retrieval.irrelevantRatio)} > ${pct(THRESHOLDS.contextIrrelevantRatio)}** at top-k ${retrieval.gateLimit}. ` +
        "Prohibited documents that share surface tokens with the query are surfaced. " +
        "Fix: penalize known anti-pattern documents or tighten the top-k under budget pressure."
    );
  }
  if (!invariant.pass) {
    backlog.push(
      `- **Target/migration separation invariant violated** in ${invariant.violations.length} case(s): ` +
        invariant.violations.map((violation) => `\`${violation.id}\` (${violation.reason})`).join(", ")
    );
  }

  return `# M6 Representative Eval Report

Date: ${DATE}
Generated by: \`bun evals/run.ts\` (regenerate to refresh)

## Verdict

**${verdict}**

This eval converts the four PRD §25.3 statistical targets from assertions into measured facts on representative, labeled datasets. It runs the **shipping engine exports** — it contains no decision logic of its own — so the numbers below describe the kernel the product actually ships.

${gateTable}

The deterministic target-vs-migration separation invariant: **${invariant.pass ? "✅ HOLD" : "❌ VIOLATED"}** (${invariant.passed}/${invariant.total}).

## Methodology

| Target | Engine under test | Dataset |
|---|---|---|
| Unjustified Compatibility Recall | \`policy-engine.validateCompatibilityContract\` | \`evals/compatibility-debt/cases.jsonl\` |
| Architecture Drift Precision | \`pressure-engine.detectArchitecturePressure\` + \`refactor-decision.decidePosture\` | \`evals/refactor-or-patch/cases.jsonl\` |
| Context Constraint Recall | \`retrieval.runRetrievalEval\` (\`Fts5BaselineRetriever\`) | \`evals/context-budget/{cases,documents}.jsonl\` |
| Context irrelevant ratio | \`retrieval.runRetrievalEval\` (\`Fts5BaselineRetriever\`) | \`evals/context-budget/{cases,documents}.jsonl\` |
| Target/migration invariant | \`refactor-decision.createInterventionProposal\` | \`evals/target-vs-migration/cases.jsonl\` |

### Correction vs. the original plan

The follow-up plan proposed measuring constraint recall and irrelevant ratio from **\`context-compiler\` output**. Reading the shipping code shows that is the wrong surface: \`compileTaskContext\` hardcodes \`constraints: []\` and performs no relevance ranking — it is a byte-budget trimmer over whatever the code-facts adapter returns. The real measurement surface for these two §25.3 metrics is the **\`retrieval\` engine** (\`runRetrievalEval\`), added by the Sprint 4 retrieval eval gate, which retrieves constraint-tagged documents and scores \`constraintRecall\`/\`irrelevantRatio\` directly. This eval therefore measures the retrieval engine's **shipping FTS5 baseline** (embedding stays default-off per ADR-0033). The pre-existing retrieval test only asserted \`contextRecall ≥ 0.8\` on a 3-query set; the §25.3 thresholds had never been gated on a representative set until now.

The six other §25.3 targets (schema precision, stale interception, path-escape, changeset atomic recovery, attestation replay, SaaS code-route count) are deterministic and already pass via \`bun run verify\`; they are intentionally out of scope here.

## Target 1 — Unjustified Compatibility detection Recall

- Recall (should-flag caught): **${pct(compatibility.recall)}** (${compatibility.truePositives}/${compatibility.positives}), threshold ${pct(THRESHOLDS.compatibilityRecall)}.
- Specificity (legitimate contracts correctly passed): **${pct(compatibility.specificity)}** (${compatibility.trueNegatives}/${compatibility.negatives}).
- Dataset: ${compatibility.total} labeled cases.
- False negatives (unjustified shims missed): ${compatFn}.
- False positives (legitimate contracts wrongly flagged): ${compatFp}.

## Target 2 — Architecture Drift Precision

- Drift precision (non-normal posture correctness): **${pct(drift.precision)}** (${drift.driftTruePositives}/${drift.driftTruePositives + drift.driftFalsePositives}), threshold ${pct(THRESHOLDS.driftPrecision)}.
- Drift recall (genuine drift detected): ${pct(drift.recall)} (${drift.driftTruePositives}/${drift.driftTruePositives + drift.driftFalseNegatives}).
- Exact posture accuracy: ${pct(drift.exactAccuracy)} (${drift.exactMatches}/${drift.total}).
- False positives (engine over-flagged drift): ${driftFp}.
- False negatives (engine missed drift, incl. high-pressure/medium-confidence gap): ${driftFn}.

## Targets 3 & 4 — Context Constraint Recall + irrelevant ratio

- Corpus: ${retrieval.documents} constraint-tagged documents, ${retrieval.queries} queries.
- Gate at top-k ${retrieval.gateLimit}: constraint recall **${pct(retrieval.constraintRecall)}** (threshold ${pct(THRESHOLDS.contextConstraintRecall)}), irrelevant ratio **${pct(retrieval.irrelevantRatio)}** (threshold ≤ ${pct(THRESHOLDS.contextIrrelevantRatio)}), context recall ${pct(retrieval.contextRecall)}.
- Budget sweep:

${tierTable}

${retrieval.missedConstraintQueries.length ? `- Queries missing expected constraints at gate top-k: ${retrieval.missedConstraintQueries.map((query) => `\`${query.id}\` (${query.expected.join(", ")})`).join(", ")}.` : "- No expected constraints were missed at the gate top-k."}

## Prioritized engine-fix backlog

${backlog.length ? backlog.join("\n") : "_None — all statistical targets met and the invariant holds._"}

## Boundary

This is a repo-local deterministic eval over hand-labeled representative datasets. It does not prove production launch readiness, hosted CI, or external audit. Dataset labels carry a \`pattern\`/\`note\` field for auditability; the scorer uses only the labeled ground-truth fields.
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const compatibilityCases = loadJsonl<CompatibilityCase>("./compatibility-debt/cases.jsonl");
  const driftCases = loadJsonl<DriftCase>("./refactor-or-patch/cases.jsonl");
  const targetMigrationCases = loadJsonl<TargetMigrationCase>("./target-vs-migration/cases.jsonl");
  const retrievalQueries = loadJsonl<RetrievalQueryCase>("./context-budget/cases.jsonl");
  const retrievalDocuments = loadJsonl<RetrievalDocument>("./context-budget/documents.jsonl");

  const compatibility = scoreCompatibility(compatibilityCases);
  const drift = scoreDrift(driftCases);
  const invariant = scoreTargetMigration(targetMigrationCases);
  const retrieval = scoreRetrieval(retrievalQueries, retrievalDocuments);

  const gates: GateRow[] = [
    {
      target: "Unjustified Compatibility Recall",
      metric: "recall",
      threshold: `≥ ${pct(THRESHOLDS.compatibilityRecall)}`,
      observed: pct(compatibility.recall),
      pass: compatibility.recall >= THRESHOLDS.compatibilityRecall
    },
    {
      target: "Architecture Drift Precision",
      metric: "precision",
      threshold: `≥ ${pct(THRESHOLDS.driftPrecision)}`,
      observed: pct(drift.precision),
      pass: drift.precision >= THRESHOLDS.driftPrecision
    },
    {
      target: "Context Constraint Recall",
      metric: `recall @ top-k ${retrieval.gateLimit}`,
      threshold: `≥ ${pct(THRESHOLDS.contextConstraintRecall)}`,
      observed: pct(retrieval.constraintRecall),
      pass: retrieval.constraintRecall >= THRESHOLDS.contextConstraintRecall
    },
    {
      target: "Context irrelevant ratio",
      metric: `ratio @ top-k ${retrieval.gateLimit}`,
      threshold: `≤ ${pct(THRESHOLDS.contextIrrelevantRatio)}`,
      observed: pct(retrieval.irrelevantRatio),
      pass: retrieval.irrelevantRatio <= THRESHOLDS.contextIrrelevantRatio
    }
  ];

  const statisticalPass = gates.every((gate) => gate.pass);
  const allPass = statisticalPass && invariant.pass;

  // `--check` (used by `bun run verify`) gates the §25.3 targets WITHOUT rewriting
  // the report, keeping the verify path read-only — consistent with the repo's
  // other readback gates. The report is (re)generated on demand by `bun run eval`.
  const checkOnly = process.argv.includes("--check");
  const report = buildReport({ compatibility, drift, retrieval, invariant, gates, allPass });
  const reportPath = fileURLToPath(new URL("../docs/verification/m6-representative-eval-report.md", import.meta.url));
  if (!checkOnly) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, report, "utf8");
  }

  // Console summary.
  console.log("ArchContext representative eval (PRD §25.3 statistical targets)\n");
  for (const gate of gates) {
    console.log(`  ${gate.pass ? "PASS" : "FAIL"}  ${gate.target}: ${gate.observed} (threshold ${gate.threshold})`);
  }
  console.log(`  ${invariant.pass ? "PASS" : "FAIL"}  Target/migration separation invariant: ${invariant.passed}/${invariant.total}`);
  console.log(`\nDatasets: compatibility=${compatibility.total}, drift=${drift.total}, target-migration=${invariant.total}, retrieval=${retrieval.queries} queries / ${retrieval.documents} docs`);
  if (!checkOnly) console.log(`Report: docs/verification/m6-representative-eval-report.md`);
  console.log(`\nVerdict: ${allPass ? "PASS — all §25.3 statistical targets met" : "FAIL — measured gap (see report backlog)"}`);

  if (!allPass) process.exit(1);
}

main();
