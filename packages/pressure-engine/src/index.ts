export type PressureSignalType =
  | "duplicate-responsibility"
  | "multiple-lifecycle-owner"
  | "unjustified-wrapper-adapter"
  | "dual-track-business-concept"
  | "cross-boundary-data-access"
  | "cross-repo-cycle"
  | "cross-repo-dual-track"
  | "cycle-or-hotspot"
  | "overdue-migration-state";

export interface PressureSignal {
  type: PressureSignalType;
  severity: "low" | "medium" | "high";
  evidence: string[];
  evidenceKind: "observed" | "heuristic";
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
  compatibilityContracts?: string[];
  migrationReviewDate?: string;
  now?: string;
}

export function detectArchitecturePressure(input: PressureInput): ArchitecturePressure {
  const haystack = [input.task, ...(input.symbols ?? []), ...(input.files ?? [])].join(" ").toLowerCase();
  const signals: PressureSignal[] = [];
  addIf(/duplicate|same responsibility|copy/.test(haystack), "duplicate-responsibility", "medium", ["task-text"]);
  addIf(/owner|lifecycle/.test(haystack) && /two|multiple|split/.test(haystack), "multiple-lifecycle-owner", "high", ["task-text"]);
  addIf(/wrapper|adapter|mapper|fallback/.test(haystack), "unjustified-wrapper-adapter", "high", ["task-text"]);
  addIf(/v1|v2|legacy|old|new/.test(haystack), "dual-track-business-concept", "high", ["task-text"]);
  addIf(/direct db|cross boundary|payment credential|forbidden data/.test(haystack), "cross-boundary-data-access", "high", ["task-text"]);
  addIf(/cycle|hotspot|too many callers/.test(haystack), "cycle-or-hotspot", "medium", ["task-text"]);
  if (input.migrationReviewDate && input.now && input.migrationReviewDate < input.now) {
    signals.push({
      type: "overdue-migration-state",
      severity: "high",
      evidence: [input.migrationReviewDate],
      evidenceKind: "observed"
    });
  }
  const score = Math.min(100, signals.reduce((sum, signal) => sum + (signal.severity === "high" ? 25 : signal.severity === "medium" ? 15 : 5), 0));
  return { level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", score, signals };

  function addIf(condition: boolean, type: PressureSignalType, severity: PressureSignal["severity"], evidence: string[]): void {
    if (!condition) return;
    signals.push({ type, severity, evidence, evidenceKind: evidence[0] === "task-text" ? "heuristic" : "observed" });
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
        evidenceKind: "observed"
      });
      break;
    }
  }
  if (/v1|v2|legacy|old|new/i.test(input.task ?? "")) {
    signals.push({
      type: "cross-repo-dual-track",
      severity: "high",
      evidence: ["task-text"],
      evidenceKind: "heuristic"
    });
  }
  const score = Math.min(100, signals.reduce((sum, signal) => sum + (signal.severity === "high" ? 25 : 15), 0));
  return { level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", score, signals };
}
