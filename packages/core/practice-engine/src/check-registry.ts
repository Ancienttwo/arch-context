import { digestJson, type Json, type PracticeCheckResultV1, type PracticeCheckV1, type PracticeEnforcementLevel, type PracticeMatchV1 } from "@archcontext/contracts";
import { validateCompatibilityContract, type CompatibilityContractInput } from "@archcontext/core/policy-engine";

export interface PracticeCheckRunInput {
  match: PracticeMatchV1;
  check: PracticeCheckV1;
  enforcement: PracticeEnforcementLevel;
  compatibilityContract?: CompatibilityContractInput;
  compatibilityPathIntroduced?: boolean;
  hasBaseline?: boolean;
  previousMatch?: PracticeMatchV1;
}

type RegisteredPracticeCheck = (input: PracticeCheckRunInput) => PracticeCheckResultV1;

const REGISTERED_CHECKS: Record<string, RegisteredPracticeCheck> = {
  "compatibility-contract-required": compatibilityContractRequired,
  "no-new-cycle": noNewCycle
};

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

function importCycleSubjects(match: PracticeMatchV1): string[] {
  return match.evidence
    .filter((evidence) => evidence.kind === "import-edge" && evidence.strength !== "heuristic")
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
