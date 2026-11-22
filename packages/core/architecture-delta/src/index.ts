import {
  digestJson,
  type ArchitectureSubjectSelectorKind,
  type EvidenceStateAtCursorV1,
  type ExplorerDeltaChangeV2,
  type Json
} from "@archcontext/contracts";

export type ArchitectureDeltaGitChangeSource = "commit" | "staged" | "worktree";

export function compileArchitectureFactChanges<
  E extends object & { entityId: string },
  R extends object & { relationId: string },
  C extends object & { constraintId: string }
>(
  base: { entities: E[]; relations: R[]; constraints: C[] },
  head: { entities: E[]; relations: R[]; constraints: C[] }
): ExplorerDeltaChangeV2[] {
  return [
    ...compileAuthorityCollectionChanges("entity", "entityId", base.entities, head.entities),
    ...compileAuthorityCollectionChanges("relation", "relationId", base.relations, head.relations),
    ...compileAuthorityCollectionChanges("constraint", "constraintId", base.constraints, head.constraints)
  ].sort(compareDeltaChange);
}

export function compileEvidenceStateChanges(base: EvidenceStateAtCursorV1, head: EvidenceStateAtCursorV1): ExplorerDeltaChangeV2[] {
  return [
    ...compileAuthorityCollectionChanges("evidence-item", "evidenceId", base.evidenceItems, head.evidenceItems, "evidence"),
    ...compileAuthorityCollectionChanges("evidence-binding", "bindingId", base.evidenceBindings, head.evidenceBindings, "evidence"),
    ...compileAuthorityCollectionChanges("evidence-tombstone", "id", base.tombstones, head.tombstones, "evidence", (value) => `${String(value.target)}:${String(value.id)}`)
  ].sort(compareDeltaChange);
}

function compileAuthorityCollectionChanges<T extends object>(
  subjectKind: string,
  idKey: keyof T,
  base: T[],
  head: T[],
  deltaClass: ExplorerDeltaChangeV2["deltaClass"] = "architecture-fact",
  identity: (value: T) => string = (value) => String((value as Record<string, unknown>)[String(idKey)])
): ExplorerDeltaChangeV2[] {
  const beforeById = new Map(base.map((value) => [identity(value), value]));
  const afterById = new Map(head.map((value) => [identity(value), value]));
  const changes: ExplorerDeltaChangeV2[] = [];
  for (const id of [...new Set([...beforeById.keys(), ...afterById.keys()])].sort()) {
    const before = beforeById.get(id);
    const after = afterById.get(id);
    if (!before || !after) {
      changes.push({ deltaClass, subjectId: `${subjectKind}:${id}`, change: before ? "removed" : "added", fields: [subjectKind] });
      continue;
    }
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const fields = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
      .filter((field) => JSON.stringify(beforeRecord[field]) !== JSON.stringify(afterRecord[field]))
      .sort();
    if (fields.length > 0) changes.push({ deltaClass, subjectId: `${subjectKind}:${id}`, change: "changed", fields });
  }
  return changes;
}

function compareDeltaChange(left: ExplorerDeltaChangeV2, right: ExplorerDeltaChangeV2): number {
  return `${left.deltaClass}:${left.subjectId}`.localeCompare(`${right.deltaClass}:${right.subjectId}`);
}

export function architectureSubjectSelectorId(
  kind: ArchitectureSubjectSelectorKind,
  repositoryId: string,
  stableKey: string
): string {
  return `subject.${kind}.${shortDigest(digestJson({ repositoryId, stableKey } as unknown as Json))}`;
}

export const REFACTOR_SUBJECT_IDENTITY_VERSION = "archcontext.refactor-subject/v1" as const;

/**
 * The selector identity of a refactor recommendation subject. Unlike `architectureSubjectSelectorId`
 * it is scoped by the product namespace (the manifest `product.id`), never by the worktree-path
 * `repositoryId`, so the same subject names the same selector in every worktree, branch and clone
 * (ADR-0046). The `subject.<kind>.` prefix is shared, the hashed input is not: a refactor selector
 * can never collide with a repository-scoped one.
 */
export function refactorSubjectSelectorId(
  kind: ArchitectureSubjectSelectorKind,
  namespace: string,
  stableKey: string
): string {
  return `subject.${kind}.${shortDigest(digestJson({ identityVersion: REFACTOR_SUBJECT_IDENTITY_VERSION, namespace, stableKey } as unknown as Json))}`;
}

function shortDigest(digest: string): string {
  return digest.replace(/^sha256:/, "").slice(0, 16);
}
