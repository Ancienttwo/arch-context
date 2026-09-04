import { digestJson, type NormalizedEdge, type ObservedEvidence, type PracticeEvidenceV1 } from "@archcontext/contracts";

export type PressureSignalType =
  | "duplicate-responsibility"
  | "multiple-lifecycle-owner"
  | "unjustified-wrapper-adapter"
  | "dual-track-business-concept"
  | "cross-boundary-data-access"
  | "dependency-cycle"
  | "boundary-crossing-import"
  | "runtime-boundary-without-observability"
  | "architecture-intervention"
  | "boundary-change"
  | "missing-owner"
  | "unbounded-compatibility-path"
  | "contract-after-implementation"
  | "migration-without-target-state"
  | "temporary-state-without-removal"
  | "unpinned-runtime-dependency"
  | "broad-permission-scope"
  | "cross-repo-cycle"
  | "cross-repo-dual-track"
  | "cycle-or-hotspot"
  | "overdue-migration-state";

export interface PressureSignal {
  type: PressureSignalType;
  severity: "low" | "medium" | "high";
  evidence: string[];
  evidenceKind: "observed" | "heuristic";
  evidenceDetails: PracticeEvidenceV1[];
}

export interface ArchitecturePressure {
  level: "low" | "medium" | "high";
  score: number;
  signals: PressureSignal[];
}

export interface PressureInput {
  task: string;
  symbols?: string[];
  files?: string[];
  edges?: NormalizedEdge[];
  observedEvidence?: ObservedEvidence[];
  compatibilityContracts?: string[];
  migrationReviewDate?: string;
  now?: string;
}

export function detectArchitecturePressure(input: PressureInput): ArchitecturePressure {
  const taskHaystack = input.task.toLowerCase();
  const migrationReviewDate = input.migrationReviewDate === undefined ? undefined : requireIsoDate(input.migrationReviewDate, "migrationReviewDate");
  const now = input.now === undefined ? undefined : requireIsoDate(input.now, "now");
  const signals: PressureSignal[] = [];
  addHeuristic(/duplicate|same responsibility|copy/.test(taskHaystack), "duplicate-responsibility");
  addHeuristic(/owner|lifecycle/.test(taskHaystack) && /two|multiple|split/.test(taskHaystack), "multiple-lifecycle-owner");
  addHeuristic(/wrapper|adapter|mapper|fallback/.test(taskHaystack), "unjustified-wrapper-adapter");
  // Task wording is advisory only. It does not establish an architectural fact or contribute to
  // a decision once concrete observed evidence exists.
  const strongDualTrack = /v1|v2|legacy|deprecated/.test(taskHaystack);
  const weakDualTrack = /\bold\b|\bnew\b/.test(taskHaystack);
  addHeuristic(strongDualTrack || weakDualTrack, "dual-track-business-concept");
  addHeuristic(/direct db|cross boundary|payment credential|forbidden data/.test(taskHaystack), "cross-boundary-data-access");
  addHeuristic(/cycle|hotspot|too many callers/.test(taskHaystack), "cycle-or-hotspot");
  addHeuristic(/api|contract|schema|event|public/.test(taskHaystack), "contract-after-implementation");
  addHeuristic(/migration|cleanup|remove old|dual path/.test(taskHaystack), "migration-without-target-state");
  addHeuristic(/temporary|cleanup later/.test(taskHaystack), "temporary-state-without-removal");
  addHeuristic(/token|credential|permission|scope|secret|key/.test(taskHaystack), "broad-permission-scope");
  addHeuristic(/dependency|package|lockfile|version/.test(taskHaystack), "unpinned-runtime-dependency");

  addObserved(hasBidirectionalImport(input.edges), "dependency-cycle", "high", edgeSubjects(input.edges, "imports"));
  if (migrationReviewDate && now && migrationReviewDate < now) {
    signals.push({
      type: "overdue-migration-state",
      severity: "high",
      evidence: [migrationReviewDate],
      evidenceKind: "observed",
      evidenceDetails: [practiceEvidence("runtime-check", "observed", migrationReviewDate)]
    });
  }
  const score = scorePressureSignals(signals);
  return { level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", score, signals };

  function addHeuristic(condition: boolean, type: PressureSignalType): void {
    if (!condition) return;
    signals.push({ type, severity: "low", evidence: ["task-text"], evidenceKind: "heuristic", evidenceDetails: [practiceEvidence("task-text", "heuristic", input.task)] });
  }

  function addObserved(
    condition: boolean,
    type: PressureSignalType,
    severity: PressureSignal["severity"],
    evidence: string[],
    strength: "observed" | "verified" = "observed"
  ): void {
    if (!condition) return;
    const subjects = evidence.length > 0 ? evidence : ["code-context"];
    signals.push({
      type,
      severity,
      evidence: subjects,
      evidenceKind: "observed",
      evidenceDetails: subjects.map((subject) => practiceEvidence(subject.includes("->") ? "import-edge" : "symbol", strength, subject))
    });
  }
}

export function detectCrossRepoPressure(input: {
  relations: { source: { repositoryId: string }; target: { repositoryId: string }; id: string }[];
  task?: string;
}): ArchitecturePressure {
  const signals: PressureSignal[] = [];
  const edges = new Set(input.relations.map((relation) => `${relation.source.repositoryId}->${relation.target.repositoryId}`));
  for (const relation of input.relations) {
    if (edges.has(`${relation.target.repositoryId}->${relation.source.repositoryId}`)) {
      signals.push({
        type: "cross-repo-cycle",
        severity: "high",
        evidence: [relation.id],
        evidenceKind: "observed",
        evidenceDetails: [practiceEvidence("import-edge", "observed", relation.id)]
      });
      break;
    }
  }
  if (/v1|v2|legacy|old|new/i.test(input.task ?? "")) {
    signals.push({
      type: "cross-repo-dual-track",
      severity: "medium",
      evidence: ["task-text"],
      evidenceKind: "heuristic",
      evidenceDetails: [practiceEvidence("task-text", "heuristic", input.task ?? "")]
    });
  }
  const score = scorePressureSignals(signals);
  return { level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", score, signals };
}

function scorePressureSignals(signals: PressureSignal[]): number {
  const observedSignals = signals.filter((signal) => signal.evidenceKind === "observed");
  const scoredSignals = observedSignals.length > 0 ? observedSignals : signals;
  const rawScore = Math.min(100, scoredSignals.reduce((sum, signal) => sum + (signal.severity === "high" ? 25 : signal.severity === "medium" ? 15 : 5), 0));
  return observedSignals.length === 0 ? Math.min(rawScore, 25) : rawScore;
}

function practiceEvidence(kind: PracticeEvidenceV1["kind"], strength: PracticeEvidenceV1["strength"], subject: string): PracticeEvidenceV1 {
  return {
    kind,
    strength,
    subject,
    digest: digestJson({ kind, strength, subject }),
    observedAt: "1970-01-01T00:00:00.000Z"
  };
}

function requireIsoDate(value: string, field: "migrationReviewDate" | "now"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${field}: expected a valid YYYY-MM-DD date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${field}: expected a valid YYYY-MM-DD date`);
  }
  return value;
}

function hasBidirectionalImport(edges?: NormalizedEdge[]): boolean {
  const imports = new Set((edges ?? []).filter((edge) => edge.kind === "imports").map((edge) => `${edge.source}->${edge.target}`));
  return [...imports].some((edge) => {
    const [source, target] = edge.split("->");
    return imports.has(`${target}->${source}`);
  });
}

function edgeSubjects(edges: NormalizedEdge[] | undefined, ...kinds: NormalizedEdge["kind"][]): string[] {
  return (edges ?? []).filter((edge) => kinds.includes(edge.kind)).map((edge) => `${edge.source}->${edge.target}`);
}
