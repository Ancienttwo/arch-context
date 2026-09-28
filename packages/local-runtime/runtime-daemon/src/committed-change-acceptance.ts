import { execFileSync } from "node:child_process";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseJsonOrStableYaml } from "@archcontext/core/architecture-domain";
import type { AcceptedCommittedChangeJournalV2, AcceptedCommittedChangePayloadV2, ArchitectureLedgerScope } from "@archcontext/core/architecture-ledger";
import { assertPathHasNoSymlinkSegments, type ChangeSetDraft } from "@archcontext/core/changeset-engine";
import { classifyArchitectureMajorChange, loadNativeModelFromModelFiles, type ArchitectureMajorChangeClassificationV1, type ArchitectureSemanticStateV1, type NativeModel } from "@archcontext/core/projection-engine";
import { digestJson, type AcceptedArchitectureChangeReferenceV1, type ArchitectureEventV1, type Json } from "@archcontext/contracts";
import { CHANGESET_MODEL_TRANSITION_SCHEMA_VERSION, type ChangeSetModelTransitionV1, type CommittedChangeSetForTaskSession, type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";

/** Exactly the files `loadNativeModelFromArchContext` reads: direct YAML children of these directories. */
const SEMANTIC_MODEL_DIRECTORIES = ["nodes", "relations", "flows"] as const;
const SEMANTIC_MODEL_PATH = /^\.archcontext\/model\/(nodes|relations|flows)\/[^/]+\.ya?ml$/;

export function isSemanticModelPath(path: string): boolean {
  return SEMANTIC_MODEL_PATH.test(path);
}

export interface ModelTransitionBase {
  before: string;
  files: Map<string, string>;
  expectedWrites: Map<string, string>;
}

/**
 * Captured under the writer lock before a ChangeSet touches any file. Returns undefined when the
 * draft writes no semantic model file or the current model cannot be read as one snapshot; either
 * way the journal simply carries no transition and can never be accepted later.
 */
export function captureModelTransitionBase(root: string, draft: ChangeSetDraft): ModelTransitionBase | undefined {
  const expectedWrites = new Map<string, string>();
  for (const operation of draft.operations) {
    const writes = [
      ...(operation.path ? [{ path: operation.path, body: operation.body }] : []),
      ...(operation.projectionFiles ?? [])
    ];
    for (const write of writes) {
      if (!isSemanticModelPath(write.path)) continue;
      expectedWrites.set(write.path, operation.op === "delete_entity" ? "missing" : digestJson({ body: write.body ?? "" } as unknown as Json));
    }
  }
  if (expectedWrites.size === 0) return undefined;
  try {
    const snapshot = readSemanticModelSnapshot(root);
    return { files: snapshot.hashes, before: snapshot.modelDigest, expectedWrites };
  } catch {
    return undefined;
  }
}

/**
 * Runs inside the pre-commit hook. The transition is recorded only when every semantic file the
 * draft did not write is byte-identical to the captured base and every file it wrote holds exactly
 * the operation body (or is absent for a delete). `after` is parsed from the same bytes that were
 * hashed, so a concurrent edit can never reach the digest without failing the byte check.
 * Evidence failure never alters the apply outcome.
 */
export async function recordModelTransitionEvidence(
  store: Pick<RuntimeLocalStore, "recordChangeSetModelTransition">,
  root: string,
  journalId: string,
  base: ModelTransitionBase
): Promise<boolean> {
  try {
    const snapshot = readSemanticModelSnapshot(root);
    for (const path of new Set([...base.files.keys(), ...snapshot.hashes.keys(), ...base.expectedWrites.keys()])) {
      const expected = base.expectedWrites.get(path) ?? base.files.get(path) ?? "missing";
      if ((snapshot.hashes.get(path) ?? "missing") !== expected) return false;
    }
    const transition: ChangeSetModelTransitionV1 = {
      schemaVersion: CHANGESET_MODEL_TRANSITION_SCHEMA_VERSION,
      before: base.before,
      after: snapshot.modelDigest
    };
    await store.recordChangeSetModelTransition(journalId, transition);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads every semantic model file exactly once, then hashes and parses that one byte map. Any
 * symlinked directory or non-regular entry (symlink, FIFO, directory) aborts the snapshot.
 */
function readSemanticModelSnapshot(root: string): { hashes: Map<string, string>; modelDigest: string } {
  const bodies = new Map<string, string>();
  for (const directory of SEMANTIC_MODEL_DIRECTORIES) {
    const relativeDirectory = `.archcontext/model/${directory}`;
    const absolute = assertPathHasNoSymlinkSegments(root, relativeDirectory);
    let entries: string[];
    try {
      if (!lstatSync(absolute).isDirectory()) throw new Error(`semantic-model-directory-invalid: ${relativeDirectory}`);
      entries = readdirSync(absolute);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries.filter((name) => /\.ya?ml$/.test(name)).sort()) {
      bodies.set(`${relativeDirectory}/${entry}`, readRegularFile(resolve(absolute, entry), `${relativeDirectory}/${entry}`));
    }
  }
  const hashes = new Map([...bodies].map(([path, body]) => [path, digestJson({ body } as unknown as Json)]));
  return { hashes, modelDigest: digestJson(loadNativeModelFromModelFiles(bodies) as unknown as Json) };
}

function readRegularFile(absolute: string, path: string): string {
  if (!lstatSync(absolute).isFile()) throw new Error(`semantic-model-entry-not-regular: ${path}`);
  // O_NOFOLLOW/O_NONBLOCK close the lstat->open window: a swapped-in symlink fails, a FIFO never blocks.
  const fd = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`semantic-model-entry-not-regular: ${path}`);
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

export const ACCEPTED_COMMITTED_CHANGE_V2_SCHEMA_VERSION = "archcontext.accepted-committed-change/v2" as const;
export const ACCEPTED_COMMITTED_CHANGE_PLAN_SCHEMA_VERSION = "archcontext.accepted-committed-change-plan/v1" as const;
export const MAX_ACCEPTED_COMMITTED_JOURNALS = 32;
const PROJECTION_MANIFEST_PATH = "docs/architecture/.projection-manifest.json";
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

export interface AcceptedCommittedJournalRef {
  journalId: string;
  changeSetId: string;
}

export interface AcceptCommittedChangeRequest {
  journals: AcceptedCommittedJournalRef[];
  approved: boolean;
  expectedWorktreeDigest?: string;
  acceptancePlanId?: string;
}

export class AcceptCommittedChangeInputError extends Error {}

/** Closed request shape; the retired four-field v1 request (`journalId`, `changeSetId`, ...) is refused here. */
export function decodeAcceptCommittedChangeInput(raw: unknown): AcceptCommittedChangeRequest {
  const fail = (message: string): never => { throw new AcceptCommittedChangeInputError(message); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("accept-committed input must be an object");
  const input = raw as Record<string, unknown>;
  const unknownKey = Object.keys(input).find((key) => !["journals", "approved", "expectedWorktreeDigest", "acceptancePlanId"].includes(key));
  if (unknownKey) fail(`accept-committed input has unsupported field ${unknownKey}; pass journals[{journalId, changeSetId}]`);
  if (!Array.isArray(input.journals) || input.journals.length < 1 || input.journals.length > MAX_ACCEPTED_COMMITTED_JOURNALS) {
    fail(`accept-committed requires 1-${MAX_ACCEPTED_COMMITTED_JOURNALS} journals`);
  }
  const journals = (input.journals as unknown[]).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).sort().join(",") !== "changeSetId,journalId") fail("each journal must be exactly {journalId, changeSetId}");
    const { journalId, changeSetId } = entry as Record<string, unknown>;
    if (typeof journalId !== "string" || journalId === "" || typeof changeSetId !== "string" || changeSetId === "") {
      fail("journalId and changeSetId must be non-empty strings");
    }
    return { journalId: journalId as string, changeSetId: changeSetId as string };
  });
  if (new Set(journals.map((journal) => journal.journalId)).size !== journals.length) fail("accept-committed journals must not repeat a journalId");
  if (input.approved !== undefined && typeof input.approved !== "boolean") fail("approved must be a boolean");
  for (const key of ["expectedWorktreeDigest", "acceptancePlanId"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || !SHA256_DIGEST.test(input[key] as string))) fail(`${key} must be a sha256 digest`);
  }
  const approved = input.approved === true;
  if (approved && (input.expectedWorktreeDigest === undefined || input.acceptancePlanId === undefined)) {
    fail("approved accept-committed requires expectedWorktreeDigest and acceptancePlanId from preview");
  }
  if (!approved && (input.expectedWorktreeDigest !== undefined || input.acceptancePlanId !== undefined)) {
    fail("expectedWorktreeDigest and acceptancePlanId are only accepted with approved: true");
  }
  return {
    journals,
    approved,
    ...(approved ? { expectedWorktreeDigest: input.expectedWorktreeDigest as string, acceptancePlanId: input.acceptancePlanId as string } : {})
  };
}

export interface AcceptedJournalLink extends AcceptedCommittedJournalRef {
  committedAt: string;
  before: string;
  after: string;
  files: CommittedChangeSetForTaskSession["files"];
}

/** Every requested journal must be committed in this root, write semantics, carry a transition and keep commit order. */
export function acceptedJournalLinks(
  requested: readonly AcceptedCommittedJournalRef[],
  journals: readonly (CommittedChangeSetForTaskSession | undefined)[]
): AcceptedJournalLink[] {
  if (requested.length !== journals.length) throw new Error("accepted-committed-change-journal-lookup-mismatch");
  return requested.map((ref, index) => {
    const journal = journals[index];
    if (!journal) throw new Error(`accepted-committed-change-journal-not-committed: ${ref.journalId} is missing, pending, aborted or from another root`);
    if (journal.journalId !== ref.journalId || journal.changeSetId !== ref.changeSetId) {
      throw new Error(`accepted-committed-change-journal-id-mismatch: ${ref.journalId}`);
    }
    if (!journal.files.some((file) => isSemanticModelPath(file.path))) {
      throw new Error(`accepted-committed-change-journal-without-semantic-write: ${ref.journalId}`);
    }
    if (!journal.modelTransition) throw new Error(`accepted-committed-change-journal-without-transition: ${ref.journalId}`);
    const previous = journals[index - 1];
    if (previous && journal.committedAt < previous.committedAt) {
      throw new Error(`accepted-committed-change-journal-out-of-order: ${ref.journalId} committed before ${previous.journalId}`);
    }
    return { ...ref, committedAt: journal.committedAt, before: journal.modelTransition.before, after: journal.modelTransition.after, files: journal.files };
  });
}

/** b1 = baseline, a_i = b_(i+1), a_n = current: any unjournaled semantic edit breaks exactly one link. */
export function assertModelTransitionChain(baselineModelDigest: string, modelDigest: string, links: readonly Pick<AcceptedJournalLink, "journalId" | "before" | "after">[]): void {
  if (links.length === 0) throw new Error("accepted-committed-change-chain-empty");
  if (links[0]!.before !== baselineModelDigest) {
    throw new Error(`accepted-committed-change-chain-baseline-mismatch: ${links[0]!.journalId} does not start at the projection baseline model`);
  }
  for (let index = 1; index < links.length; index += 1) {
    if (links[index - 1]!.after !== links[index]!.before) {
      throw new Error(`accepted-committed-change-chain-gap: ${links[index - 1]!.journalId} -> ${links[index]!.journalId}`);
    }
  }
  if (links[links.length - 1]!.after !== modelDigest) {
    throw new Error(`accepted-committed-change-chain-current-mismatch: ${links[links.length - 1]!.journalId} does not end at the current model`);
  }
}

export interface SemanticLastWriter {
  path: string;
  operation: "delete" | "write";
  hash: string;
  journalId: string;
}

export function semanticLastWriters(links: readonly Pick<AcceptedJournalLink, "journalId" | "files">[]): SemanticLastWriter[] {
  const byPath = new Map<string, SemanticLastWriter>();
  for (const link of links) {
    for (const file of link.files) {
      if (isSemanticModelPath(file.path)) byPath.set(file.path, { path: file.path, operation: file.operation, hash: file.hash, journalId: link.journalId });
    }
  }
  return [...byPath.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export interface AcceptedNodeSets {
  directlyEditedNodeIds: string[];
  affectedAncestorNodeIds: string[];
  carriedNodeIds: string[];
}

/**
 * Labels only. A written node file must be `nodes/<id>.yaml` (or `.yml`, which the loader also
 * reads) for the id it declares; a deleted one names its id by path, and that node must exist in
 * the baseline and be gone now.
 */
export function labelAcceptedNodeSets(input: {
  lastWriters: readonly SemanticLastWriter[];
  writtenBodies: ReadonlyMap<string, string>;
  affectedNodeIds: readonly string[];
  base: ArchitectureSemanticStateV1;
  resulting: ArchitectureSemanticStateV1;
  currentNodeIds: ReadonlySet<string>;
}): AcceptedNodeSets {
  const direct = new Set<string>();
  const baselineNodeIds = new Set(input.base.capabilities.flatMap((capability) => capability.memberNodeIds));
  for (const writer of input.lastWriters) {
    if (!writer.path.startsWith(".archcontext/model/nodes/")) continue;
    if (writer.operation === "delete") {
      const match = /^\.archcontext\/model\/nodes\/([^/]+)\.ya?ml$/.exec(writer.path);
      if (!match) throw new Error(`accepted-committed-change-node-path-nonstandard: ${writer.path}`);
      if (!baselineNodeIds.has(match[1]!) || input.currentNodeIds.has(match[1]!)) {
        throw new Error(`accepted-committed-change-deleted-node-unbound: ${match[1]}`);
      }
      direct.add(match[1]!);
      continue;
    }
    const id = declaredId(input.writtenBodies.get(writer.path), writer.path);
    if (writer.path !== `.archcontext/model/nodes/${id}.yaml` && writer.path !== `.archcontext/model/nodes/${id}.yml`) throw new Error(`accepted-committed-change-node-path-nonstandard: ${writer.path}`);
    direct.add(id);
  }
  const capabilityIds = new Set([...input.base.capabilities, ...input.resulting.capabilities].map((capability) => capability.capabilityId));
  const indirect = input.affectedNodeIds.filter((id) => !direct.has(id));
  return {
    directlyEditedNodeIds: [...direct].sort(),
    affectedAncestorNodeIds: indirect.filter((id) => capabilityIds.has(id)).sort(),
    carriedNodeIds: indirect.filter((id) => !capabilityIds.has(id)).sort()
  };
}

/** The recorded inputs, besides the model, that a capability's flow proof is computed from. */
export interface ProofEvidenceDigests {
  sourceTreeDigest: string;
  codeGraphDigest: string;
}

/**
 * A capability whose semantic fingerprint held while its flow proof moved is explained by the
 * model (which the chain binds) only when the proof's other inputs, the declared source tree and
 * the CodeGraph evidence, are the ones the baseline recorded. A journaled flow rewrite does not
 * explain an evidence change.
 */
export function assertProofChangesExplained(input: {
  base: ArchitectureSemanticStateV1;
  resulting: ArchitectureSemanticStateV1;
  baselineEvidence: ProofEvidenceDigests | undefined;
  currentEvidence: ProofEvidenceDigests;
}): void {
  const evidenceUnchanged = input.baselineEvidence !== undefined
    && input.baselineEvidence.sourceTreeDigest === input.currentEvidence.sourceTreeDigest
    && input.baselineEvidence.codeGraphDigest === input.currentEvidence.codeGraphDigest;
  if (evidenceUnchanged) return;
  const baseById = new Map(input.base.capabilities.map((capability) => [capability.capabilityId, capability]));
  for (const capability of input.resulting.capabilities) {
    const before = baseById.get(capability.capabilityId);
    if (!before || before.semanticFingerprint !== capability.semanticFingerprint) continue;
    if (before.flowProofFingerprint !== capability.flowProofFingerprint) {
      throw new Error(`accepted-committed-change-proof-change-unexplained: ${capability.capabilityId} proof moved while source or CodeGraph evidence changed since the baseline`);
    }
  }
}

/** One event per (baseline, current model) at one ledger scope, whatever journal list proved it. */
export function acceptedCommittedChangeEventId(baselineModelDigest: string, modelDigest: string, scope: ArchitectureLedgerScope): string {
  return `architecture_event.changeset_accepted.${digestJson({ v: 2, B: baselineModelDigest, C: modelDigest, scope } as unknown as Json).slice(7, 31)}`;
}

/** Rebuilds the reference an earlier approval returned, from the stored event alone. */
export function acceptedChangeFromEventV2(event: ArchitectureEventV1): { acceptancePlanId: string; acceptedChange: AcceptedArchitectureChangeReferenceV1 } | undefined {
  const payload = (event.payload as { acceptedCommittedChange?: AcceptedCommittedChangePayloadV2 } | null)?.acceptedCommittedChange;
  if (event.payloadVersion !== ACCEPTED_COMMITTED_CHANGE_V2_SCHEMA_VERSION || payload?.schemaVersion !== ACCEPTED_COMMITTED_CHANGE_V2_SCHEMA_VERSION
    || !payload.journals?.[0]) return undefined;
  return {
    acceptancePlanId: payload.acceptancePlanId,
    acceptedChange: {
      changeSetId: payload.journals[0].changeSetId,
      eventId: event.eventId,
      reasonCodes: [...payload.reasonCodes] as AcceptedArchitectureChangeReferenceV1["reasonCodes"],
      affectedNodeIds: [...payload.affectedNodeIds]
    }
  };
}

export interface CommittedChangeAcceptancePlanV1 extends AcceptedNodeSets {
  schemaVersion: typeof ACCEPTED_COMMITTED_CHANGE_PLAN_SCHEMA_VERSION;
  journals: AcceptedCommittedChangeJournalV2[];
  baselineModelDigest: string;
  modelDigest: string;
  reasonCodes: AcceptedArchitectureChangeReferenceV1["reasonCodes"];
  affectedNodeIds: string[];
  fileSetDigest: string;
  /** How the projection manifest carrying the baseline was authenticated. */
  baselineAnchor: "head" | "journal";
  projectionWorktreeDigest: string;
  headSha: string;
}

export interface CommittedChangeAcceptance {
  plan: CommittedChangeAcceptancePlanV1;
  acceptancePlanId: string;
  acceptedChange: AcceptedArchitectureChangeReferenceV1;
}

export function committedChangeAcceptancePlanId(plan: CommittedChangeAcceptancePlanV1): string {
  return digestJson(plan as unknown as Json);
}

/**
 * Computes the acceptance plan from durable journals, the projection manifest baseline and the
 * current tree. Deterministic for identical state, so the approve call recomputes it under the
 * writer lock and must reproduce the previewed id.
 */
export function planCommittedChangeAcceptance(root: string, input: {
  requested: readonly AcceptedCommittedJournalRef[];
  journals: readonly (CommittedChangeSetForTaskSession | undefined)[];
  model: NativeModel;
  /** The projection's view of existing docs; the manifest's semantic baseline anchors the chain. */
  existingFiles: readonly { path: string; body: string }[];
  /** `bodyHash` of the latest committed journal in this root that wrote the projection manifest. */
  latestJournaledManifestHash: string | undefined;
  projection: {
    majorChange: ArchitectureMajorChangeClassificationV1;
    rejected: readonly unknown[];
    semanticState: ArchitectureSemanticStateV1;
    architectureDigests: { modelDigest: string };
  };
  /** Freshly measured (never sticky) source-tree and CodeGraph evidence digests. */
  currentEvidence: ProofEvidenceDigests;
  projectionWorktreeDigest: string;
  scope: ArchitectureLedgerScope;
}): CommittedChangeAcceptance {
  const links = acceptedJournalLinks(input.requested, input.journals);
  const manifestBody = input.existingFiles.find((file) => file.path === PROJECTION_MANIFEST_PATH)?.body;
  const baselineAnchor = authenticateProjectionManifest(root, manifestBody, input.latestJournaledManifestHash);
  const baseline = projectionManifestBaseline(manifestBody);
  const modelDigest = digestJson(input.model as unknown as Json);
  if (input.projection.architectureDigests.modelDigest !== modelDigest) throw new Error("accepted-committed-change-projection-model-mismatch");
  assertModelTransitionChain(baseline.modelDigest, modelDigest, links);

  const lastWriters = semanticLastWriters(links);
  const writtenBodies = readLastWriterBodies(root, lastWriters);

  const { majorChange, semanticState } = input.projection;
  if (input.projection.rejected.length > 0) throw new Error("accepted-committed-change-projection-rejected: resolve adoption or ownership conflicts first");
  const unprovable = semanticState.capabilities
    .filter((capability) => capability.proofStatus.p1 === "unprovable" || capability.proofStatus.p2 === "unprovable")
    .map((capability) => capability.capabilityId);
  if (unprovable.length > 0) throw new Error(`accepted-committed-change-proof-unprovable: ${unprovable.join(",")}`);
  if (majorChange.mode !== "human-action-required" || majorChange.reasonCodes.length === 0) {
    throw new Error(`accepted-committed-change-no-unresolved-major-change: ${majorChange.mode}`);
  }
  const observed = classifyArchitectureMajorChange({ base: baseline.semanticState, resulting: semanticState });
  if (!sameStrings(observed.reasonCodes, majorChange.reasonCodes) || !sameStrings(observed.affectedNodeIds, majorChange.affectedNodeIds)) {
    throw new Error("accepted-committed-change-observed-delta-mismatch");
  }

  assertProofChangesExplained({ base: baseline.semanticState, resulting: semanticState, baselineEvidence: baseline.evidence, currentEvidence: input.currentEvidence });

  const nodeSets = labelAcceptedNodeSets({
    lastWriters,
    writtenBodies,
    affectedNodeIds: majorChange.affectedNodeIds,
    base: baseline.semanticState,
    resulting: semanticState,
    currentNodeIds: new Set(input.model.nodes.map((node) => node.id))
  });
  const plan: CommittedChangeAcceptancePlanV1 = {
    schemaVersion: ACCEPTED_COMMITTED_CHANGE_PLAN_SCHEMA_VERSION,
    journals: links.map(({ journalId, changeSetId, committedAt, before, after }) => ({ journalId, changeSetId, committedAt, before, after })),
    baselineModelDigest: baseline.modelDigest,
    modelDigest,
    reasonCodes: [...majorChange.reasonCodes],
    affectedNodeIds: [...majorChange.affectedNodeIds],
    ...nodeSets,
    fileSetDigest: digestJson(lastWriters as unknown as Json),
    baselineAnchor,
    projectionWorktreeDigest: input.projectionWorktreeDigest,
    headSha: input.scope.worktree.headSha
  };
  const acceptedChange: AcceptedArchitectureChangeReferenceV1 = {
    changeSetId: links[0]!.changeSetId,
    eventId: acceptedCommittedChangeEventId(baseline.modelDigest, modelDigest, input.scope),
    reasonCodes: [...majorChange.reasonCodes],
    affectedNodeIds: [...majorChange.affectedNodeIds]
  };
  // The downstream projection must resolve exactly this reference to an accepted refresh.
  const accepted = classifyArchitectureMajorChange({ base: baseline.semanticState, resulting: semanticState, acceptedChange });
  if (accepted.mode !== "refresh-required" || !sameStrings(accepted.reasonCodes, acceptedChange.reasonCodes)
    || !sameStrings(accepted.affectedNodeIds, acceptedChange.affectedNodeIds)) {
    throw new Error("accepted-committed-change-reference-not-resolvable");
  }
  return { plan, acceptancePlanId: committedChangeAcceptancePlanId(plan), acceptedChange };
}

/** Record-only event: `operations: []` and base == resulting ledger graph digest. */
export function acceptedCommittedChangeEventV2(input: {
  acceptance: CommittedChangeAcceptance;
  scope: ArchitectureLedgerScope;
  ledgerGraphDigest: string;
  timestamp: string;
}): ArchitectureEventV1 {
  const { plan, acceptancePlanId, acceptedChange } = input.acceptance;
  const payload: AcceptedCommittedChangePayloadV2 = {
    schemaVersion: ACCEPTED_COMMITTED_CHANGE_V2_SCHEMA_VERSION,
    journals: plan.journals,
    fileSetDigest: plan.fileSetDigest,
    baselineModelDigest: plan.baselineModelDigest,
    modelDigest: plan.modelDigest,
    reasonCodes: plan.reasonCodes,
    affectedNodeIds: plan.affectedNodeIds,
    directlyEditedNodeIds: plan.directlyEditedNodeIds,
    affectedAncestorNodeIds: plan.affectedAncestorNodeIds,
    carriedNodeIds: plan.carriedNodeIds,
    projectionWorktreeDigest: plan.projectionWorktreeDigest,
    acceptancePlanId,
    authority: "yaml"
  };
  return {
    schemaVersion: "archcontext.architecture-event/v1",
    eventId: acceptedChange.eventId,
    eventType: "architecture.changeset.accepted",
    payloadVersion: ACCEPTED_COMMITTED_CHANGE_V2_SCHEMA_VERSION,
    repository: input.scope.repository,
    worktree: input.scope.worktree,
    baseDigest: input.ledgerGraphDigest,
    resultingDigest: input.ledgerGraphDigest,
    headSha: input.scope.worktree.headSha,
    actor: { kind: "daemon", id: "archctxd" },
    source: "manual",
    timestamp: input.timestamp,
    idempotencyKey: `architecture-ledger-accepted-committed/v2:${acceptedChange.eventId}`,
    provenance: {
      producer: "runtime-daemon",
      command: "archctx ledger accept-committed",
      inputDigest: digestJson({ acceptancePlanId, acceptedChange, repository: input.scope.repository, worktree: input.scope.worktree } as unknown as Json)
    },
    payload: { operations: [], acceptedCommittedChange: payload } as unknown as Json
  } as ArchitectureEventV1;
}

/**
 * The manifest lives under `docs/architecture`, which the projection worktree digest ignores, so its
 * bytes are trusted only when they are the committed HEAD copy or exactly what the latest journaled
 * projection write produced in this root. A hand-edited baseline is refused.
 */
function authenticateProjectionManifest(root: string, body: string | undefined, latestJournaledHash: string | undefined): "head" | "journal" {
  if (body === undefined) throw new Error("accepted-committed-change-baseline-missing: no projection manifest");
  if (latestJournaledHash !== undefined && digestJson({ body } as unknown as Json) === latestJournaledHash) return "journal";
  let headBody: string | undefined;
  try {
    headBody = execFileSync("git", ["cat-file", "blob", `HEAD:${PROJECTION_MANIFEST_PATH}`], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
  } catch {
    headBody = undefined;
  }
  if (headBody === body) return "head";
  throw new Error(`accepted-committed-change-baseline-unanchored: ${PROJECTION_MANIFEST_PATH} matches neither HEAD nor the latest journaled projection write; commit it, or re-baseline with archctx docs apply --approved`);
}

function projectionManifestBaseline(body: string | undefined): { modelDigest: string; semanticState: ArchitectureSemanticStateV1; evidence: ProofEvidenceDigests | undefined } {
  if (body === undefined) throw new Error("accepted-committed-change-baseline-missing: no projection manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("accepted-committed-change-baseline-missing: projection manifest is not JSON");
  }
  const manifest = parsed as {
    semanticBaseline?: { semanticState?: ArchitectureSemanticStateV1; digests?: { modelDigest?: unknown; flowProofDigest?: unknown } };
    provenance?: { sourceTreeDigest?: unknown; codeGraphDigest?: unknown };
  } | null;
  const baseline = manifest?.semanticBaseline;
  const modelDigest = baseline?.digests?.modelDigest;
  const state = baseline?.semanticState;
  if (!state || !Array.isArray(state.capabilities) || typeof modelDigest !== "string" || !SHA256_DIGEST.test(modelDigest)) {
    throw new Error("accepted-committed-change-baseline-missing: projection manifest has no semantic baseline");
  }
  // The renderer writes digests.flowProofDigest = semanticState.flowProofFingerprint and both
  // aggregates from the per-capability fingerprints; a baseline that disagrees with itself is refused.
  const aggregate = (key: "semanticFingerprint" | "flowProofFingerprint") =>
    digestJson(state.capabilities.map((capability) => ({ capabilityId: capability.capabilityId, [key]: capability[key] })) as unknown as Json);
  if (baseline.digests?.flowProofDigest !== state.flowProofFingerprint
    || state.flowProofFingerprint !== aggregate("flowProofFingerprint")
    || state.semanticFingerprint !== aggregate("semanticFingerprint")) {
    throw new Error("accepted-committed-change-baseline-inconsistent: semantic baseline digests do not match its capability fingerprints");
  }
  const provenance = manifest?.provenance;
  const evidence = typeof provenance?.sourceTreeDigest === "string" && typeof provenance.codeGraphDigest === "string"
    ? { sourceTreeDigest: provenance.sourceTreeDigest, codeGraphDigest: provenance.codeGraphDigest }
    : undefined;
  return { modelDigest, semanticState: state, evidence };
}

/** Rejects symlinked segments and re-proves every last writer's bytes; returns written bodies. */
function readLastWriterBodies(root: string, lastWriters: readonly SemanticLastWriter[]): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const writer of lastWriters) {
    const absolute = assertPathHasNoSymlinkSegments(root, writer.path);
    let stat: ReturnType<typeof lstatSync> | undefined;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
    if (writer.operation === "delete") {
      if (stat || writer.hash !== "missing") throw new Error(`accepted-committed-change-file-mismatch: ${writer.path}`);
      continue;
    }
    const body = stat?.isFile() ? readFileSync(absolute, "utf8") : undefined;
    if (body === undefined || digestJson({ body } as unknown as Json) !== writer.hash) throw new Error(`accepted-committed-change-file-mismatch: ${writer.path}`);
    bodies.set(writer.path, body);
  }
  return bodies;
}

function declaredId(body: string | undefined, path: string): string {
  const parsed = body === undefined ? undefined : parseJsonOrStableYaml(body, path);
  const id = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Json>).id : undefined;
  if (typeof id !== "string" || id === "") throw new Error(`accepted-committed-change-node-id-missing: ${path}`);
  return id;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
