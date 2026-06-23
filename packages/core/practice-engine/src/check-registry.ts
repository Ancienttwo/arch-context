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
