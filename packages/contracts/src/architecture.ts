export interface ArchitectureSinkSelectorV2 {
  id: string;
  path: string;
  symbol: string;
}

export interface ArchitectureEntrypointSymbolV2 {
  name: string;
  sinks: ArchitectureSinkSelectorV2[];
}

export interface ArchitectureEntrypointV2 {
  id: string;
  path: string;
  symbols: ArchitectureEntrypointSymbolV2[];
}

export interface ArchitectureNodeSourceV2 {
  include?: string[];
  exclude?: string[];
  entrypoints?: ArchitectureEntrypointV2[];
}

export interface ArchitectureFlowEvidenceSelectorV1 {
  entrypointId: string;
  sourceSymbol: string;
  sinkId: string;
}

export interface ArchitectureFlowParticipantV1 {
  id: string;
  nodeId: string;
}

export interface ArchitectureFlowStepV1 {
  id: string;
  from: string;
  to: string;
  label: string;
  evidence: ArchitectureFlowEvidenceSelectorV1;
}

export interface ArchitectureFlowOutcomeV1 {
  id: string;
  kind: "success" | "error";
  label: string;
  steps: ArchitectureFlowStepV1[];
  terminal: {
    participant: string;
    label: string;
  };
}

export type ArchitectureFlowV1 = ArchitectureRequiredFlowV1 | ArchitectureNotApplicableFlowV1;

interface ArchitectureFlowBaseV1 {
  schemaVersion: "archcontext.flow/v1";
  id: string;
  capabilityId: string;
  name: string;
}

export interface ArchitectureRequiredFlowV1 extends ArchitectureFlowBaseV1 {
  applicability: "required";
  participants: ArchitectureFlowParticipantV1[];
  steps: ArchitectureFlowStepV1[];
  outcomes: ArchitectureFlowOutcomeV1[];
}

export interface ArchitectureNotApplicableFlowV1 extends ArchitectureFlowBaseV1 {
  applicability: "not-applicable";
  rationale: string;
}
