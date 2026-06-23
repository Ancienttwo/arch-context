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
  const structuralItems = [
    ...(input.symbols ?? []).map((subject) => ({ subject, kind: "symbol" as const })),
    ...(input.files ?? []).map((subject) => ({ subject, kind: "path" as const }))
  ].filter((item) => !isBenignSubject(item.subject));
  const structuralHaystack = structuralItems.map((item) => item.subject).join(" ").toLowerCase();
  const signals: PressureSignal[] = [];
  addHeuristic(/duplicate|same responsibility|copy/.test(taskHaystack), "duplicate-responsibility", "medium");
  addHeuristic(/owner|lifecycle/.test(taskHaystack) && /two|multiple|split/.test(taskHaystack), "multiple-lifecycle-owner", "medium");
  addHeuristic(/wrapper|adapter|mapper|fallback/.test(taskHaystack), "unjustified-wrapper-adapter", "medium");
  // Strong version markers (v1/v2/legacy/deprecated) are genuine dual-track evidence; bare
  // "old"/"new" are English-common and only weak heuristics on their own, so they score low
  // and cannot, alone, push a benign task into medium/high pressure.
  const strongDualTrack = /v1|v2|legacy|deprecated/.test(taskHaystack);
  const weakDualTrack = /\bold\b|\bnew\b/.test(taskHaystack);
  addHeuristic(strongDualTrack || weakDualTrack, "dual-track-business-concept", strongDualTrack ? "medium" : "low");
  addHeuristic(/direct db|cross boundary|payment credential|forbidden data/.test(taskHaystack), "cross-boundary-data-access", "medium");
  addHeuristic(/cycle|hotspot|too many callers/.test(taskHaystack), "cycle-or-hotspot", "medium");
  addHeuristic(/api|contract|schema|event|public/.test(taskHaystack), "contract-after-implementation", "low");
  addHeuristic(/migration|cleanup|remove old|dual path/.test(taskHaystack), "migration-without-target-state", "low");
  addHeuristic(/temporary|cleanup later/.test(taskHaystack), "temporary-state-without-removal", "low");
  addHeuristic(/token|credential|permission|scope|secret|key/.test(taskHaystack), "broad-permission-scope", "low");
  addHeuristic(/dependency|package|lockfile|version/.test(taskHaystack), "unpinned-runtime-dependency", "low");

  addObserved(/wrapper|adapter|mapper|fallback/.test(structuralHaystack), "unjustified-wrapper-adapter", "high", matchingSubjects(structuralItems, /wrapper|adapter|mapper|fallback/i));
  addObserved(/v1|v2|legacy|deprecated/.test(structuralHaystack), "dual-track-business-concept", "high", matchingSubjects(structuralItems, /v1|v2|legacy|deprecated/i));
  addObserved(/duplicate|copy|copied/.test(structuralHaystack), "duplicate-responsibility", "medium", matchingSubjects(structuralItems, /duplicate|copy|copied/i));
  addObserved(/owner|lifecycle/.test(structuralHaystack) && /two|multiple|split/.test([taskHaystack, structuralHaystack].join(" ")), "multiple-lifecycle-owner", "high", matchingSubjects(structuralItems, /owner|lifecycle|module|service/i));
  addObserved(/hotspot|too many callers/.test(structuralHaystack), "cycle-or-hotspot", "medium", matchingSubjects(structuralItems, /hotspot|caller/i));
  addObserved(/boundary|layer|module|domain/.test(structuralHaystack) && hasImportEdge(input.edges), "boundary-crossing-import", "high", edgeSubjects(input.edges, "imports"));
  addObserved(/cycle|circular/.test(structuralHaystack) || hasBidirectionalImport(input.edges), "dependency-cycle", "high", edgeSubjects(input.edges, "imports"));
  addObserved(/direct db|database|credential|payment|forbidden data/.test(structuralHaystack) || hasDataEdge(input.edges), "cross-boundary-data-access", "high", [...matchingSubjects(structuralItems, /db|database|credential|payment|data/i), ...edgeSubjects(input.edges, "reads", "writes")]);
  addObserved(/queue|worker|external|client|server|route/.test(structuralHaystack) && !/telemetry|trace|metric|log/.test(structuralHaystack), "runtime-boundary-without-observability", "medium", matchingSubjects(structuralItems, /queue|worker|external|client|server|route/i));
  addObserved(/adr|decision|policy|contract|architecture/.test(structuralHaystack), "architecture-intervention", "medium", matchingSubjects(structuralItems, /adr|decision|policy|contract|architecture/i));
  addObserved(/owner|team|lifecycle/.test(structuralHaystack), "missing-owner", "medium", matchingSubjects(structuralItems, /owner|team|lifecycle/i));
  if (input.migrationReviewDate && input.now && input.migrationReviewDate < input.now) {
    signals.push({
      type: "overdue-migration-state",
      severity: "high",
      evidence: [input.migrationReviewDate],
      evidenceKind: "observed",
      evidenceDetails: [practiceEvidence("runtime-check", "observed", input.migrationReviewDate)]
    });
  }
  for (const evidence of input.observedEvidence ?? []) {
    if (evidence.confidence === "verified" && /test|verified/i.test(evidence.summary)) {
      addObserved(true, "architecture-intervention", "medium", [evidence.id], evidence.confidence);
    }
  }
  const rawScore = Math.min(100, signals.reduce((sum, signal) => sum + (signal.severity === "high" ? 25 : signal.severity === "medium" ? 15 : 5), 0));
  const heuristicOnly = signals.length > 0 && signals.every((signal) => signal.evidenceKind === "heuristic");
  const score = heuristicOnly ? Math.min(rawScore, 25) : rawScore;
  return { level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", score, signals };

  function addHeuristic(condition: boolean, type: PressureSignalType, severity: Exclude<PressureSignal["severity"], "high">): void {
    if (!condition) return;
    signals.push({ type, severity, evidence: ["task-text"], evidenceKind: "heuristic", evidenceDetails: [practiceEvidence("task-text", "heuristic", input.task)] });
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
  const rawScore = Math.min(100, signals.reduce((sum, signal) => sum + (signal.severity === "high" ? 25 : signal.severity === "medium" ? 15 : 5), 0));
  const heuristicOnly = signals.length > 0 && signals.every((signal) => signal.evidenceKind === "heuristic");
  const score = heuristicOnly ? Math.min(rawScore, 25) : rawScore;
  return { level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", score, signals };
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

function isBenignSubject(subject: string): boolean {
  return /(^|[\s/])(readme|docs?|test|tests|fixtures?)([\s/.]|$)/i.test(subject);
}

function matchingSubjects(items: { subject: string }[], pattern: RegExp): string[] {
  return items.filter((item) => pattern.test(item.subject)).map((item) => item.subject);
}

function hasImportEdge(edges?: NormalizedEdge[]): boolean {
  return (edges ?? []).some((edge) => edge.kind === "imports");
}

function hasDataEdge(edges?: NormalizedEdge[]): boolean {
  return (edges ?? []).some((edge) => edge.kind === "reads" || edge.kind === "writes");
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
