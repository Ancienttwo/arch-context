import type { Json } from "./schema";

export const PRACTICE_SCHEMA_VERSION = "archcontext.practice/v1" as const;
export const PRACTICE_PROFILE_SCHEMA_VERSION = "archcontext.practice-profile/v1" as const;
export const PRACTICE_SOURCE_SCHEMA_VERSION = "archcontext.practice-source/v1" as const;
export const PRACTICE_CATALOG_MANIFEST_SCHEMA_VERSION = "archcontext.practice-catalog-manifest/v1" as const;

export type PracticeStatus = "active" | "deprecated" | "disabled";
export type PracticeOverlayMode = "add" | "replace" | "disable";
export type PracticeEvidenceStrength = "heuristic" | "declared" | "observed" | "verified";
export type PracticeEvidenceKind =
  | "task-text"
  | "path"
  | "package-manifest"
  | "architecture-model"
  | "symbol"
  | "import-edge"
  | "call-edge"
  | "data-edge"
  | "diff"
  | "test"
  | "runtime-check"
  | "human-attestation";
export type PracticeEnforcementLevel = "advisory" | "checkpoint" | "complete";
export type PracticeSourceTrust = "repo-authored" | "curated-static" | "external-dynamic";
export type PracticeSourceLicenseLevel = "A" | "B" | "C" | "D" | "E";
export type PracticeMatchConfidence = "low" | "medium" | "high";
export type PracticeMatchReason = "retrieval" | "scope" | "signal" | "predicate" | "repo-policy";
export type PracticeCheckpointEvent = "manual" | "post-edit" | "post-write" | "pre-complete";
export type PracticeCheckpointReasonCode =
  | "fresh"
  | "stale-head"
  | "stale-worktree"
  | "no-baseline"
  | "no-op";

export interface PracticeScopeV1 {
  repositoryKinds: string[];
  languages: string[];
  frameworks: string[];
  pathGlobs: string[];
  nodeKinds: string[];
  negativePathGlobs?: string[];
  negativeNodeKinds?: string[];
}

export interface PracticeTriggersV1 {
  candidateTerms: string[];
  pressureSignals: string[];
  structuralPredicates: string[];
}

export interface PracticeEvidencePolicyV1 {
  minimumStrengthForRecommendation: PracticeEvidenceStrength;
  minimumStrengthForCheckpoint: PracticeEvidenceStrength;
  minimumStrengthForEnforcement: PracticeEvidenceStrength;
  requiredKindsForEnforcement: PracticeEvidenceKind[];
  maxEnforcementWhenOnlyHeuristic: "advisory";
}

export interface PracticeGuidanceV1 {
  questions: string[];
  preferred: string[];
  avoid: string[];
}

export interface PracticeCheckV1 {
  checkId: string;
  mode: "deterministic";
  parameters: Record<string, Json>;
}

export interface PracticeEnforcementV1 {
  default: PracticeEnforcementLevel;
  promotableTo: PracticeEnforcementLevel;
  repoOptInRequired: boolean;
}

export interface PracticeSourceRefV1 {
  sourceId: string;
  sourceRevision?: string;
  licenseSpdx?: string;
}

export interface PracticeProvenanceV1 {
  sourceKind: "archcontext-native" | "curated-open-source" | "curated-reference";
  sourceRefs: PracticeSourceRefV1[];
  curator: string;
  reviewedAt: string;
}

export interface PracticeLifecycleV1 {
  introducedAt: string;
  reviewAfter: string;
  supersedes: string[];
  disabledWithReason?: string;
}

export interface PracticeOverlayV1 {
  mode: PracticeOverlayMode;
  extends?: string;
}

export interface PracticeAssetV1 {
  schemaVersion: typeof PRACTICE_SCHEMA_VERSION;
  id: string;
  revision: number;
  status: PracticeStatus;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  appliesTo: PracticeScopeV1;
  triggers: PracticeTriggersV1;
  evidencePolicy: PracticeEvidencePolicyV1;
  guidance: PracticeGuidanceV1;
  checks: PracticeCheckV1[];
  enforcement: PracticeEnforcementV1;
  provenance: PracticeProvenanceV1;
  lifecycle: PracticeLifecycleV1;
  overlay?: PracticeOverlayV1;
}

export interface PracticeProfileV1 {
  schemaVersion: typeof PRACTICE_PROFILE_SCHEMA_VERSION;
  id: string;
  revision: number;
  status: "active" | "deprecated";
  title: string;
  repositoryKinds: string[];
  languages: string[];
  frameworks: string[];
  includePracticeIds: string[];
  excludePracticeIds: string[];
  provenance: PracticeProvenanceV1;
}

export interface PracticeSourceRecordV1 {
  schemaVersion: typeof PRACTICE_SOURCE_SCHEMA_VERSION;
  id: string;
  name: string;
  sourceType: "archcontext" | "git" | "website" | "standard" | "reference";
  uri: string;
  revision: string;
  licenseSpdx: string;
  licenseLevel: PracticeSourceLicenseLevel;
  usagePolicy: "builtin-with-attribution" | "reference-only" | "repo-authored";
  retrievedAt: string;
  contentDigest: string;
  attribution: string;
  review: {
    status: "approved" | "reference-only" | "blocked";
    reviewer: string;
    reviewedAt: string;
  };
}

export interface PracticeCatalogManifestEntryV1 {
  id: string;
  revision: number;
  digest: string;
  sourceIds: string[];
}

export interface PracticeCatalogManifestV1 {
  schemaVersion: typeof PRACTICE_CATALOG_MANIFEST_SCHEMA_VERSION;
  catalogVersion: string;
  productVersion: string;
  generatedAt: string;
  entries: PracticeCatalogManifestEntryV1[];
  sourceIds: string[];
  catalogDigest: string;
}

export interface EffectivePracticeAssetV1 {
  asset: PracticeAssetV1;
  assetDigest: string;
  sourceTrust: PracticeSourceTrust;
  originPath: string;
  overrideChain: string[];
}

export interface PracticeEvidenceV1 {
  kind: PracticeEvidenceKind;
  strength: PracticeEvidenceStrength;
  subject: string;
  digest?: string;
  observedAt?: string;
}

export interface PracticeMatchV1 {
  schemaVersion: "archcontext.practice-match/v1";
  practiceId: string;
  assetRevision: number;
  assetDigest: string;
  title: string;
  category: string;
  score: number;
  confidence: PracticeMatchConfidence;
  enforcement: PracticeEnforcementLevel;
  matchedBy: PracticeMatchReason[];
  evidence: PracticeEvidenceV1[];
  explanation: string[];
  sourceTrust: PracticeSourceTrust;
  suppressedReason?: string;
}

export interface PracticeGuidanceResultV1 {
  schemaVersion: "archcontext.practice-guidance/v1";
  catalogDigest: string;
  overlayDigest: string;
  matches: PracticeMatchV1[];
  constraints: string[];
  decisions: string[];
  realConstraints: string[];
  unknowns: string[];
  requiredCheckpoints: string[];
  resources: { type: "practice"; uri: string; digest: string }[];
}

export interface CheckpointInputV2 {
  schemaVersion: "archcontext.checkpoint-input/v2";
  taskSessionId: string;
  task?: string;
  headSha?: string;
  expectedWorktreeDigest?: string;
  event: PracticeCheckpointEvent;
  changedPaths: string[];
  toolCallId?: string;
}

export interface PracticeCheckpointSnapshotV1 {
  schemaVersion: "archcontext.practice-checkpoint-snapshot/v1";
  task: string;
  headSha: string;
  worktreeDigest: string;
  contextDigest: string;
  practiceGuidanceDigest: string;
  catalogDigest: string;
  matches: PracticeMatchV1[];
}

export interface PracticeDeltaV1 {
  schemaVersion: "archcontext.practice-delta/v1";
  added: PracticeMatchV1[];
  removed: PracticeMatchV1[];
  upgraded: PracticeMatchV1[];
  downgraded: PracticeMatchV1[];
  unchanged: PracticeMatchV1[];
  requiresProof: PracticeMatchV1[];
}

export interface PracticeCheckpointResultV1 {
  schemaVersion: "archcontext.practice-checkpoint/v1";
  taskSessionId: string;
  event: PracticeCheckpointEvent;
  headSha: string;
  expectedHeadSha?: string;
  worktreeDigest: string;
  expectedWorktreeDigest?: string;
  fresh: boolean;
  reasonCode: PracticeCheckpointReasonCode;
  staleReasons: PracticeCheckpointReasonCode[];
  changedPaths: string[];
  toolCallId?: string;
  catalogDigest: string;
  contextDigest: string;
  previousContextDigest?: string;
  practiceGuidanceDigest: string;
  previousPracticeGuidanceDigest?: string;
  delta: PracticeDeltaV1;
  noOpDigest: string;
  resultDigest: string;
  hook: {
    egress: "none";
    failOpen: true;
    pathCount: number;
    network: "forbidden";
    coalesced?: boolean;
    skippedAnalysis?: boolean;
    coalescedEventCount?: number;
    coalesceKey?: string;
  };
  nextSnapshot: PracticeCheckpointSnapshotV1;
}
