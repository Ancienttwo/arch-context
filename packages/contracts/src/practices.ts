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
