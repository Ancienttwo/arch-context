import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  PRACTICE_ENFORCEMENT_POLICY_SCHEMA_VERSION,
  PRACTICE_WAIVER_SCHEMA_VERSION,
  digestJson,
  type EffectivePracticeAssetV1,
  type Json,
  type PracticeCheckResultV1,
  type PracticeEnforcementEvaluationV1,
  type PracticeEnforcementLevel,
  type PracticeEnforcementPolicyV1,
  type PracticeMatchV1,
  type PracticeWaiverApplicationV1,
  type PracticeWaiverV1
} from "@archcontext/contracts";
import type { CompatibilityContractInput } from "@archcontext/core/policy-engine";
import { assertRepoRelativePath } from "@archcontext/core/architecture-domain";
import { isRegisteredPracticeCheck, runRegisteredPracticeCheck, type PracticeOwnerRegistry } from "./check-registry";

export interface PracticeEnforcementCatalog {
  catalogDigest: string;
  effectiveAssets: EffectivePracticeAssetV1[];
}

export interface PracticeEnforcementInput {
  catalog: PracticeEnforcementCatalog;
  policy: PracticeEnforcementPolicyV1;
  waivers?: PracticeWaiverV1[];
  matches: PracticeMatchV1[];
  previousMatches?: PracticeMatchV1[];
  compatibilityContract?: CompatibilityContractInput;
  compatibilityPathIntroduced?: boolean;
  ownerRegistry?: PracticeOwnerRegistry;
  now?: string;
}

export interface PracticeWaiverOwnerRegistry {
  schemaVersion: "archcontext.practice-waiver-owner-registry/v1";
  owners: string[];
  sources: { owner: string; path: string; kind: "lifecycle" | "data" }[];
  subjects: { subject: string; path: string; kind: string; lifecycleOwners: string[]; dataOwners: string[] }[];
  digest: string;
}

export interface PracticeWaiverValidationOptions {
  allowedOwners?: readonly string[];
}

const ENFORCEMENT_RANK: Record<PracticeEnforcementLevel, number> = { advisory: 0, checkpoint: 1, complete: 2 };
const DEFAULT_POLICY: PracticeEnforcementPolicyV1 = {
  schemaVersion: PRACTICE_ENFORCEMENT_POLICY_SCHEMA_VERSION,
  mode: "advisory",
  rules: []
};
const EMPTY_EVALUATION_VERSION = "archcontext.practice-enforcement-evaluation/v1" as const;

export function defaultPracticeEnforcementPolicy(): PracticeEnforcementPolicyV1 {
  return DEFAULT_POLICY;
}

export function loadPracticeEnforcementPolicy(root: string): PracticeEnforcementPolicyV1 {
  const path = resolve(root, ".archcontext/policies/practices.yaml");
  if (!existsSync(path)) return defaultPracticeEnforcementPolicy();
  assertRepoPolicyFile(root, path, ".archcontext/policies/practices.yaml");
  const parsed = parseJsonYamlFile(path) as PracticeEnforcementPolicyV1;
  return validatePracticeEnforcementPolicy(parsed, ".archcontext/policies/practices.yaml");
}

export function loadPracticeWaivers(root: string): PracticeWaiverV1[] {
  const dir = resolve(root, ".archcontext/waivers");
  if (!existsSync(dir)) return [];
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error("practice-waiver-directory-symlink-denied");
  if (!stat.isDirectory()) throw new Error("practice-waiver-path-not-directory");
  const waivers: PracticeWaiverV1[] = [];
  const ownerRegistry = loadPracticeWaiverOwnerRegistry(root);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:ya?ml|json)$/.test(entry.name)) continue;
    const path = join(dir, entry.name);
    const relativePath = `.archcontext/waivers/${entry.name}`;
    assertRepoPolicyFile(root, path, relativePath);
    waivers.push(validatePracticeWaiver(parseJsonYamlFile(path) as PracticeWaiverV1, relativePath, { allowedOwners: ownerRegistry.owners }));
  }
  return waivers.sort((left, right) => waiverDigest(left).localeCompare(waiverDigest(right)));
}

export function loadPracticeWaiverOwnerRegistry(root: string): PracticeWaiverOwnerRegistry {
  const modelDir = resolve(root, ".archcontext/model/nodes");
  const sources: PracticeWaiverOwnerRegistry["sources"] = [];
  const subjects: PracticeWaiverOwnerRegistry["subjects"] = [];
  if (existsSync(modelDir)) {
    if (lstatSync(modelDir).isSymbolicLink()) throw new Error("practice-owner-registry-symlink-denied");
    for (const path of collectFiles(root, ".archcontext/model/nodes")) {
      const absolute = resolve(root, path);
      if (lstatSync(absolute).isSymbolicLink()) throw new Error(`practice-owner-registry-symlink-denied: ${path}`);
      const body = readFileSync(absolute, "utf8");
      const lifecycleOwners = extractOwnershipOwners(body, "lifecycle");
      const dataOwners = extractOwnershipOwners(body, "data");
      for (const kind of ["lifecycle", "data"] as const) {
        for (const owner of extractOwnershipOwners(body, kind)) sources.push({ owner, path, kind });
      }
      const subject = extractNodeScalar(body, "id");
      const nodeKind = extractNodeScalar(body, "kind");
      const status = extractNodeScalar(body, "status");
      if (subject && nodeKind && status !== "removed" && isGovernedOwnerSubjectKind(nodeKind)) {
        subjects.push({ subject, path, kind: nodeKind, lifecycleOwners, dataOwners });
      }
    }
  }
  const owners = [...new Set(sources.map((source) => source.owner))].sort();
  const withoutDigest = {
    schemaVersion: "archcontext.practice-waiver-owner-registry/v1" as const,
    owners,
    sources: sources.sort((a, b) => a.owner.localeCompare(b.owner) || a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind)),
    subjects: subjects.sort((a, b) => a.subject.localeCompare(b.subject) || a.path.localeCompare(b.path))
  };
  return { ...withoutDigest, digest: digestJson(withoutDigest as unknown as Json) };
}

export function validatePracticeEnforcementPolicy(policy: PracticeEnforcementPolicyV1, path = "practice policy"): PracticeEnforcementPolicyV1 {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error(`practice-policy-invalid: ${path}`);
  if (policy.schemaVersion !== PRACTICE_ENFORCEMENT_POLICY_SCHEMA_VERSION) throw new Error(`practice-policy-schema-version: ${path}`);
  if (policy.mode !== "advisory" && policy.mode !== "active") throw new Error(`practice-policy-mode-invalid: ${path}`);
  if (!Array.isArray(policy.rules)) throw new Error(`practice-policy-rules-invalid: ${path}`);
  const seen = new Set<string>();
  for (const rule of policy.rules) {
    if (!rule.practiceId || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(rule.practiceId)) throw new Error(`practice-policy-rule-id-invalid: ${path}`);
    if (!["advisory", "checkpoint", "complete"].includes(rule.enforcement)) throw new Error(`practice-policy-rule-enforcement-invalid: ${path}`);
    const key = `${rule.practiceId}:${rule.enforcement}`;
    if (seen.has(key)) throw new Error(`practice-policy-rule-duplicate: ${rule.practiceId}`);
    seen.add(key);
    validateScope(rule.scope, path);
    validateTestEvidence(rule.testEvidence, path);
  }
  return policy;
}

export function validatePracticeWaiver(waiver: PracticeWaiverV1, path = "practice waiver", options: PracticeWaiverValidationOptions = {}): PracticeWaiverV1 {
  if (!waiver || typeof waiver !== "object" || Array.isArray(waiver)) throw new Error(`practice-waiver-invalid: ${path}`);
  if (waiver.schemaVersion !== PRACTICE_WAIVER_SCHEMA_VERSION) throw new Error(`practice-waiver-schema-version: ${path}`);
  if (!waiver.practiceId || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(waiver.practiceId)) throw new Error(`practice-waiver-practice-id-invalid: ${path}`);
  if (waiver.checkId !== undefined && !/^[a-z][a-z0-9-]*(?:-[a-z0-9]+)*$/.test(waiver.checkId)) throw new Error(`practice-waiver-check-id-invalid: ${path}`);
  if (!waiver.owner || waiver.owner.trim().length < 2) throw new Error(`practice-waiver-owner-required: ${path}`);
  if (options.allowedOwners && !options.allowedOwners.includes(waiver.owner)) throw new Error(`practice-waiver-owner-unknown: ${path}`);
  if (isVagueReason(waiver.reason)) throw new Error(`practice-waiver-reason-not-durable: ${path}`);
  if (Number.isNaN(Date.parse(waiver.createdAt)) || Number.isNaN(Date.parse(waiver.expiresAt))) throw new Error(`practice-waiver-date-invalid: ${path}`);
  if (!/^sha256:[a-f0-9]{64}$/.test(waiver.evidenceDigest)) throw new Error(`practice-waiver-evidence-digest-invalid: ${path}`);
  validateScope(waiver.scope, path);
  if ((waiver.scope.subjects?.length ?? 0) === 0 && (waiver.scope.pathGlobs?.length ?? 0) === 0) throw new Error(`practice-waiver-scope-required: ${path}`);
  return waiver;
}

export function evaluatePracticeEnforcement(input: PracticeEnforcementInput): PracticeEnforcementEvaluationV1 {
  const policyDigest = digestJson(input.policy as unknown as Json);
  if (input.policy.mode !== "active") return emptyEvaluation(input.catalog.catalogDigest, policyDigest);

  const matchesById = new Map(input.matches.map((match) => [match.practiceId, match]));
  const previousById = new Map((input.previousMatches ?? []).map((match) => [match.practiceId, match]));
  const assetsById = new Map(input.catalog.effectiveAssets.map((effective) => [effective.asset.id, effective]));
  const results: PracticeCheckResultV1[] = [];

  for (const rule of input.policy.rules.filter((rule) => rule.enforcement === "complete").sort((a, b) => a.practiceId.localeCompare(b.practiceId))) {
    const match = matchesById.get(rule.practiceId);
    const effective = assetsById.get(rule.practiceId);
    if (!match || !effective) continue;
    if (ENFORCEMENT_RANK[rule.enforcement] > ENFORCEMENT_RANK[effective.asset.enforcement.promotableTo]) {
      results.push(notApplicable(match, "not-opted-in", rule.enforcement, "Practice cannot be promoted to complete enforcement."));
      continue;
    }
    if (match.sourceTrust === "external-dynamic" || match.evidence.every((evidence) => evidence.strength === "heuristic")) {
      results.push(notApplicable(match, "heuristic-only", rule.enforcement, "Heuristic-only or external-dynamic practice guidance cannot hard-gate complete."));
      continue;
    }
    const selectedChecks = effective.asset.checks
      .filter((check) => !rule.checkIds || rule.checkIds.includes(check.checkId))
      .sort((a, b) => a.checkId.localeCompare(b.checkId));
    for (const check of selectedChecks) {
      const result = isRegisteredPracticeCheck(check.checkId)
        ? runRegisteredPracticeCheck({
          match,
          check,
          enforcement: rule.enforcement,
          compatibilityContract: input.compatibilityContract,
          compatibilityPathIntroduced: input.compatibilityPathIntroduced,
          hasBaseline: input.previousMatches !== undefined,
          previousMatch: previousById.get(rule.practiceId),
          ownerRegistry: input.ownerRegistry,
          policyRule: rule
        })
        : notApplicable(match, "not-registered", rule.enforcement, `Practice check is not registered for complete enforcement: ${check.checkId}`, check.checkId);
      results.push(applyWaiver(result, input.waivers ?? [], input.now ?? new Date(0).toISOString()));
    }
  }

  return finalizeEvaluation(input.catalog.catalogDigest, policyDigest, results);
}

export function practiceWaiverEvidenceDigest(result: Pick<PracticeCheckResultV1, "practiceId" | "checkId" | "subjects">): string {
  return digestJson({ practiceId: result.practiceId, checkId: result.checkId, subjects: [...result.subjects].sort() } as Json);
}

function emptyEvaluation(catalogDigest: string, policyDigest: string): PracticeEnforcementEvaluationV1 {
  return finalizeEvaluation(catalogDigest, policyDigest, []);
}

function finalizeEvaluation(catalogDigest: string, policyDigest: string, results: PracticeCheckResultV1[]): PracticeEnforcementEvaluationV1 {
  const sortedResults = results.sort((a, b) => a.practiceId.localeCompare(b.practiceId) || a.checkId.localeCompare(b.checkId));
  const violations = sortedResults.filter((result) => result.status === "fail");
  const waiversApplied = sortedResults.flatMap((result) => result.waiver ? [result.waiver] : []);
  const actionsRequired = [...new Set(violations.map((result) => result.remediation.action).filter((action) => action !== "none"))].sort();
  const checkResultDigest = digestJson({ catalogDigest, policyDigest, results: sortedResults } as unknown as Json);
  return {
    schemaVersion: EMPTY_EVALUATION_VERSION,
    catalogDigest,
    policyDigest,
    checkResultDigest,
    results: sortedResults,
    violations,
    waiversApplied,
    actionsRequired
  };
}

function applyWaiver(result: PracticeCheckResultV1, waivers: PracticeWaiverV1[], now: string): PracticeCheckResultV1 {
  if (result.status !== "fail") return result;
  const matching = waivers.find((waiver) => waiverMatchesResult(waiver, result, now));
  if (!matching) return result;
  return {
    ...result,
    status: "waived",
    reasonCode: "waived",
    waiver: {
      waiverDigest: waiverDigest(matching),
      practiceId: matching.practiceId,
      ...(matching.checkId === undefined ? {} : { checkId: matching.checkId }),
      owner: matching.owner,
      expiresAt: matching.expiresAt
    }
  };
}

function waiverMatchesResult(waiver: PracticeWaiverV1, result: PracticeCheckResultV1, now: string): boolean {
  try {
    validatePracticeWaiver(waiver);
  } catch {
    return false;
  }
  if (waiver.practiceId !== result.practiceId) return false;
  if (waiver.checkId !== undefined && waiver.checkId !== result.checkId) return false;
  if (Date.parse(waiver.expiresAt) <= Date.parse(now)) return false;
  if (waiver.evidenceDigest !== practiceWaiverEvidenceDigest(result)) return false;
  const subjects = waiver.scope.subjects ?? [];
  if (subjects.length > 0 && !subjects.every((subject) => result.subjects.includes(subject))) return false;
  return true;
}

function notApplicable(
  match: PracticeMatchV1,
  reasonCode: PracticeCheckResultV1["reasonCode"],
  enforcement: PracticeEnforcementLevel,
  message: string,
  checkId = "unregistered"
): PracticeCheckResultV1 {
  return {
    schemaVersion: "archcontext.practice-check-result/v1",
    practiceId: match.practiceId,
    checkId,
    assetDigest: match.assetDigest,
    enforcement,
    status: "not_applicable",
    reasonCode,
    deterministic: true,
    subjects: [],
    subjectDigests: [],
    message,
    remediation: { action: "none", paths: [] }
  };
}

function waiverDigest(waiver: PracticeWaiverV1): string {
  return digestJson(waiver as unknown as Json);
}

function validateScope(scope: { pathGlobs?: string[]; subjects?: string[] } | undefined, path: string): void {
  if (!scope) return;
  for (const glob of scope.pathGlobs ?? []) {
    if (glob.startsWith("/") || glob.includes("\\") || glob.split("/").includes("..")) throw new Error(`practice-scope-path-invalid: ${path}`);
  }
  for (const subject of scope.subjects ?? []) {
    if (typeof subject !== "string" || subject.trim().length === 0) throw new Error(`practice-scope-subject-invalid: ${path}`);
  }
}

function validateTestEvidence(testEvidence: { commands?: string[]; subjects?: string[] } | undefined, path: string): void {
  if (!testEvidence) return;
  const commands = testEvidence.commands ?? [];
  const subjects = testEvidence.subjects ?? [];
  if (!Array.isArray(commands) || !Array.isArray(subjects) || commands.length + subjects.length === 0) throw new Error(`practice-policy-test-evidence-required: ${path}`);
  for (const command of commands) {
    if (typeof command !== "string" || command.trim().length === 0 || command.includes("\n") || command.includes("\r")) throw new Error(`practice-policy-test-command-invalid: ${path}`);
  }
  for (const subject of subjects) {
    if (typeof subject !== "string" || subject.trim().length === 0) throw new Error(`practice-policy-test-subject-invalid: ${path}`);
  }
}

function isVagueReason(reason: string): boolean {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 12) return true;
  return /^(temporary|cleanup later|todo|tbd|later|just in case)$/i.test(trimmed);
}

function parseJsonYamlFile(path: string): unknown {
  const body = readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim();
  const withoutDocumentMarker = body.startsWith("---") ? body.replace(/^---\s*/, "").trim() : body;
  return JSON.parse(withoutDocumentMarker);
}

function collectFiles(root: string, relativeDir: string): string[] {
  const dir = resolve(root, relativeDir);
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collectFiles(root, child));
    if (entry.isFile() && /\.(?:ya?ml|json)$/.test(entry.name)) out.push(child);
  }
  return out.sort();
}

function extractOwnershipOwners(body: string, kind: "lifecycle" | "data"): string[] {
  const jsonOwners = extractJsonOwnershipOwners(body, kind);
  if (jsonOwners.length > 0) return jsonOwners;
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const owners: string[] = [];
  const ownershipIndex = lines.findIndex((line) => /^(\s*)ownership:\s*$/.test(line));
  if (ownershipIndex === -1) return owners;
  const ownershipIndent = leadingSpaces(lines[ownershipIndex]);
  for (let index = ownershipIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    const indent = leadingSpaces(line);
    if (indent <= ownershipIndent) break;
    const keyMatch = line.match(new RegExp(`^\\s*${kind}:\\s*(.*)$`));
    if (!keyMatch) continue;
    const inline = keyMatch[1].trim();
    if (inline.startsWith("[")) owners.push(...parseInlineStringArray(inline));
    for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
      const child = lines[childIndex];
      if (child.trim().length === 0) continue;
      const childIndent = leadingSpaces(child);
      if (childIndent <= indent) break;
      const item = child.match(/^\s*-\s*"?([^"\n]+)"?\s*$/);
      if (item) owners.push(item[1].trim());
    }
  }
  return [...new Set(owners.filter(Boolean))].sort();
}

function extractJsonOwnershipOwners(body: string, kind: "lifecycle" | "data"): string[] {
  try {
    const parsed = JSON.parse(body) as { ownership?: Record<string, unknown> };
    const values = parsed.ownership?.[kind];
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string").sort() : [];
  } catch {
    return [];
  }
}

function extractNodeScalar(body: string, key: "id" | "kind" | "status"): string | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    const match = body.replace(/\r\n/g, "\n").match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?\\s*$`, "m"));
    return match?.[1].trim();
  }
}

function isGovernedOwnerSubjectKind(kind: string): boolean {
  return ["component", "datastore", "deployment", "external-system", "interface", "module"].includes(kind);
}

function parseInlineStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value.replace(/'/g, "\"")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function leadingSpaces(value: string): number {
  return value.match(/^\s*/)?.[0].length ?? 0;
}

function assertRepoPolicyFile(root: string, path: string, relativePath: string): void {
  assertRepoRelativePath(relativePath);
  if (lstatSync(path).isSymbolicLink()) throw new Error(`practice-policy-symlink-denied: ${relativePath}`);
  const rootResolved = resolve(root);
  const pathResolved = resolve(path);
  const rel = relative(rootResolved, pathResolved);
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) throw new Error(`practice-policy-path-escape: ${relativePath}`);
  if (basename(pathResolved).startsWith(".")) throw new Error(`practice-policy-hidden-file-denied: ${relativePath}`);
}
