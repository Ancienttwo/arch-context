import type {
  AuthorityCursorV1,
  ExplorerPressureLevel,
  ExplorerProjectionCursorV2,
  ExplorerSemanticLevelV2,
  ExplorerSubjectRefKindV2,
  ExplorerVerificationStatus,
  ExplorerViewIdV2,
  ProjectionInputManifestV1,
  SourceSelector
} from "./explorer-query-ports";

export interface ExplorerSubjectRefV2 {
  kind: ExplorerSubjectRefKindV2;
  id: string;
}

export interface ExplorerOccurrenceProvenanceV2 {
  declaredEntityIds: string[];
  observedSymbolIds: string[];
  evidenceBindingIds: string[];
}

export type ExplorerAuthorityStateV2 = "BOUND" | "UNBOUND_OBSERVED" | "DECLARED_UNOBSERVED" | "DERIVED";

export interface ExplorerPressureEvaluationV2 {
  evaluated: boolean;
  level?: ExplorerPressureLevel;
  score?: number;
  signals: string[];
  inputDigest?: string;
}

export interface ExplorerInspectorV2 {
  summary?: string;
  responsibility?: string;
  constraints: Array<{ id: string; kind: string; severity?: string; summary?: string }>;
  decisions: Array<{ eventId: string; title?: string; rationale?: string }>;
  historyEvents: Array<{ eventId: string; title?: string; rationale?: string }>;
  sourceSelectors: SourceSelector[];
  evidenceBindingIds: string[];
}

export interface ExplorerBacklinksV2 {
  appearsInViews: ExplorerViewIdV2[];
  affectedByTaskSessionIds: string[];
  constrainedByIds: string[];
  evidencedByBindingIds: string[];
  changedByEventIds: string[];
  decidedByEventIds: string[];
  incomingRelationIds: string[];
  outgoingRelationIds: string[];
}

export interface ExplorerSubjectOccurrenceV2 {
  occurrenceId: string;
  role: "subject";
  parentOccurrenceId?: string;
  subjectRefs: ExplorerSubjectRefV2[];
  name: string;
  kind: string;
  childrenCount: number;
  expandable: boolean;
  verificationStatus: ExplorerVerificationStatus;
  authorityState: ExplorerAuthorityStateV2;
  pressure: ExplorerPressureEvaluationV2;
  sourceSelectors: SourceSelector[];
  provenance: ExplorerOccurrenceProvenanceV2;
  inspector: ExplorerInspectorV2;
  backlinks: ExplorerBacklinksV2;
}

export interface ExplorerDerivedGroupOccurrenceV2 {
  occurrenceId: string;
  role: "derived-group";
  parentOccurrenceId?: string;
  subjectRefs: [];
  name: string;
  kind: string;
  childrenCount: number;
  expandable: boolean;
  verificationStatus: "UNKNOWN";
  authorityState: "DERIVED";
  pressure: ExplorerPressureEvaluationV2;
  sourceSelectors: [];
  provenance: ExplorerOccurrenceProvenanceV2;
  derivation: {
    ruleId: string;
    inputDigest: string;
    compilerVersion: "archcontext.explorer-view-compiler/v1";
  };
}

export type ExplorerOccurrenceV2 = ExplorerSubjectOccurrenceV2 | ExplorerDerivedGroupOccurrenceV2;

export interface ExplorerRelationOccurrenceV2 {
  occurrenceId: string;
  sourceOccurrenceId: string;
  targetOccurrenceId: string;
  kind: string;
  verificationStatus: ExplorerVerificationStatus;
  provenance: {
    declaredRelationIds: string[];
    observedEdgeIds: string[];
    evidenceBindingIds: string[];
  };
}

export interface ExplorerProjectionV2 {
  schemaVersion: "archcontext.explorer-projection/v2";
  view: {
    id: ExplorerViewIdV2;
    title: string;
    question: string;
  };
  availableViews: Array<{ id: ExplorerViewIdV2; enabled: boolean; reason?: string }>;
  semanticLevel: ExplorerSemanticLevelV2;
  breadcrumbs: Array<{ occurrenceId: string; label: string }>;
  cursor: ExplorerProjectionCursorV2;
  inputManifest: ProjectionInputManifestV1;
  occurrences: ExplorerOccurrenceV2[];
  relations: ExplorerRelationOccurrenceV2[];
  page: {
    budget: { maxNodes: number; maxRelations: number };
    totalNodes: number;
    totalRelations: number;
    returnedNodes: number;
    returnedRelations: number;
    truncated: boolean;
    omittedNodeCount: number;
    omittedRelationCount: number;
  };
  projectionDigest: string;
  capabilities: {
    readOnly: true;
    mutationMode: "forbidden";
    egress: "none";
    tokenRequired: boolean;
  };
}

export type ExplorerDeltaClassV2 = "architecture-fact" | "evidence" | "projection";

export type ExplorerDeltaFailureReasonV2 =
  | "invalid-delta-query"
  | "projection-cache-miss"
  | "authority-event-missing"
  | "authority-cursor-reversed"
  | "projection-authority-mismatch"
  | "projection-manifest-incompatible";

export interface ExplorerDeltaQueryV2 {
  schemaVersion: "archcontext.explorer-delta-query/v2";
  base: { eventId: string; projectionDigest: string };
  head: { eventId: string; projectionDigest: string };
}

export interface ExplorerDeltaChangeV2 {
  deltaClass: ExplorerDeltaClassV2;
  subjectId: string;
  change: "added" | "removed" | "changed";
  fields: string[];
  verificationTransition?: { from: ExplorerVerificationStatus; to: ExplorerVerificationStatus };
}

export interface ExplorerProjectionDeltaV2 {
  schemaVersion: "archcontext.explorer-projection-delta/v2";
  base: AuthorityCursorV1 & { projectionDigest: string; inputManifestDigest: string };
  head: AuthorityCursorV1 & { projectionDigest: string; inputManifestDigest: string };
  factChanges: ExplorerDeltaChangeV2[];
  evidenceChanges: ExplorerDeltaChangeV2[];
  projectionChanges: ExplorerDeltaChangeV2[];
  counts: Record<ExplorerDeltaClassV2, number>;
  deltaDigest: string;
}
