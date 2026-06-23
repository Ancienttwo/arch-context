import { digestJson, type Json, type PracticeCheckResultV1, type PracticeCheckV1, type PracticeEnforcementLevel, type PracticeMatchV1 } from "@archcontext/contracts";
import { validateCompatibilityContract, type CompatibilityContractInput } from "@archcontext/core/policy-engine";

export interface PracticeOwnerRegistry {
  owners: string[];
  subjects?: {
    subject: string;
    path: string;
    kind: string;
    lifecycleOwners: string[];
    dataOwners?: string[];
  }[];
}

export interface PracticeCheckRunInput {
  match: PracticeMatchV1;
  check: PracticeCheckV1;
  enforcement: PracticeEnforcementLevel;
  compatibilityContract?: CompatibilityContractInput;
  compatibilityPathIntroduced?: boolean;
  hasBaseline?: boolean;
  previousMatch?: PracticeMatchV1;
  ownerRegistry?: PracticeOwnerRegistry;
}

type RegisteredPracticeCheck = (input: PracticeCheckRunInput) => PracticeCheckResultV1;

const REGISTERED_CHECKS: Record<string, RegisteredPracticeCheck> = {
  "compatibility-contract-required": compatibilityContractRequired,
  "dependency-direction": dependencyDirection,
  "migration-removal-condition": migrationRemovalCondition,
  "migration-review-date": migrationReviewDate,
  "no-new-cycle": noNewCycle,
  "owner-required": ownerRequired
};

const DEPENDENCY_DIRECTION_VIOLATION_PREFIXES = [
  "boundary-violation:",
  "cross-boundary-import:",
  "cross-boundary-import-added:",
  "declared-layer-violation:",
  "declared-layer-violation-observed:",
  "dependency-direction-violation:",
  "layer-violation:"
];

const GOVERNED_OWNER_PREFIXES = [
  "governed:",
  "governed-component:",
  "governed-element:",
  "governed-resource:"
];

const LIFECYCLE_OWNER_PREFIXES = [
  "lifecycle-owner:",
  "lifecycle-owner-declared:",
  "owner:"
];

const MIGRATION_SUBJECT_PREFIXES = [
  "migration:",
  "migration-path:",
  "migration-state:",
  "temporary-state:"
];

const MIGRATION_REVIEW_DATE_PREFIXES = [
  "migration-review-date:",
  "review-date:"
];

const MIGRATION_REMOVAL_CONDITION_PREFIXES = [
  "migration-removal-condition:",
  "removal-condition:",
  "removal-state:"
];

export function isRegisteredPracticeCheck(checkId: string): boolean {
  return checkId in REGISTERED_CHECKS;
}

export function runRegisteredPracticeCheck(input: PracticeCheckRunInput): PracticeCheckResultV1 {
  const check = REGISTERED_CHECKS[input.check.checkId];
  if (!check) {
    return checkResult(input, {
      status: "not_applicable",
      reasonCode: "not-registered",
      subjects: [],
      message: `Practice check is not registered for complete enforcement: ${input.check.checkId}`,
      action: "keep-practice-advisory-until-deterministic-check-exists"
    });
  }
  return check(input);
}

function compatibilityContractRequired(input: PracticeCheckRunInput): PracticeCheckResultV1 {
  const findings = validateCompatibilityContract(input.compatibilityContract);
  const errors = findings.filter((finding) => finding.severity === "error");
  if (errors.length === 0) {
    return checkResult(input, {
      status: "pass",
      reasonCode: "no-violation",
      subjects: ["compatibility-contract"],
      message: "Compatibility contract satisfies deterministic practice requirements.",
      action: "none"
    });
  }
  return checkResult(input, {
    status: "fail",
    reasonCode: "violation",
    subjects: errors.map((finding) => finding.id).sort(),
    message: "Compatibility path is missing a durable contract.",
    action: "add-compatibility-contract-owner-consumers-removal-and-review-date"
  });
}

function noNewCycle(input: PracticeCheckRunInput): PracticeCheckResultV1 {
  if (!input.hasBaseline) {
    return checkResult(input, {
      status: "not_applicable",
      reasonCode: "no-baseline",
      subjects: [],
      message: "No checkpoint baseline is available to distinguish new cycles from historical debt.",
      action: "run-prepare-and-checkpoint-before-complete"
    });
  }
  const previousSubjects = new Set(input.previousMatch ? importCycleSubjects(input.previousMatch) : []);
  const newSubjects = importCycleSubjects(input.match).filter((subject) => !previousSubjects.has(subject));
  if (newSubjects.length === 0) {
    return checkResult(input, {
      status: "pass",
      reasonCode: "no-violation",
      subjects: importCycleSubjects(input.match),
      message: "No new import cycle was introduced since the checkpoint baseline.",
      action: "none"
    });
  }
  return checkResult(input, {
    status: "fail",
    reasonCode: "violation",
    subjects: newSubjects,
    message: "Complete would introduce a new import cycle.",
    action: "remove-new-import-cycle-or-add-a-more-specific-boundary"
  });
}

function dependencyDirection(input: PracticeCheckRunInput): PracticeCheckResultV1 {
  const currentSubjects = dependencyDirectionViolationSubjects(input.match);
  if (currentSubjects.length === 0) {
    return checkResult(input, {
      status: "not_applicable",
      reasonCode: "no-violation",
      subjects: [],
      message: "No explicit layer or boundary profile violation evidence is available.",
      action: "declare-layer-boundary-profile-before-complete-enforcement"
    });
  }
  if (!input.hasBaseline) {
    return checkResult(input, {
      status: "not_applicable",
      reasonCode: "no-baseline",
      subjects: [],
      message: "No checkpoint baseline is available to distinguish new dependency-direction violations from historical debt.",
      action: "run-prepare-and-checkpoint-before-complete"
    });
  }
  const previousSubjects = new Set(input.previousMatch ? dependencyDirectionViolationSubjects(input.previousMatch) : []);
  const newSubjects = currentSubjects.filter((subject) => !previousSubjects.has(subject));
  if (newSubjects.length === 0) {
    return checkResult(input, {
      status: "pass",
      reasonCode: "no-violation",
      subjects: currentSubjects,
      message: "No new dependency-direction violation was introduced since the checkpoint baseline.",
      action: "none"
    });
  }
  return checkResult(input, {
    status: "fail",
    reasonCode: "violation",
    subjects: newSubjects,
    message: "Complete would introduce a new dependency-direction violation.",
    action: "move-import-behind-declared-boundary-or-add-explicit-boundary-contract"
  });
}

function ownerRequired(input: PracticeCheckRunInput): PracticeCheckResultV1 {
  const subjects = ownerGovernedSubjects(input.match, input.ownerRegistry);
  if (subjects.length === 0) {
    return checkResult(input, {
      status: "not_applicable",
      reasonCode: "no-violation",
      subjects: [],
      message: "No explicitly governed component or resource ownership evidence is available.",
      action: "declare-governed-component-before-owner-required-enforcement"
    });
  }
  const ownerDeclarations = lifecycleOwnerDeclarations(input.match, input.ownerRegistry);
  const knownOwners = new Set(input.ownerRegistry?.owners ?? []);
  const violations = subjects.filter((subject) => {
    const owners = [...new Set(ownerDeclarations.get(subject) ?? [])].sort();
    if (owners.length !== 1) return true;
    return !knownOwners.has(owners[0]);
  });
  if (violations.length === 0) {
    return checkResult(input, {
      status: "pass",
      reasonCode: "no-violation",
      subjects,
      message: "Every explicitly governed component or resource has exactly one lifecycle owner.",
      action: "none"
    });
  }
  return checkResult(input, {
    status: "fail",
    reasonCode: "violation",
    subjects: violations,
    message: "A governed component or resource is missing exactly one known lifecycle owner.",
    action: "record-one-lifecycle-owner-in-archcontext-model-or-policy"
  });
}

function migrationReviewDate(input: PracticeCheckRunInput): PracticeCheckResultV1 {
  const subjects = migrationSubjects(input.match);
  if (subjects.length === 0) return noMigrationEvidence(input, "declare-migration-before-review-date-enforcement");
  const reviewDates = migrationDeclarations(input.match, MIGRATION_REVIEW_DATE_PREFIXES);
  const violations = subjects.filter((subject) => !validMigrationReviewDate(reviewDates.get(subject)));
  if (violations.length === 0) {
    return checkResult(input, {
      status: "pass",
      reasonCode: "no-violation",
      subjects,
      message: "Every explicitly governed migration has a deterministic review date.",
      action: "none"
    });
  }
  return checkResult(input, {
    status: "fail",
    reasonCode: "violation",
    subjects: violations,
    message: "A migration is missing a valid review date.",
    action: "record-migration-review-date"
  });
}

function migrationRemovalCondition(input: PracticeCheckRunInput): PracticeCheckResultV1 {
  const subjects = migrationSubjects(input.match);
  if (subjects.length === 0) return noMigrationEvidence(input, "declare-migration-before-removal-condition-enforcement");
  const removalConditions = migrationDeclarations(input.match, MIGRATION_REMOVAL_CONDITION_PREFIXES);
  const violations = subjects.filter((subject) => !durableMigrationRemovalCondition(removalConditions.get(subject)));
  if (violations.length === 0) {
    return checkResult(input, {
      status: "pass",
      reasonCode: "no-violation",
      subjects,
      message: "Every explicitly governed migration has a deterministic removal condition.",
      action: "none"
    });
  }
  return checkResult(input, {
    status: "fail",
    reasonCode: "violation",
    subjects: violations,
    message: "A migration is missing a durable removal condition.",
    action: "record-migration-removal-condition"
  });
}

function noMigrationEvidence(input: PracticeCheckRunInput, action: string): PracticeCheckResultV1 {
  return checkResult(input, {
    status: "not_applicable",
    reasonCode: "no-violation",
    subjects: [],
    message: "No explicitly governed migration evidence is available.",
    action
  });
}

function importCycleSubjects(match: PracticeMatchV1): string[] {
  return match.evidence
    .filter((evidence) => evidence.kind === "import-edge" && evidence.strength !== "heuristic")
    .map((evidence) => evidence.subject)
    .sort();
}

function ownerGovernedSubjects(match: PracticeMatchV1, registry?: PracticeOwnerRegistry): string[] {
  const registrySubjects = new Set((registry?.subjects ?? []).map((subject) => subject.subject));
  const subjects = match.evidence.flatMap((evidence) => {
    if (evidence.strength === "heuristic") return [];
    if (evidence.kind !== "architecture-model" && evidence.kind !== "diff") return [];
    const governed = prefixedSubject(evidence.subject, GOVERNED_OWNER_PREFIXES);
    if (governed) return [governed];
    return registrySubjects.has(evidence.subject) ? [evidence.subject] : [];
  });
  return [...new Set(subjects)].sort();
}

function lifecycleOwnerDeclarations(match: PracticeMatchV1, registry?: PracticeOwnerRegistry): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const subject of registry?.subjects ?? []) {
    if (subject.lifecycleOwners.length > 0) owners.set(subject.subject, [...subject.lifecycleOwners].sort());
  }
  for (const evidence of match.evidence) {
    if (evidence.strength === "heuristic") continue;
    if (evidence.kind !== "architecture-model" && evidence.kind !== "diff") continue;
    const declaration = lifecycleOwnerDeclaration(evidence.subject);
    if (!declaration) continue;
    owners.set(declaration.subject, [...new Set([...(owners.get(declaration.subject) ?? []), declaration.owner])].sort());
  }
  return owners;
}

function lifecycleOwnerDeclaration(subject: string): { subject: string; owner: string } | undefined {
  const declaration = prefixedSubject(subject, LIFECYCLE_OWNER_PREFIXES);
  const parts = declaration?.split("=");
  if (!parts || parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { subject: parts[0], owner: parts[1] };
}

function prefixedSubject(subject: string, prefixes: string[]): string | undefined {
  const prefix = prefixes.find((candidate) => subject.startsWith(candidate));
  return prefix ? subject.slice(prefix.length) : undefined;
}

function migrationSubjects(match: PracticeMatchV1): string[] {
  const subjects = match.evidence.flatMap((evidence) => {
    if (evidence.strength === "heuristic") return [];
    if (evidence.kind !== "architecture-model" && evidence.kind !== "diff") return [];
    const subject = prefixedSubject(evidence.subject, MIGRATION_SUBJECT_PREFIXES);
    return subject ? [subject] : [];
  });
  return [...new Set(subjects)].sort();
}

function migrationDeclarations(match: PracticeMatchV1, prefixes: string[]): Map<string, string[]> {
  const declarations = new Map<string, string[]>();
  for (const evidence of match.evidence) {
    if (evidence.strength === "heuristic") continue;
    if (evidence.kind !== "architecture-model" && evidence.kind !== "diff") continue;
    const declaration = prefixedSubject(evidence.subject, prefixes);
    const separator = declaration?.indexOf("=") ?? -1;
    if (!declaration || separator <= 0 || separator === declaration.length - 1) continue;
    const subject = declaration.slice(0, separator);
    const value = declaration.slice(separator + 1);
    declarations.set(subject, [...new Set([...(declarations.get(subject) ?? []), value])].sort());
  }
  return declarations;
}

function validMigrationReviewDate(values: string[] | undefined): boolean {
  if (!values || values.length !== 1) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values[0])) return false;
  const parsed = new Date(`${values[0]}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === values[0];
}

function durableMigrationRemovalCondition(values: string[] | undefined): boolean {
  if (!values || values.length !== 1) return false;
  const value = values[0].trim();
  if (value.length < 8) return false;
  return !/\b(?:todo|tbd|later|eventually|temporary|cleanup-later|cleanup_later)\b/i.test(value);
}

function dependencyDirectionViolationSubjects(match: PracticeMatchV1): string[] {
  return match.evidence
    .filter((evidence) =>
      evidence.strength !== "heuristic" &&
      (evidence.kind === "architecture-model" || evidence.kind === "import-edge") &&
      DEPENDENCY_DIRECTION_VIOLATION_PREFIXES.some((prefix) => evidence.subject.startsWith(prefix))
    )
    .map((evidence) => evidence.subject)
    .sort();
}

function checkResult(input: PracticeCheckRunInput, result: {
  status: PracticeCheckResultV1["status"];
  reasonCode: PracticeCheckResultV1["reasonCode"];
  subjects: string[];
  message: string;
  action: string;
}): PracticeCheckResultV1 {
  const subjects = [...new Set(result.subjects)].sort();
  return {
    schemaVersion: "archcontext.practice-check-result/v1",
    practiceId: input.match.practiceId,
    checkId: input.check.checkId,
    assetDigest: input.match.assetDigest,
    enforcement: input.enforcement,
    status: result.status,
    reasonCode: result.reasonCode,
    deterministic: true,
    subjects,
    subjectDigests: subjects.map((subject) => digestJson({ practiceId: input.match.practiceId, checkId: input.check.checkId, subject } as Json)),
    message: result.message,
    remediation: {
      action: result.action,
      paths: []
    }
  };
}
