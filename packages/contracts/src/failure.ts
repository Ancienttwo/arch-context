import { changeSetRecoveryDetailsSnapshot } from "./changeset-recovery";
import { PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES, projectionRecoveryDetailsSnapshot } from "./projection-recovery";
import { ERROR_CATALOG, canonicalize, type ArchContextErrorCode, type Json, type Severity } from "./schema";

/** Only selected entrypoints support transport failures; the legacy AC-only envelope is unchanged. */
export type FailureCode = ArchContextErrorCode | "RPC_TIMEOUT" | "RPC_ABORTED";
export const FAILURE_STAGES = Object.freeze(["debt", "complete", "practice-checkpoint", "cli", "mcp", "hook-checkpoint", "failure-metadata", "public-operation", "native-export", "docs-anchors", "flows-check"] as const);
export type FailureStage = typeof FAILURE_STAGES[number];
export interface StrictFailure<C extends FailureCode = FailureCode> {
  code: C;
  message: string;
  severity: Severity;
  retryable: boolean;
  action: string;
  reasonCode: string;
  details: { [key: string]: Json };
}
export interface FailureEnvelope<C extends FailureCode = FailureCode> {
  schemaVersion: "archcontext.envelope/v1";
  ok: false;
  requestId: string;
  data?: never;
  error: StrictFailure<C>;
}
type Policy = { code: FailureCode; message: string; fields?: readonly string[]; action?: string; facts?: Readonly<Record<string, string>>; native?: boolean; recovery?: boolean; journalRecovery?: boolean; retryable?: boolean };
/** Closed repository diagnostics. Messages contain no process output or filesystem paths. */
export const CODE_FACTS_ISSUE_MESSAGES = Object.freeze({
  "not-initialized": "CodeGraph repository status is not initialized",
  "version-mismatch": "CodeGraph repository status version mismatch",
  "project-path-mismatch": "CodeGraph repository project path mismatch",
  "index-incomplete": "CodeGraph repository index is not complete and compatible",
  "extraction-version-mismatch": "CodeGraph repository extraction version mismatch",
  "worktree-mismatch": "CodeGraph repository worktree mismatch",
  "pending-source-changes": "CodeGraph repository index has pending or unreported source changes"
});
/** Each reason has a closed fact vocabulary. No source text or recovery binding is a summary fact. */
const policies: Record<string, Policy> = {
  "git-worktree-required": { code: "AC_REPO_NOT_FOUND", message: "This operation requires a Git worktree.", fields: ["checks"] },
  "model-missing": { code: "AC_MODEL_ADOPTION_REQUIRED", message: "Architecture debt requires an adopted model.", fields: ["checks"] },
  "changed-path-invalid": { code: "AC_SCHEMA_INVALID", message: "Changed paths must be an array of repository-relative POSIX paths.", fields: ["checks"] },
  "debt-report-invalid": { code: "AC_SCHEMA_INVALID", message: "Architecture debt evidence violates its contract.", fields: ["checks"] },
  "projection-manifest-upgrade-required": { code: "AC_PRECONDITION_FAILED", message: "The committed projection manifest requires supported re-baselining. First restore the original model if missing; the manifest digest cannot recover it. With the reviewed model available, follow docs/runbooks/architecture-documentation-projections.md before running archctx docs apply --approved --profile <default|repo-harness/v1>." },
  "projection-manifest-invalid": { code: "AC_PRECONDITION_FAILED", message: "The committed projection manifest violates its contract." },
  "projection-footprint-uncovered": { code: "AC_PRECONDITION_FAILED", message: "Declared source footprints lack a projection target." },
  "index-missing": { code: "AC_CODE_FACTS_UNAVAILABLE", message: "Required code facts have no available index. Run codegraph init." },
  "code-facts-not-ready": { code: "AC_CODE_FACTS_NOT_READY", message: "Repository code facts are not ready. Run archctx doctor --json and follow the reported action.", facts: { issues: "codeFactsIssues" } },
  "checkpoint-input-invalid": { code: "AC_SCHEMA_INVALID", message: "Checkpoint arguments violate the declared input schema.", fields: ["issueCount"], action: "correct-command-arguments" },
  "cli-input-invalid": { code: "AC_SCHEMA_INVALID", message: "Command arguments violate the declared input contract.", action: "correct-command-arguments" },
  "complete-input-invalid": { code: "AC_SCHEMA_INVALID", message: "Completion input violates the caller authority contract.", action: "correct-command-arguments" },
  "hook-event-invalid": { code: "AC_SCHEMA_INVALID", message: "Hook event violates the declared input contract.", action: "correct-command-arguments" },
  "egress-policy-denied": { code: "AC_POLICY_VIOLATION", message: "Local policy refused this operation." },
  "runtime-version-unsupported": { code: "AC_RUNTIME_VERSION_UNSUPPORTED", message: "The connected runtime version is unsupported." },
  "rpc-timeout": { code: "RPC_TIMEOUT", message: "The runtime RPC deadline elapsed without a response; a mutation outcome is unknown.", fields: ["method", "timeoutMs", "elapsedMs", "mutationOutcome"], action: "reconcile-before-retry" },
  "rpc-aborted": { code: "RPC_ABORTED", message: "The runtime RPC caller aborted without a response; a mutation outcome is unknown.", fields: ["method", "timeoutMs", "elapsedMs", "mutationOutcome"], action: "reconcile-before-retry" },
  "failure-unclassified": { code: "AC_UNCLASSIFIED_FAILURE", message: "The operation failed without a classified cause. Run archctx doctor --json before retrying.", action: "inspect-diagnostics" },
};
// C1 policies are selected at explicit producer branches, never from diagnostic text.
Object.assign(policies, {
  "developer-review-run-not-owned": {code:"AC_PRECONDITION_FAILED",message:"developer-review-run-not-owned",facts:{refusal:"reviewOwnershipRefusal"}},
  "developer-review-attestation-input-invalid": {code:"AC_SCHEMA_INVALID",message:"Caller-provided attestation fields are forbidden.",facts:{issueCount:"uint"}},
  "init-would-overwrite-existing-model": {"code": "AC_PRECONDITION_FAILED", "message": "init-would-overwrite-existing-model: an existing architecture model must not be overwritten.", "facts": {}},
  "waiver-list-unreadable": {"code": "AC_SCHEMA_INVALID", "message": "Practice waiver list or owner registry could not be read.", "facts": {}},
  "developer-review-run-already-active": {"code": "AC_PRECONDITION_FAILED", "message": "developer-review-run-already-active", "facts": {"challengeId": "id"}},
  "developer-review-run-prepare-failed": {"code": "AC_PRECONDITION_FAILED", "message": "developer-review-run-prepare-failed", "facts": {}},
  "developer-review-worktree-invalid": {"code": "AC_PRECONDITION_FAILED", "message": "developer-review-worktree-invalid", "facts": {"refusal":"reviewWorktreeRefusal"}},
  "device-private-key-signer-unavailable": {"code": "AC_PRECONDITION_FAILED", "message": "device-private-key-signer-unavailable", "facts": {}},

  "ledger-worktree-claim-required": {code:"AC_PRECONDITION_FAILED", message:"Ledger write requires expectedWorktreeDigest.", facts:{}},
  "ledger-worktree-claim-changed": {code:"AC_PRECONDITION_FAILED", message:"Worktree digest changed before ledger write.", facts:{expectedWorktreeDigest:"sha256",actualWorktreeDigest:"sha256"}},
  "rpc-version-mismatch": {code:"AC_RUNTIME_VERSION_UNSUPPORTED", message:"Runtime RPC version mismatch; run archctx daemon upgrade.",action:"upgrade-archctx-runtime",facts:{expected:"rpcVersion",received:"rpcVersion",action:"upgradeAction",upgradeCommand:"upgradeCommand"}},
  "semantic-model-directory-invalid": {"code": "AC_PRECONDITION_FAILED", "message": "semantic-model-directory-invalid.", "facts": {}},
  "semantic-model-entry-not-regular": {"code": "AC_PRECONDITION_FAILED", "message": "semantic-model-entry-not-regular.", "facts": {}},
  "accepted-committed-change-not-utf8": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-not-utf8.", "facts": {}},
  "accepted-committed-change-journal-lookup-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-journal-lookup-mismatch", "facts": {}},
  "accepted-committed-change-journal-not-committed": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-journal-not-committed.", "facts": {}},
  "accepted-committed-change-journal-id-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-journal-id-mismatch.", "facts": {}},
  "accepted-committed-change-journal-without-semantic-write": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-journal-without-semantic-write.", "facts": {}},
  "accepted-committed-change-journal-without-transition": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-journal-without-transition.", "facts": {}},
  "accepted-committed-change-journal-out-of-order": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-journal-out-of-order.", "facts": {}},
  "accepted-committed-change-chain-empty": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-chain-empty", "facts": {}},
  "accepted-committed-change-chain-baseline-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-chain-baseline-mismatch.", "facts": {}},
  "accepted-committed-change-chain-gap": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-chain-gap.", "facts": {"previousJournalId":"id","journalId":"id"}},
  "accepted-committed-change-chain-current-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-chain-current-mismatch.", "facts": {}},
  "accepted-committed-change-node-path-nonstandard": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-node-path-nonstandard.", "facts": {}},
  "accepted-committed-change-deleted-node-unbound": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-deleted-node-unbound.", "facts": {}},
  "accepted-committed-change-proof-change-unexplained": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-proof-change-unexplained.", "facts": {"capabilityId":"id"}},
  "accepted-committed-change-model-snapshot-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-model-snapshot-mismatch: the model changed during acceptance", "facts": {}},
  "accepted-committed-change-projection-model-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-projection-model-mismatch", "facts": {}},
  "accepted-committed-change-projection-rejected": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-projection-rejected: resolve adoption or ownership conflicts first", "facts": {}},
  "accepted-committed-change-proof-unprovable": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-proof-unprovable.", "facts": {}},
  "accepted-committed-change-no-unresolved-major-change": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-no-unresolved-major-change.", "facts": {}},
  "accepted-committed-change-observed-delta-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-observed-delta-mismatch", "facts": {}},
  "accepted-committed-change-reference-not-resolvable": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-reference-not-resolvable", "facts": {}},
  "accepted-committed-change-head-unreadable": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-head-unreadable", "facts": {}},
  "accepted-committed-change-baseline-missing": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-baseline-missing: no projection manifest", "facts": {}},
  "accepted-committed-change-baseline-changed": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-baseline-changed: projection manifest moved during acceptance", "facts": {}},
  "accepted-committed-change-baseline-unanchored": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-baseline-unanchored.", "facts": {}},
  "accepted-committed-change-file-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-file-mismatch.", "facts": {}},
  "accepted-committed-change-node-id-missing": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-node-id-missing.", "facts": {}},
  "accepted-committed-change-path-unprovable": {"code": "AC_PRECONDITION_FAILED", "message": "accepted-committed-change-path-unprovable: symlink or semantic path authority cannot be proven.", "facts": {}},
  "projection-inputs-changed-during-run": {"code": "AC_PRECONDITION_FAILED", "message": "architecture-docs-projection-inputs-changed-during-run", "facts": {"field": "projectionInputField"}},

  "daemon-stop-identity-mismatch": {code:"AC_RUNTIME_VERSION_UNSUPPORTED",message:"Expected daemon identity does not match this live instance; no shutdown performed.",facts:{}},
  "projection-apply-first-delivery-unavailable": {"code": "AC_PRECONDITION_FAILED", "message": "Projection apply first delivery unavailable.", "facts": {"lookupKey": "sha256", "applyId": "sha256"}},
  "projection-apply-readback-proof-unavailable": {"code": "AC_PRECONDITION_FAILED", "message": "Projection apply readback proof unavailable.", "facts": {"lookupKey": "sha256", "applyId": "sha256"}},
  "projection-apply-restored-proof-unavailable": {"code": "AC_PRECONDITION_FAILED", "message": "Projection apply restored proof unavailable.", "facts": {"lookupKey": "sha256", "applyId": "sha256"}},
  "projection-recovery-delivery-unavailable": {"code": "AC_PRECONDITION_FAILED", "message": "Projection recovery delivery unavailable.", "facts": {"lookupKey": "sha256", "applyId": "sha256"}},
  "projection-recovery-receipt-missing": {"code": "AC_PRECONDITION_FAILED", "message": "Projection recovery receipt missing.", "facts": {"lookupKey": "sha256", "applyId": "sha256"}},
  "projection-recovery-proof-missing": {"code": "AC_PRECONDITION_FAILED", "message": "Projection recovery proof missing.", "facts": {"lookupKey": "sha256", "applyId": "sha256"}},
  "projection-recovery-authority-changed": {"code": "AC_PRECONDITION_FAILED", "message": "Projection recovery authority changed.", "facts": {"lookupKey": "sha256", "applyId": "sha256"}},
  "projection-apply-restore-unproven": {"code": "AC_PRECONDITION_FAILED", "message": "Projection apply restore unproven.", "facts": {"lookupKey": "sha256", "applyId": "sha256", "issueCount": "uint"}},
  "projection-readback-proof-failed": {"code": "AC_PRECONDITION_FAILED", "message": "Projection readback proof failed.", "facts": {"lookupKey": "sha256", "applyId": "sha256", "issueCount": "uint"}},
  "projection-readback-authority-changed": {"code": "AC_PRECONDITION_FAILED", "message": "Projection readback authority changed.", "facts": {"lookupKey": "sha256", "applyId": "sha256", "issueCount": "uint"}},
  "projection-recovery-proof-failed": {"code": "AC_PRECONDITION_FAILED", "message": "Projection recovery proof failed.", "facts": {"lookupKey": "sha256", "applyId": "sha256", "issueCount": "uint"}},
  "projection-ownership-repair-required": {"code": "AC_PRECONDITION_FAILED", "message": "Projection ownership repair required.", "facts": {"issueCount": "uint"}},
  "projection-orphan-review-required": {"code": "AC_PRECONDITION_FAILED", "message": "Projection orphan review required.", "facts": {"issueCount": "uint"}},
  "projection-adoption-refused": {"code": "AC_PRECONDITION_FAILED", "message": "Projection adoption refused.", "facts": {"issueCount": "uint"}},
  "projection-readback-absence-invalid": {"code": "AC_PRECONDITION_FAILED", "message": "Projection readback absence invalid.", "facts": {"issueCount": "uint"}},
  "projection-adoption-preimage-missing": {"code": "AC_PRECONDITION_FAILED", "message": "Projection adoption preimage missing.", "facts": {}},
  "projection-adoption-preview-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "Projection adoption preview mismatch.", "facts": {}},
  "projection-accepted-fixed-point-unproven": {"code": "AC_PRECONDITION_FAILED", "message": "Projection accepted fixed point unproven.", "facts": {}},
  "projection-adoption-fixed-point-unproven": {"code": "AC_PRECONDITION_FAILED", "message": "Projection adoption fixed point unproven.", "facts": {"driftCount": "uint", "rejectedCount": "uint", "digestStable": "boolean"}},
  "projection-adoption-profile-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Projection adoption profile invalid.", "facts": {}},
  "projection-adoption-approval-input-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Projection adoption approval input invalid.", "facts": {}},
  "agent-context-input-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Agent context input invalid.", "facts": {}},
  "projection-readback-input-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Projection readback input invalid.", "facts": {}},
  "projection-recovery-input-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Projection recovery input invalid.", "facts": {}},
  "projection-readback-result-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Projection readback result invalid.", "facts": {"issueCount": "uint"}},
  "projection-recovery-result-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Projection recovery result invalid.", "facts": {"issueCount": "uint"}},
  "projection-prior-applies-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Projection prior applies invalid.", "facts": {"issueCount": "uint"}},
  "projection-ambiguous-ownership": {"code": "AC_PRECONDITION_FAILED", "message": "Projection ownership is ambiguous. Review the listed paths; remove unvouched whole-file outputs from Git and reapply explicitly. Use docs drift to inspect the complete output list when diagnostics are omitted.", "facts": {"pathCount": "uint", "paths": "optional:diagnosticPaths", "action": "ownershipAction", "commands": "optional:diagnosticCommands", "omittedPathCount": "uint", "omittedCommandCount": "uint"}},

  "changeset-recovery-unresolved": {"code": "AC_PRECONDITION_FAILED", "message": "changeset-recovery-unresolved: startup journals require repair; inspect the complete recovery authority and restart archctxd to retry recovery.", "journalRecovery": true},
  "apply-input-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Apply input invalid.", "facts": {}},
  "apply-approval-required": {"code": "AC_USER_CONFIRMATION_REQUIRED", "message": "Review the ChangeSet preview, then apply explicitly with approved: true (CLI: --approved).", "facts": {}},
  "apply-repository-mismatch": {"code": "AC_PRECONDITION_FAILED", "message": "ChangeSet was planned for a different repository.", "facts": {}},
  "apply-draft-missing": {"code": "AC_PRECONDITION_FAILED", "message": "Unknown ChangeSet; create a new plan before applying.", "facts": {"changeSetId": "id"}},
  "apply-profile-missing": {"code": "AC_PRECONDITION_FAILED", "message": "ChangeSet worktree digest profile missing before apply.", "facts": {}},
  "apply-profile-changed": {"code": "AC_PRECONDITION_FAILED", "message": "ChangeSet worktree digest profile changed before apply.", "facts": {}},
  "apply-worktree-changed": {"code": "AC_PRECONDITION_FAILED", "message": "Worktree digest changed before apply.", "facts": {"expectedWorktreeDigest": "sha256", "actualWorktreeDigest": "sha256"}},
  "apply-head-changed": {"code": "AC_PRECONDITION_FAILED", "message": "ChangeSet HEAD changed before apply.", "facts": {"expectedHeadSha": "head", "actualHeadSha": "head"}},
  "apply-model-invalid": {"code": "AC_PRECONDITION_FAILED", "message": "ChangeSet base model is invalid.", "facts": {"issueCount": "uint"}},
  "apply-model-changed": {"code": "AC_PRECONDITION_FAILED", "message": "ChangeSet model digest changed before apply.", "facts": {"expectedModelDigest": "sha256", "actualModelDigest": "sha256"}},
  "apply-preimage-changed": {"code": "AC_PRECONDITION_FAILED", "message": "Projection preimage changed before apply.", "facts": {"issueCount": "uint"}},
  "projection-input-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Projection input invalid.", "facts": {}},
  "projection-approval-required": {"code": "AC_USER_CONFIRMATION_REQUIRED", "message": "Review the projection request, then call again with approved: true.", "facts": {}},
  "waiver-owner-registry-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Practice waiver owner registry invalid.", "facts": {}},
  "waiver-input-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Practice waiver input invalid.", "facts": {}},
  "worktree-claim-required": {"code": "AC_REFACTOR_STALE", "message": "This operation requires expectedWorktreeDigest.", "facts": {}},
  "worktree-claim-changed": {"code": "AC_REFACTOR_STALE", "message": "Worktree digest changed before this operation.", "facts": {"expectedWorktreeDigest": "sha256", "actualWorktreeDigest": "sha256"}},
  "accept-committed-worktree-changed": {"code": "AC_PRECONDITION_FAILED", "message": "Accepted ChangeSet expected worktree digest mismatch.", "facts": {"expectedWorktreeDigest": "sha256", "actualWorktreeDigest": "sha256"}},
  "accept-committed-plan-changed": {"code": "AC_PRECONDITION_FAILED", "message": "Accepted ChangeSet acceptance plan changed since preview.", "facts": {"expectedPlanDigest": "sha256", "actualPlanDigest": "sha256"}},
  "accept-committed-readback-failed": {"code": "AC_PRECONDITION_FAILED", "message": "Committed ChangeSet acceptance readback failed.", "facts": {}},
  "accept-committed-event-conflict": {"code": "AC_PRECONDITION_FAILED", "message": "Committed ChangeSet already has a different acceptance event at this snapshot.", "facts": {}},
  "accept-committed-append-failed": {"code": "AC_PRECONDITION_FAILED", "message": "Committed ChangeSet acceptance event was not appended.", "facts": {}},
  "runtime-not-running": {"code": "AC_PRECONDITION_FAILED", "message": "archctxd is not running.", "facts": {}},
  "runtime-writer-locked": {"code": "AC_PRECONDITION_FAILED", "message": "Runtime writer is locked.", "facts": {}},
  "runtime-ledger-mode-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Runtime architecture ledger mode invalid.", "facts": {"field": "ledgerModeField"}},
  "runtime-writer-owned": {"code": "AC_PRECONDITION_FAILED", "message": "local-store-writer-owned: another live process owns this store.", "facts": {}},
  "rpc-input-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Runtime RPC input invalid.", "facts": {}},
  "rpc-method-invalid": {"code": "AC_SCHEMA_INVALID", "message": "Unknown runtime RPC method. Upgrade the client.", "facts": {}, "action":"upgrade-client"},
  "changeset-rollback-conflict": {code: "AC_PRECONDITION_FAILED", message: "ChangeSet rollback is incomplete because the projection manifest changed externally. Preserve the pending journal and backup for manual recovery.", facts: {journalId: "optional:id", changeSetId: "id", manualRecoveryRequired: "boolean"}},
  "deps-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Deps input invalid.","facts": {"field":"optional:depsField","issue":"optional:depsIssue"}},
  "deps-workspace-invalid": {"code": "AC_SCHEMA_INVALID","message": "Deps workspace invalid.","facts": {}},
  "deps-model-unreadable": {"code": "AC_MODEL_ADOPTION_REQUIRED","message": "Deps model unreadable.","facts": {}},
  "code-facts-unavailable": {"code": "AC_CODE_FACTS_UNAVAILABLE","message": "Code facts unavailable.","facts": {}},
  "projection-check-mode-invalid": {"code": "AC_SCHEMA_INVALID","message": "Projection check mode invalid.","facts": {}},
  "projection-check-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Projection check input invalid. Supply valid fields and keep lists sorted and unique.","facts": {}},
  "projection-snapshot-mismatch": {"code": "AC_PRECONDITION_FAILED","message": "Projection snapshot mismatch.","facts": {"field":"optional:snapshotField"}},
  "changed-path-outside-worktree": {"code": "AC_SCHEMA_INVALID","message": "Changed path outside worktree.","facts": {}},
  "changed-path-not-normalized": {"code": "AC_SCHEMA_INVALID","message": "Changed path not normalized.","facts": {}},
  "projection-result-invalid": {"code": "AC_SCHEMA_INVALID","message": "Projection result invalid.","facts": {}},
  "repository-not-registered": {"code": "AC_REPO_NOT_FOUND","message": "Repository not registered.","facts": {}},
  "landscape-invalid": {"code": "AC_SCHEMA_INVALID","message": "Landscape invalid.","facts": {}},
  "landscape-repositories-required": {"code": "AC_PRECONDITION_FAILED","message": "Landscape repositories required.","facts": {},"action": "archctx repo add"},
  "docs-provider-invalid": {"code": "AC_SCHEMA_INVALID","message": "Docs provider invalid.","facts": {}},
  "docs-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Docs input invalid.","facts": {}},
  "docs-network-authorization-required": {"code": "AC_SCHEMA_INVALID","message": "Docs network authorization required. Pass --allow-network to opt in.","facts": {}},
  "docs-pin-required": {"code": "AC_SCHEMA_INVALID","message": "Docs pin required.","facts": {}},
  "docs-command-invalid": {"code": "AC_SCHEMA_INVALID","message": "Docs command invalid.","facts": {}},
  "resource-uri-invalid": {"code": "AC_SCHEMA_INVALID","message": "Resource uri invalid.","facts": {}},
  "resource-cache-miss": {"code": "AC_SCHEMA_INVALID","message": "Resource cache miss.","facts": {}},
  "explorer-query-invalid": {"code": "AC_SCHEMA_INVALID","message": "Explorer query invalid.","facts": {}},
  "explorer-precondition-failed": {"code": "AC_PRECONDITION_FAILED","message": "Explorer precondition failed.","facts": {"inputDomain":"optional:observedDomain","availability":"optional:inputAvailability","cause":"optional:unclassifiedCause"}},
  "invalid-delta-query": {"code": "AC_SCHEMA_INVALID","message": "Invalid delta query.","facts": {}},
  "projection-cache-miss": {"code": "AC_PRECONDITION_FAILED","message": "Projection cache miss.","facts": {}},
  "authority-event-missing": {"code": "AC_PRECONDITION_FAILED","message": "Authority event missing.","facts": {}},
  "authority-cursor-reversed": {"code": "AC_PRECONDITION_FAILED","message": "Authority cursor reversed.","facts": {}},
  "projection-authority-mismatch": {"code": "AC_PRECONDITION_FAILED","message": "Projection authority mismatch.","facts": {}},
  "projection-manifest-incompatible": {"code": "AC_PRECONDITION_FAILED","message": "Projection manifest incompatible.","facts": {}},
  "practice-catalog-invalid": {"code": "AC_SCHEMA_INVALID","message": "Practice catalog invalid.","facts": {}},
  "practice-not-found": {"code": "AC_SCHEMA_INVALID","message": "Practice not found.","facts": {}},
  "practice-command-invalid": {"code": "AC_SCHEMA_INVALID","message": "Practice command invalid.","facts": {}},
  "production-injections-refused": {"code": "AC_SCHEMA_INVALID","message": "Production injections refused.","facts": {"issueCount": "uint"}},
  "plan-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Plan input invalid.","facts": {}},
  "plan-worktree-changed": {"code": "AC_PRECONDITION_FAILED","message": "Plan worktree changed.","facts": {"expectedWorktreeDigest": "sha256","actualWorktreeDigest": "sha256"}},
  "accept-committed-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Accept committed input invalid.","facts": {}},
  "accept-committed-authority-required": {"code": "AC_PRECONDITION_FAILED","message": "Accept committed authority required.","facts": {}},
  "ledger-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Ledger input invalid.","facts": {}},
  "book-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Book input invalid.","facts": {}},
  "recommendations-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Recommendations input invalid.","facts": {}},
  "recommendation-snapshot-changed": {"code": "AC_REFACTOR_STALE","message": "Recommendation snapshot changed.","facts": {"recommendationId": "id","changedFields": "changedFields"}},
  "recommendation-decision-invalid": {"code": "AC_PRECONDITION_FAILED","message": "Recommendation decision invalid.","facts": {}},
  "refactor-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Refactor input invalid.","facts": {}},
  "refactor-assessment-missing": {"code": "AC_SCHEMA_INVALID","message": "Refactor assessment missing.","facts": {"assessmentDigest": "sha256"}},
  "refactor-assessment-stale": {"code": "AC_REFACTOR_STALE","message": "Refactor assessment stale.","facts": {"assessmentDigest": "sha256","expectedHeadSha": "head","actualHeadSha": "head","expectedWorktreeDigest": "sha256","actualWorktreeDigest": "sha256"}},
  "refactor-proposal-unauthored": {"code": "AC_REFACTOR_PROPOSAL_UNAUTHORED","message": "Refactor proposal unauthored.","facts": {"issueCount": "uint"}},
  "refactor-invariant-invalid": {"code": "AC_SCHEMA_INVALID","message": "Refactor invariant invalid.","facts": {"issueCount": "uint"}},
  "refactor-namespace-changed": {"code": "AC_REFACTOR_STALE","message": "Refactor namespace changed.","facts": {"assessmentDigest": "sha256","expectedNamespace": "id","actualNamespace": "id"}},
  "refactor-record-snapshot-changed": {"code": "AC_REFACTOR_STALE","message": "Refactor record snapshot changed.","facts": {"assessmentDigest": "sha256","changedFields": "changedFields"}},
  "refactor-head-mismatch": {"code": "AC_REFACTOR_STALE","message": "Refactor head mismatch.","facts": {"recommendationId": "id","expectedHeadSha": "head","actualHeadSha": "head"}},
  "refactor-recommendation-missing": {"code": "AC_SCHEMA_INVALID","message": "Refactor recommendation missing.","facts": {"recommendationId": "id"}},
  "refactor-verify-snapshot-changed": {"code": "AC_REFACTOR_STALE","message": "Refactor verify snapshot changed.","facts": {"recommendationId": "id","changedFields": "changedFields"}},
  "refactor-decision-approval-required": {"code": "AC_USER_CONFIRMATION_REQUIRED","message": "Refactor decision approval required.","facts": {"recommendationId": "id"}},
  "jobs-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Jobs input invalid.","facts": {"field":"optional:jobsField"}},
  "job-running-required": {"code": "AC_PRECONDITION_FAILED","message": "Job running required.","facts": {"jobId": "id"}},
  "job-context-stale": {"code": "AC_CONTEXT_STALE","message": "Job context stale.","facts": {"jobId": "id","expectedHeadSha": "head","actualHeadSha": "head","expectedWorktreeDigest": "sha256","actualWorktreeDigest": "sha256"}},
  "audit-disabled": {"code": "AC_CAPABILITY_UNSUPPORTED","message": "Audit disabled.","facts": {}},
  "audit-active": {"code": "AC_PRECONDITION_FAILED","message": "Audit active.","facts": {}},
  "audit-claim-failed": {"code": "AC_PRECONDITION_FAILED","message": "Audit claim failed.","facts": {"jobId": "id"}},
  "audit-run-missing": {"code": "AC_REPO_NOT_FOUND","message": "Audit run missing.","facts": {"runId": "id"}},
  "audit-run-failed": {"code": "AC_PRECONDITION_FAILED","message": "Audit run failed.","facts": {"runId": "id"}},
  "audit-already-issuing": {"code": "AC_PRECONDITION_FAILED","message": "Audit already issuing.","facts": {"runId": "id"}},
  "audit-proposal-invalid": {"code": "AC_SCHEMA_INVALID","message": "Audit proposal invalid.","facts": {"runId": "id"}},
  "audit-drafts-required": {"code": "AC_PRECONDITION_FAILED","message": "Audit drafts required.","facts": {"runId": "id"}},
  "audit-confirmation-required": {"code": "AC_USER_CONFIRMATION_REQUIRED","message": "Review the public repository target, then use archctx audit approve with --confirm-public-repo and the complete confirmationToken.","facts": {"runId": "id", "confirmationToken": "publicConfirmationToken"}},
  "audit-preflight-refused": {"code": "AC_PRECONDITION_FAILED","message": "Audit preflight refused.","facts": {"runId": "id"}},
  "audit-github-refused": {"code": "AC_PRECONDITION_FAILED","message": "Audit github refused.","facts": {"runId": "id"}},
  "hook-input-invalid": {"code": "AC_SCHEMA_INVALID","message": "Hook input invalid.","facts": {}},
  "runtime-agent-job-out-of-scope": {"code": "AC_PRECONDITION_FAILED","message": "Runtime agent job out of scope.","facts": {"jobId": "id"}},
  "audit-user-consent-required": {"code": "AC_USER_CONFIRMATION_REQUIRED","message": "Audit user consent required.","facts": {"consentReason": "consentReason"}},
  "recommendation-not-found": {"code": "AC_REFACTOR_STALE","message": "Recommendation not found.","facts": {"recommendationId": "id","searched": "searched"}},
  "git-decision-subject-not-observed": {"code": "AC_REFACTOR_STALE","message": "Git decision subject not observed.","facts": {"recommendationId": "id"}},
  "scan-candidate-not-recorded": {"code": "AC_REFACTOR_STALE","message": "Scan candidate not recorded.","facts": {"recommendationId": "id"}},
  "ledger-audit-generation": {"code": "AC_REFACTOR_STALE","message": "Ledger audit generation.","facts": {"currentRecommendationId": "id","currentRecorded": "boolean"}},
  "git-decision-not-recorded": {"code": "AC_REFACTOR_EVIDENCE_REQUIRED","message": "Git decision not recorded.","facts": {"recommendationId": "id","decisionStatus": "decisionStatus", "recordCommand": "commandSuggestion", "verifyCommand": "commandSuggestion"}},
  "recommendation-v2-not-migrated": {"code": "AC_PRECONDITION_FAILED","message": "Recommendation v2 not migrated.","facts": {"recommendationId": "id"}},
  "evidence-digest-missing": {"code": "AC_REFACTOR_EVIDENCE_REQUIRED","message": "Evidence digest missing.","facts": {"recommendationId": "id"}},
  "evidence-unknown": {"code": "AC_REFACTOR_EVIDENCE_REQUIRED","message": "Evidence unknown.","facts": {"recommendationId": "id","evidenceDigest": "sha256"}},
  "evidence-head-drift": {"code": "AC_REFACTOR_STALE","message": "Evidence head drift.","facts": {"recommendationId": "id","evidenceDigest": "sha256","expectedHeadSha": "head","actualHeadSha": "head", "expectedWorktreeDigest": "optional:sha256", "actualWorktreeDigest": "optional:sha256", "changedFields": "optional:changedFields", "observation": "optional:evidenceObservation"}},
  "evidence-worktree-drift": {"code": "AC_REFACTOR_STALE","message": "Evidence worktree drift.","facts": {"recommendationId": "id","evidenceDigest": "sha256","expectedWorktreeDigest": "sha256","actualWorktreeDigest": "sha256"}},
  "evidence-not-resolved": {"code": "AC_REFACTOR_EVIDENCE_REQUIRED","message": "Evidence not resolved.","facts": {"recommendationId": "id","evidenceDigest": "sha256","disposition": "disposition"}},
  "refactor-run-exceeds-ledger-size-limit": {"code": "AC_REFACTOR_RUN_TOO_LARGE","message": "Refactor run exceeds ledger size limit.","facts": {"measuredBytes": "uint","limitBytes": "uint"}},
  "product-id-missing": {"code": "AC_MODEL_ADOPTION_REQUIRED","message": "Product id missing.","facts": {}},
  "product-id-invalid": {"code": "AC_SCHEMA_INVALID","message": "Product id invalid.","facts": {}},
  "refactor-decision-invalid": {"code": "AC_SCHEMA_INVALID","message": "Refactor decision invalid.","facts": {}},
  "context7-provider-refused": {"code": "AC_SCHEMA_INVALID","message": "Context7 provider refused.","facts": {"kind": "context7Kind"}},
  "native-context-arguments-invalid": {"code": "AC_SCHEMA_INVALID","message": "native-context-arguments-invalid","facts": {"flag": "diagnostic","category": "diagnostic","supportedFormat": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-profile-invalid": {"code": "AC_SCHEMA_INVALID","message": "native-context-profile-invalid","facts": {"supportedProfile": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-model-missing": {"code": "AC_MODEL_ADOPTION_REQUIRED","message": "native-context-model-missing","facts": {"path": "diagnostic","category": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-model-invalid": {"code": "AC_SCHEMA_INVALID","message": "native-context-model-invalid","facts": {"path": "diagnostic","invariant": "diagnostic","issues": "issues","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-budget-invalid": {"code": "AC_SCHEMA_INVALID","message": "native-context-budget-invalid","facts": {"path": "diagnostic","field": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-profile-incomplete": {"code": "AC_SCHEMA_INVALID","message": "native-context-profile-incomplete","facts": {"nodeId": "diagnostic","field": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-text-invalid": {"code": "AC_SCHEMA_INVALID","message": "native-context-text-invalid","facts": {"path": "diagnostic","encoding": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-input-ambiguous": {"code": "AC_SCHEMA_INVALID","message": "native-context-input-ambiguous","facts": {"path": "diagnostic","branch": "diagnostic","key": "diagnostic","offset": "uint","omittedKeyCharacters": "uint","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-path-unsafe": {"code": "AC_PATH_DENIED","message": "native-context-path-unsafe","facts": {"path": "diagnostic","category": "diagnostic","issues": "issues","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input-path","retryable": false},
  "native-context-entry-kind-unsupported": {"code": "AC_PATH_DENIED","message": "native-context-entry-kind-unsupported","facts": {"path": "diagnostic","mode": "diagnostic","kind": "diagnostic","category": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input-path","retryable": false},
  "native-context-ref-unsafe": {"code": "AC_PATH_DENIED","message": "native-context-ref-unsafe","facts": {"selector": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input-path","retryable": false},
  "native-context-ref-unavailable": {"code": "AC_PRECONDITION_FAILED","message": "native-context-ref-unavailable","facts": {"selector": "diagnostic","category": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-blob-unavailable": {"code": "AC_PRECONDITION_FAILED","message": "native-context-blob-unavailable","facts": {"category": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-input-missing": {"code": "AC_PRECONDITION_FAILED","message": "native-context-input-missing","facts": {"path": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-input-unreadable": {"code": "AC_PRECONDITION_FAILED","message": "native-context-input-unreadable","facts": {"path": "diagnostic","category": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-input-changed": {"code": "AC_PRECONDITION_FAILED","message": "native-context-input-changed","facts": {"category": "diagnostic","changedPaths": "diagnosticList","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "rerun-native-export","retryable": true},
  "native-document-marker-invalid": {"code": "AC_SCHEMA_INVALID","message": "native-document-marker-invalid","facts": {"path": "diagnostic","targetId": "diagnostic","diagnostics": "diagnostics","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-document-section-ambiguous": {"code": "AC_SCHEMA_INVALID","message": "native-document-section-ambiguous","facts": {"path": "diagnostic","targetId": "diagnostic","section": "diagnostic","headingCount": "uint","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false},
  "native-context-limit-exceeded": {"code": "AC_PRECONDITION_FAILED","message": "native-context-limit-exceeded","facts": {"limit": "diagnostic","maximum": "uint","observed": "uint","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "reduce-native-input-size","retryable": false},
  "native-context-git-read-failed": {"code": "AC_PRECONDITION_FAILED","message": "native-context-git-read-failed","facts": {"operation": "diagnostic","category": "diagnostic","omittedDiagnosticCount": "uint","omittedDiagnosticCharacters": "uint"},"native": true,"action": "repair-native-input","retryable": false}
} as Record<string, Policy>);
Object.assign(policies, {
  "refactor-scan-invalid": {code: "AC_SCHEMA_INVALID", message: "The refactor scan could not produce a valid assessment.", facts: {}},
  "refactor-model-unreadable": {code: "AC_MODEL_ADOPTION_REQUIRED", message: "The refactor scan requires a readable adopted model.", facts: {}},
  "refactor-request-head-changed": {code: "AC_REFACTOR_STALE", message: "The requested HEAD differs from the measured HEAD.", facts: {expectedHeadSha: "head", actualHeadSha: "head"}},
  "refactor-request-worktree-changed": {code: "AC_REFACTOR_STALE", message: "The requested worktree differs from the measured worktree.", facts: {expectedWorktreeDigest: "sha256", actualWorktreeDigest: "sha256"}},
  "refactor-measurement-changed": {"code": "AC_REFACTOR_STALE","facts": {"changedFields": "changedFields"},"message": "Refactor measurement changed."},
  "audit-issue-list-inconclusive": {"code": "AC_PRECONDITION_FAILED","facts": {"runId": "id"},"message": "Audit issue list inconclusive."},
  "audit-issue-create-inconclusive": {"code": "AC_PRECONDITION_FAILED","facts": {"runId": "id","draftId": "id"},"message": "Audit issue create inconclusive."}
} as Record<string, Policy>);
Object.assign(policies, {
  "projection-accepted-change-committed": {code: "AC_PROJECTION_APPLY_COMMITTED", recovery: true, message: "This accepted change is already committed. When available, send error.details.readbackRequest unchanged to projection readback; use the original identities for explicit recovery."},
  "projection-apply-request-differs": {code: "AC_PROJECTION_APPLY_COMMITTED", recovery: true, message: "This requestId already committed a different request. Use a new requestId for new work; read back the committed result with error.details.readbackRequest when available."},
  "projection-apply-request-digest-unrecorded": {code: "AC_PROJECTION_APPLY_COMMITTED", recovery: true, message: "This requestId committed before request digests were recorded and cannot be reused. Use a new requestId for new work. Use error.details.readbackRequest when available; otherwise inspect the original receipt manually."},
  "projection-apply-committed-manual-only": {code: "AC_PROJECTION_APPLY_COMMITTED", recovery: true, message: "This apply is committed. Its complete readback metadata exceeds the details budget. Automatic restore and replay are refused; inspect the original receipt using the complete lookupKey and verify applyId for manual maintenance."},
  "projection-apply-recovery-metadata-too-large": {code: "AC_PRECONDITION_FAILED", facts: {measuredBytes: "uint", limitBytes: "uint"}, message: "The final projection recovery metadata exceeds its byte budget. Reduce the accepted change or changed paths before applying; no business write was started."}
} as Record<string, Policy>);
for (const policy of Object.values(policies)) {
  if (policy.facts) { policy.fields = Object.freeze(Object.keys(policy.facts)); Object.freeze(policy.facts); }
  if (policy.fields) Object.freeze(policy.fields);
  Object.freeze(policy);
}
export const FAILURE_POLICIES: Readonly<Record<string, Readonly<Policy>>> = Object.freeze(policies);
const catalogDefaults = Object.fromEntries(Object.entries(ERROR_CATALOG).map(([code, value]) => [code, Object.freeze({ severity: value.severity, retryable: value.retryable, action: value.action })])) as Readonly<Record<ArchContextErrorCode, Readonly<Pick<StrictFailure, "severity" | "retryable" | "action">>>>;
const actions = new Set([...Object.values(catalogDefaults).map(value => value.action), "correct-command-arguments", "inspect-diagnostics", "reconcile-before-retry", "install-compatible-codegraph", ...Object.values(policies).flatMap(policy => policy.action ? [policy.action] : [])]);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finiteNonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const criticalKey = (key: string) => /id$|digest|receipt|binding|readback|lookupkey/i.test(key);
/** Read a single own data value without executing accessors or accepting prototype metadata. */
function ownData(input: unknown, key: string): unknown {
  if (!record(input)) throw new Error("Failure metadata must be an object");
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) {
    if (key in input) throw new Error("Failure metadata must use own data properties");
    return undefined;
  }
  if (!("value" in descriptor)) throw new Error("Failure metadata cannot use accessors");
  return descriptor.value;
}

function fact(key: string, value: unknown): Json | undefined {
  if (key === "stage") return typeof value === "string" && (FAILURE_STAGES as readonly string[]).includes(value) ? value : undefined;
  if (key === "checks") {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 32) return undefined;
    const checks: string[] = [];
    for (let index = 0; index < length; index++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(index));
      if (!entry || !("value" in entry) || (entry.value !== "ownership" && entry.value !== "anchors")) return undefined;
      checks.push(entry.value);
    }
    return checks;
  }
  if (key === "issueCount") return finiteNonnegative(value) && Number.isSafeInteger(value) ? value : undefined;
  if (key === "method") return typeof value === "string" && ["health", "practiceCheckpoint", "completeTask"].includes(value) ? value : undefined;
  if (key === "timeoutMs" || key === "elapsedMs") return finiteNonnegative(value) ? value : undefined;
  if (key === "mutationOutcome") return value === "unknown" ? value : undefined;
  return undefined;
}
function detailsFor(policy: Policy, input: unknown): { [key: string]: Json } {
  if (policy.native) return nativeFactsFor(policy, input);
  if (policy.facts) return localFactsFor(policy.facts, input);
  const result: { [key: string]: Json } = {};
  if (!record(input)) throw new Error("Failure details must be an object");
  let omitted = 0;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
    if (criticalKey(key)) throw new Error("Failure metadata contains an unsupported critical binding");
    if (key === "omittedCount" && policy.code !== "AC_UNCLASSIFIED_FAILURE" && finiteNonnegative(descriptor.value) && Number.isSafeInteger(descriptor.value)) {
      omitted += descriptor.value;
      continue;
    }
    if (key === "stage" || policy.fields?.includes(key)) {
      const value = "value" in descriptor ? fact(key, descriptor.value) : undefined;
      if (value !== undefined) { result[key] = value; continue; }
    }
    // Unknown compound facts may hide an essential recovery binding. Refuse without traversing caller data.
    if ("value" in descriptor && descriptor.value !== null && typeof descriptor.value === "object") throw new Error("Failure metadata contains an unsupported compound fact");
    omitted++;
  }
  if (omitted > 0 && policy.code !== "AC_UNCLASSIFIED_FAILURE") result.omittedCount = Math.min(omitted, 1_000_000);
  return result;
}

/** Closed C1 facts retain complete bindings. Unsupported compound/critical fields never disappear. */
function dataRecord(value: unknown): Record<string, PropertyDescriptor> {
  if (!record(value)) throw new Error("Facts must be a plain record");
  const proto = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
  if ((proto !== Object.prototype && proto !== null) || keys.length > 16 || Object.keys(value).length !== keys.length || keys.some(key => typeof key !== "string")) throw new Error("Facts violate plain own-data contract");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.values(fields).some(field => !("value" in field))) throw new Error("Facts cannot use accessors");
  return fields;
}
const localEnums: Readonly<Record<string, readonly string[]>> = {
  reviewWorktreeRefusal: ["UNKNOWN","HEAD_UNAVAILABLE","HEAD_SHA_MISMATCH","TREE_OID_MISMATCH","WORKTREE_NOT_DETACHED","WORKTREE_NOT_CLEAN"],
  reviewOwnershipRefusal: ["persisted-manifest-missing","persisted-manifest-identity-mismatch","run-id","manifest-path","lock-path","persisted-manifest-mismatch","persisted-lock-mismatch","run-root-name","worktree-temp-root","codegraph-temporary-state-root","run-root-not-a-directory","run-root-owner-marker-missing","run-root-owner-marker-mismatch","worktree-temporary-root","worktree-root","worktree-source-root"],
  projectionInputField: ["headSha","worktreeDigest","sourceFiles"],
  upgradeAction: ["upgrade-archctx-runtime"],
  upgradeCommand: ["archctx daemon upgrade"],
  ownershipAction: ["remove-whole-file-outputs-and-reapply"],
  ledgerModeField: ["rolloutMode","readMode","writeMode"],
  depsField: ["from", "into", "importNodeLimit", "edgeLimit"],
  depsIssue: ["unknown-node", "invalid-limit", "missing-value"],
  snapshotField: ["repositoryId", "workspaceId", "headSha", "worktreeDigest"],
  jobsField: ["workerId"],
  observedDomain: ["observed"],
  inputAvailability: ["unavailable"],
  unclassifiedCause: ["unclassified"],
  evidenceObservation: ["before-resolve-append"],
  "searched": [
    "recorded",
    "recorded-or-scanned"
  ],
  "decisionStatus": [
    "acknowledged",
    "accepted",
    "deferred",
    "rejected",
    "resolved",
    "waived"
  ],
  "disposition": [
    "not_improved",
    "partially_resolved",
    "regressed",
    "resolved",
    "stale"
  ],
  "consentReason": [
    "not-granted",
    "unreadable",
    "repository-mismatch",
    "origin-mismatch",
    "egress-policy-changed"
  ],
  "context7Kind": [
    "http-error",
    "timeout",
    "rate-limited",
    "malformed",
    "transport-error",
    "circuit-open"
  ]
};
function localFactValue(rule: string, value: unknown): Json {
  if (rule === "codeFactsIssues") {
    if (!Array.isArray(value)) throw new Error("Code facts issues must be a list");
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 1 || length > 32 || Reflect.ownKeys(value).length !== length + 1) throw new Error("Code facts issues exceed their closed budget");
    return Array.from({ length }, (_, index) => {
      const entry = Object.getOwnPropertyDescriptor(value, String(index));
      if (!entry || !("value" in entry)) throw new Error("Code facts issues must use own data");
      const fields = dataRecord(entry.value);
      const code = fields.code?.value, message = fields.message?.value;
      if (Object.keys(fields).length !== 2 || typeof code !== "string" || !Object.hasOwn(CODE_FACTS_ISSUE_MESSAGES, code)
        || message !== CODE_FACTS_ISSUE_MESSAGES[code as keyof typeof CODE_FACTS_ISSUE_MESSAGES]) throw new Error("Unknown code facts diagnostic");
      return { code, message };
    });
  }
  if (rule === "commandSuggestion" && (value === null || (typeof value === "string" && bytes(value) <= 1024 && /^archctx (recommendations |refactor verify )[^\r\n]*$/.test(value)))) return value;
  if (rule === "publicConfirmationToken" && typeof value === "string" && bytes(value) <= 1024 && /^public:github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+:[a-f0-9]{40}:[A-Za-z0-9_.:-]+$/.test(value)) return value;
  if (rule === "diagnosticPaths" || rule === "diagnosticCommands") {
    if (!Array.isArray(value)) throw new Error("Diagnostics must be an own list");
    const length=Object.getOwnPropertyDescriptor(value,"length")?.value;
    if (!Number.isSafeInteger(length) || length > (rule === "diagnosticPaths" ? 8 : 2) || Reflect.ownKeys(value).length!==length+1) throw new Error("Diagnostics exceed their closed budget");
    return Array.from({length},(_,index)=>{const field=Object.getOwnPropertyDescriptor(value,String(index));if(!field || !("value" in field) || typeof field.value!=="string" || bytes(field.value)>(rule === "diagnosticPaths" ? 256 : 1024)) throw new Error("Invalid diagnostic");return field.value;});
  }
  if (rule === "boolean" && typeof value === "boolean") return value;
  if (rule === "uint" && finiteNonnegative(value) && Number.isSafeInteger(value)) return value;
  if (rule === "changedFields") {
    if (!Array.isArray(value)) throw new Error("Changed fields must be a list");
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length > 2 || Reflect.ownKeys(value).length !== length + 1) throw new Error("Changed fields exceed schema");
    return Array.from({length}, (_, index) => {
      const field = Object.getOwnPropertyDescriptor(value, String(index));
      if (!field || !("value" in field) || (field.value !== "headSha" && field.value !== "worktreeDigest")) throw new Error("Changed field is invalid");
      return field.value;
    });
  }
  if (rule === "rpcVersion" && typeof value === "string" && bytes(value) <= 256 && (value === "unknown" || /^archcontext\.runtime-rpc\/v[0-9]+$/.test(value))) return value;
  if (typeof value === "string" && bytes(value) <= 256) {
    if (rule === "id" && value.length > 0) return value;
    if (rule === "sha256" && /^sha256:[a-f0-9]{64}$/.test(value)) return value;
    if (rule === "head" && /^[a-f0-9]{40}$/.test(value)) return value;
    if (localEnums[rule]?.includes(value)) return value;
  }
  throw new Error("Fact violates its closed schema");
}
function localFactsFor(schema: Readonly<Record<string, string>>, input: unknown): {[key: string]: Json} {
  const fields = dataRecord(input), result: {[key: string]: Json} = {};
  let omitted = 0;
  for (const [key, rule] of Object.entries(schema)) {
    const optional = rule.startsWith("optional:");
    if (!Object.hasOwn(fields, key)) { if (optional) continue; throw new Error("Required fact is absent"); }
    result[key] = localFactValue(optional ? rule.slice("optional:".length) : rule, fields[key].value);
  }
  for (const [key, field] of Object.entries(fields)) {
    if (Object.hasOwn(schema, key)) continue;
    if (key === "omittedCount" && finiteNonnegative(field.value) && Number.isSafeInteger(field.value)) { omitted += field.value; continue; }
    if (criticalKey(key) || (field.value !== null && typeof field.value === "object")) throw new Error("Unsupported critical or compound fact");
    omitted++;
  }
  if (omitted) result.omittedCount = Math.min(omitted, 1_000_000);
  return result;
}
const nativeEnums: Readonly<Record<string, readonly string[]>> = {
  "category": [
    "unknown-flag",
    "unexpected-positional",
    "timeout",
    "unavailable",
    "ambiguous",
    "ambiguous-tree-path",
    "descriptor-content",
    "descriptor-identity",
    "duplicate",
    "exactly-one-selector-required",
    "export-read",
    "filesystem-path-alias",
    "gitlink",
    "head-or-tree",
    "input-digest",
    "input-identity",
    "invalid-metadata-size",
    "invalid-oid",
    "invalid-request-oid",
    "invalid-size",
    "invalid-tree-oid",
    "link",
    "malformed-header",
    "malformed-record",
    "metadata-count-mismatch",
    "metadata-size-mismatch",
    "missing-header",
    "missing-object-or-metadata-mismatch",
    "missing-terminator",
    "missing-value",
    "model-layout",
    "model-membership",
    "model-path-encoding",
    "nested-repository",
    "no-native-nodes",
    "non-regular",
    "object-content-mismatch",
    "oid-or-type-mismatch",
    "open-or-read",
    "path-encoding-or-alias",
    "path-identity",
    "path-presence-or-identity",
    "repository-boundary-stat",
    "second-observation-invalid",
    "size-mismatch",
    "stat",
    "tree-unavailable",
    "truncated-body-or-terminator",
    "unexpected-trailing-bytes",
    "unsupported-operation",
    "unsupported-read-arguments",
    "windows-path-alias"
  ],
  "field": [
    "$",
    "extensions.contractFiles",
    "extensions.lspProfile",
    "extensions.verification",
    "identity-or-contractFiles",
    "layout-target-identity",
    "runtime.contextBudgetBytes"
  ],
  "encoding": [
    "utf-8"
  ],
  "section": [
    "section3",
    "backlog"
  ],
  "selector": [
    "ref"
  ],
  "supportedProfile": ["repo-harness/v1"],
  "supportedFormat": [
    "json"
  ],
  "operation": [
    "rev-parse",
    "ls-tree",
    "ls-files",
    "cat-file"
  ],
  "limit": [
    "batch-response-bytes",
    "batchOverheadBytes",
    "fileBytes",
    "git-read-output",
    "gitTimeoutMs",
    "inputBytes",
    "inputFiles",
    "responseBytes",
    "treeListingBytes"
  ],
  "kind": [
    "marker-syntax-or-attributes",
    "marker-nested",
    "marker-duplicate",
    "marker-unmatched-end",
    "marker-target-mismatch",
    "marker-unmatched-begin",
    "unexpected-target",
    "unsupported-renderer",
    "output-digest-mismatch"
  ]
};
const nativeDiagnosticKinds = new Set(nativeEnums.kind);
/** Native fields are diagnostics, not recovery authority. Omit complete items, never truncate an ID. */
function nativeFactsFor(policy: Policy, input: unknown): {[key: string]: Json} {
  const fields = dataRecord(input), result: {[key: string]: Json} = {};
  let omitted = 0, characters = 0;
  const omit = (value: Json) => {
    omitted++;
    const strings = (v: Json): number => typeof v === "string" ? v.length : Array.isArray(v) ? v.reduce<number>((n, item) => n + strings(item), 0) : record(v) ? Object.values(v).reduce<number>((n, item) => n + strings(item as Json), 0) : 0;
    characters += strings(value);
  };
  const text = (value: unknown): string => { if (typeof value !== "string") throw new Error("Native diagnostic must be a primitive string"); return value; };
  const snapshotItem = (value: unknown, type: string): Json | undefined => {
    if (type === "diagnostic") { const s = text(value); if (bytes(s) > 256) { omit(s); return undefined; } return s; }
    const item = dataRecord(value);
    if (type === "issues") {
      if (!["entityId", "field", "invariant"].every(key => Object.hasOwn(item, key)) || Object.keys(item).some(key => !["entityId", "field", "invariant", "path"].includes(key))) throw new Error("Native issue schema is invalid");
      const clean = Object.fromEntries(Object.entries(item).map(([key, data]) => [key, text(data.value)]));
      if (Object.values(clean).some(v => bytes(v) > 256)) { omit(clean); return undefined; }
      return clean;
    }
    if (Object.keys(item).length !== 2 || !Object.hasOwn(item, "kind") || !Object.hasOwn(item, "range") || !nativeDiagnosticKinds.has(item.kind.value)) throw new Error("Native diagnostic schema is invalid");
    const range = dataRecord(item.range.value);
    if (Object.keys(range).length !== 4 || !["startByte", "endByte", "startLine", "endLine"].every(key => Object.hasOwn(range, key))) throw new Error("Native range schema is invalid");
    return {kind: item.kind.value, range: Object.fromEntries(Object.entries(range).map(([key, d]) => [key, localFactValue("uint", d.value)]))};
  };
  for (const [key, field] of Object.entries(fields)) {
    const rule = policy.facts && Object.hasOwn(policy.facts, key) ? policy.facts[key] : undefined;
    if (!rule) {
      if (criticalKey(key) || (field.value !== null && typeof field.value === "object")) throw new Error("Unknown native compound/identity fact");
      omit(typeof field.value === "string" ? field.value : null); continue;
    }
    if (key === "omittedDiagnosticCount" || key === "omittedDiagnosticCharacters") {
      const n = localFactValue("uint", field.value) as number;
      if (key === "omittedDiagnosticCount") omitted += n; else characters += n;
      continue;
    }
    if (rule === "uint") {
      if (key === "observed" && typeof field.value === "number" && Number.isFinite(field.value) && (!Number.isSafeInteger(field.value) || field.value < 0)) { omitted++; continue; }
      result[key] = localFactValue(rule, field.value); continue;
    }
    if (rule === "diagnostic") {
      const value = snapshotItem(field.value, rule);
      if (value !== undefined) {
        if (key !== "kind" && nativeEnums[key] && !nativeEnums[key].includes(value as string)) throw new Error("Native diagnostic enum is invalid");
        result[key] = value;
      }
      continue;
    }
    if (!Array.isArray(field.value)) throw new Error("Native diagnostic list is invalid");
    const list = field.value, length = Object.getOwnPropertyDescriptor(list, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("Native diagnostic length is invalid");
    const keys = Reflect.ownKeys(list);
    if (keys.length !== length + 1 || keys.some(k => k !== "length" && (typeof k !== "string" || !/^(0|[1-9][0-9]*)$/.test(k)))) throw new Error("Native diagnostic list must be dense own data");
    const values: Json[] = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(list, String(i));
      if (!d || !("value" in d)) throw new Error("Native diagnostic list cannot use accessors");
      if (i >= 32) { omitted++; continue; }
      const value = snapshotItem(d.value, rule === "diagnosticList" ? "diagnostic" : rule);
      if (value !== undefined) values.push(value);
    }
    result[key] = values;
  }
  const sourceIssues = Array.isArray(result.issues) ? result.issues as Array<Record<string, Json>> : [];
  // Legacy issues without source paths keep any explicit path supplied by the caller.
  const summarizePath = sourceIssues.some(issue => typeof issue.path === "string");
  const counts = () => {
    if (!Number.isSafeInteger(omitted) || !Number.isSafeInteger(characters)) throw new Error("Native diagnostic counts exceed schema");
    if (omitted) result.omittedDiagnosticCount = omitted;
    if (characters) result.omittedDiagnosticCharacters = characters;
  };
  const fits = () => {
    // Derive the summary from surviving whole issues, including after budget omission.
    if (summarizePath) {
      const path = sourceIssues[0]?.path;
      if (typeof path === "string" && sourceIssues.every(issue => issue.path === path)) result.path = path;
      else delete result.path;
    }
    counts();
    const base = catalogDefaults[policy.code as ArchContextErrorCode];
    const error = {code: policy.code, message: policy.message, severity: base.severity, retryable: policy.retryable ?? base.retryable, action: policy.action ?? base.action, reasonCode: Object.entries(policies).find(([, p]) => p === policy)?.[0], details: result};
    const envelope = {schemaVersion: "archcontext.envelope/v1", ok: false, requestId: "export.native", error};
    return bytes(JSON.stringify(result)) <= 8192 && bytes(JSON.stringify(envelope, null, 2) + "\n") <= 8192;
  };
  while (!fits()) {
    const listKey = Object.keys(result).reverse().find(key => Array.isArray(result[key]) && (result[key] as Json[]).length > 0);
    if (listKey) { omit((result[listKey] as Json[]).pop()!); continue; }
    const key = Object.keys(result).reverse().find(key => typeof result[key] === "string");
    if (!key) throw new Error("Native metadata cannot fit envelope budget");
    omit(result[key]); delete result[key];
  }
  return result;
}

function budgetIssues(value: unknown, depth = 0, maxStringBytes = 256): string[] {
  if (depth > 4) return ["details depth exceeds four"];
  if (typeof value === "string") return bytes(value) <= maxStringBytes ? [] : ["detail string exceeds UTF-8 budget"];
  if (typeof value === "number") return Number.isFinite(value) ? [] : ["detail number is not finite"];
  if (Array.isArray(value)) return value.length <= 32 ? value.flatMap(item => budgetIssues(item, depth + 1, maxStringBytes)) : ["detail list exceeds 32"];
  if (record(value)) return Object.keys(value).length <= 16 ? Object.values(value).flatMap(item => budgetIssues(item, depth + 1, maxStringBytes)) : ["detail object exceeds 16 fields"];
  return value === null || typeof value === "boolean" ? [] : ["detail value is not JSON"];
}
type Attributes = Partial<Pick<StrictFailure, "action" | "severity" | "retryable">>;
export function knownFailure<C extends FailureCode>(code: C, reasonCode: string, details: unknown = {}, attributes: Attributes = {}): StrictFailure<C> {
  // TypeScript types do not protect this runtime boundary. Do not coerce policy keys.
  if (typeof code !== "string" || typeof reasonCode !== "string") throw new Error("Failure code/reason must be primitive strings");
  const suppliedAction = ownData(attributes, "action");
  const suppliedSeverity = ownData(attributes, "severity");
  const suppliedRetryable = ownData(attributes, "retryable");
  if ((suppliedAction !== undefined && typeof suppliedAction !== "string")
    || (suppliedSeverity !== undefined && typeof suppliedSeverity !== "string")
    || (suppliedRetryable !== undefined && typeof suppliedRetryable !== "boolean")) throw new Error("Invalid failure attribute types");
  const policy = Object.hasOwn(FAILURE_POLICIES, reasonCode) ? FAILURE_POLICIES[reasonCode] : undefined;
  if (!policy || policy.code !== code) throw new Error("Failure code/reason pair is not registered");
  const catalog = code === "RPC_TIMEOUT" || code === "RPC_ABORTED"
    ? { severity: "error" as const, retryable: false, action: "reconcile-before-retry" }
    : catalogDefaults[code as ArchContextErrorCode];
  const action = (suppliedAction as string | undefined) ?? policy.action ?? catalog.action;
  const severity = (suppliedSeverity as Severity | undefined) ?? catalog.severity;
  const retryable = (suppliedRetryable as boolean | undefined) ?? policy.retryable ?? catalog.retryable;
  if (!actions.has(action) || !["notice", "warning", "error", "critical"].includes(severity) || typeof retryable !== "boolean") throw new Error("Invalid failure attributes");
  if ((code === "RPC_TIMEOUT" || code === "RPC_ABORTED") && retryable) throw new Error("Transport failures cannot request automatic retry");
  if (code === "AC_UNCLASSIFIED_FAILURE" && (action !== "inspect-diagnostics" || severity !== "error" || retryable)) throw new Error("Unclassified failure attributes are fixed");
  if (policy.journalRecovery) {
    if (action !== catalog.action || severity !== catalog.severity || retryable !== catalog.retryable) throw new Error("Recovery attributes are fixed");
    return {code, message:policy.message, severity, retryable, action, reasonCode, details:changeSetRecoveryDetailsSnapshot(details)};
  }
  if (policy.recovery) {
    if (action !== catalog.action || severity !== catalog.severity || retryable !== catalog.retryable) throw new Error("Committed recovery attributes are fixed");
    return { code, message: policy.message, severity, retryable, action, reasonCode, details: projectionRecoveryDetailsSnapshot(reasonCode, details) };
  }
  const safeDetails = detailsFor(policy, details);
  const extendedFacts = Object.values(policy.facts ?? {}).some(rule => rule === "publicConfirmationToken" || rule === "commandSuggestion" || rule === "diagnosticCommands");
  if (budgetIssues(safeDetails, 0, extendedFacts ? 1024 : 256).length || bytes(JSON.stringify(safeDetails)) > 8192 || bytes(policy.message) > 1024) throw new Error("Failure metadata exceeds its UTF-8 budget");
  return { code, message: policy.message, severity, retryable, action, reasonCode, details: safeDetails };
}
/** Snapshot caller-owned fields once, before validation or use. Missing legacy details stay optional. */
function failureFromData<C extends FailureCode = FailureCode>(input: unknown): StrictFailure<C> {
  const code = ownData(input, "code");
  const reasonCode = ownData(input, "reasonCode");
  const details = ownData(input, "details");
  const action = ownData(input, "action");
  const severity = ownData(input, "severity");
  const retryable = ownData(input, "retryable");
  return knownFailure(code as C, reasonCode as string, details, {
    action: action as string | undefined, severity: severity as Severity | undefined, retryable: retryable as boolean | undefined
  });
}
export function unclassifiedFailure(stage?: FailureStage): StrictFailure<"AC_UNCLASSIFIED_FAILURE"> {
  return knownFailure("AC_UNCLASSIFIED_FAILURE", "failure-unclassified", stage ? { stage } : {});
}
export function failureEnvelope<C extends FailureCode>(requestId: string, failure: StrictFailure<C>): FailureEnvelope<C> {
  // Revalidate/copy even typed metadata so caller mutation cannot bypass the closed contract.
  if (typeof requestId !== "string" || bytes(requestId) > 256) throw new Error("Failure surface identity exceeds budget");
  const result: FailureEnvelope<C> = { schemaVersion: "archcontext.envelope/v1", ok: false, requestId, error: failureFromData<C>(failure) };
  if (!FAILURE_POLICIES[result.error.reasonCode]?.recovery && !FAILURE_POLICIES[result.error.reasonCode]?.journalRecovery && (bytes(JSON.stringify(result)) > 8192 || bytes(JSON.stringify(result, null, 2) + "\n") > 8192)) throw new Error("Failure envelope exceeds budget");
  return result;
}
/** Public value readers retain their success signature and throw this typed failure. */
export class FailureError<C extends FailureCode = ArchContextErrorCode> extends Error {
  readonly failure: StrictFailure<C>;
  constructor(code: C, reasonCode: string, details: unknown = {}, attributes: Attributes = {}) {
    const failure = knownFailure(code, reasonCode, details, attributes);
    super(failure.message);
    this.name = "FailureError";
    this.failure = failure;
  }
  get code(): C { return this.failure.code; }
  get reasonCode(): string { return this.failure.reasonCode; }
  get action(): string { return this.failure.action; }
  get severity(): Severity { return this.failure.severity; }
  get retryable(): boolean { return this.failure.retryable; }
  get details(): { [key: string]: Json } { return this.failure.details; }
}
export function toEnvelope(requestId: string, error: unknown, stage: FailureStage): FailureEnvelope {
  try {
    return failureEnvelope(requestId, error instanceof FailureError ? ownData(error, "failure") as StrictFailure : unclassifiedFailure(stage));
  } catch {
    return failureEnvelope(requestId, unclassifiedFailure("failure-metadata"));
  }
}
/** Successful results are returned by identity. Only selected surface callers use this adapter. */
export function normalizeFailureResult<T>(result: T, stage: FailureStage, requestId = "failure"): T | FailureEnvelope {
  if (!record(result)) return result;
  try {
    if (ownData(result, "ok") !== false) return result;
    return failureEnvelope(requestId, failureFromData(ownData(result, "error")));
  } catch {
    return toEnvelope(requestId, undefined, "failure-metadata");
  }
}
/** Bounded JSON copy for strict validation; never stringify caller-owned objects or run their hooks. */
function jsonDataSnapshot(value: unknown, depth = 0, maxStringBytes = 256): Json {
  if (depth > 4) throw new Error("Failure details exceed depth budget");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string" && bytes(value) <= maxStringBytes) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length > 32 || Reflect.ownKeys(value).length !== length + 1) throw new Error("Failure details violate array contract");
    return Array.from({ length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) throw new Error("Failure details cannot use accessors or sparse lists");
      return jsonDataSnapshot(descriptor.value, depth + 1, maxStringBytes);
    });
  }
  if (record(value)) {
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length > 16 || Object.keys(value).length !== keys.length || keys.some(key => typeof key !== "string")) throw new Error("Failure details violate object contract");
    return Object.fromEntries((keys as string[]).map(key => [key, jsonDataSnapshot(ownData(value, key), depth + 1, maxStringBytes)]));
  }
  throw new Error("Failure details are not bounded JSON data");
}
export function failureIssues(value: unknown): string[] {
  try {
    if (!record(value)) return ["failure must be an object"];
    const fields = ["code", "message", "severity", "retryable", "action", "reasonCode", "details"];
    const keys = Reflect.ownKeys(value);
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== fields.length || Object.keys(value).length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) return ["failure must match its closed registered contract"];
    const data = Object.fromEntries(fields.map(key => [key, ownData(value, key)]));
    const policy = typeof data.reasonCode === "string" ? policies[data.reasonCode] : undefined;
    const extendedFacts = policy !== undefined && policy.code === data.code && Object.values(policy.facts ?? {}).some(rule => rule === "publicConfirmationToken" || rule === "commandSuggestion" || rule === "diagnosticCommands");
    data.details = policy?.journalRecovery && policy.code === data.code ? changeSetRecoveryDetailsSnapshot(data.details) : policy?.recovery && policy.code === data.code ? projectionRecoveryDetailsSnapshot(data.reasonCode as string, data.details) : jsonDataSnapshot(data.details, 0, extendedFacts ? 1024 : 256);
    if (typeof data.message !== "string" || bytes(data.message) > 1024 || bytes(JSON.stringify(data.details)) > (policy?.recovery || policy?.journalRecovery ? PROJECTION_RECOVERY_DETAILS_LIMIT_BYTES : 8192)) return ["failure exceeds byte/shape budget"];
    const expected = failureFromData(data);
    return canonicalize(data as Json) === canonicalize(expected as unknown as Json) ? [] : ["failure must match its closed registered contract"];
  } catch { return ["failure violates its registered contract or budget"]; }
}
