# Implementation Notes: projection-prior-committed-applies

> **Status**: Active
> **Plan**: plans/plan-20260909-2250-projection-prior-committed-applies.md
> **Contract**: tasks/contracts/20260909-2250-projection-prior-committed-applies.contract.md
> **Review**: tasks/reviews/20260909-2250-projection-prior-committed-applies.review.md
> **Last Updated**: 2026-09-09 22:50
> **Lifecycle**: notes

## Design Decisions

- The journal snapshot is taken at the very top of `runProjectionProtocolCommand`, before adoption
  or apply can write. Anything committed under this `requestId` at that instant belongs to an
  earlier attempt, so no comparison against this run's own changeSetId is needed. That matters
  because the protocol changeSetId is derived from the projection digest and therefore repeats
  across attempts of the same request.
- `ChangeSetJournalFile.bodyHash` is `digestJson({ body })`, the digest archctx already uses for
  bodies in `assertExpectedHash` and `currentBodyHash`, so the reported hash is directly comparable
  with the `outputDigest` convention a projection result already carries.
- Root matching in the journal lookup goes through `canonicalRepositoryRoot`, the same authority the
  runtime uses for repository identity. A raw `resolve()` comparison answered "no earlier attempt
  committed" for a `/var` vs `/private/var` spelling of the same root, which is the exact wrong
  answer to return silently.

## Deviations From Plan Or Spec

- The dispatched shape listed `applyId` and `lookupKey` as required. They are optional and
  both-or-neither instead: `applyProjectionProtocolFixedPoint` mints a
  `ProjectionApplyIdentityV1` only when the request carries an `acceptedChange`, so a plain
  drift-repair apply — the majority path and the shape the reported incident took — commits with no
  apply receipt at all. Requiring them would have fail-closed that path out of the feature.

## Tradeoffs Considered

| Option | Decision | Reason |
|--------|----------|--------|
| v3 protocol bump vs additive optional on v2 | Additive on v2 | The consumer decoder does not reject unknown properties and its receipt digest covers the whole received body, so an un-upgraded consumer recomputes the identical digest |
| Emit `[]` vs omit when empty | Omit | Every existing result stays byte-identical, so no stored receipt digest shifts; support is discovered through the capabilities handshake |
| Derive the hash from disk at read time vs record it at write time | Record at write time | Disk state answers "what is there now", not "what did that ChangeSet commit"; only the write path holds the body |
| Skip journal rows lacking `bodyHash` vs fail closed | Fail closed | A silently short file list reads as "nothing was written", the precise wrong conclusion this feature exists to prevent |

## Open Questions

- A committed journal row written before `bodyHash` existed fails the run closed with
  `changeset-journal-file-body-hash-missing`. That is loud and correct, but an operator upgrading
  mid-incident sees an error rather than a partial answer.

## Evidence Links

- Checks: `.ai/harness/checks/latest.json`
- Run snapshots: `.ai/harness/runs/`

## Promotion Filter

Promote a candidate to `tasks/lessons.md`, `docs/researches/`, or harness asset files only when all three hold: hard to reverse, surprising without local context, and a real trade-off existed. If any one is missing, keep it in this notes file instead.

## Promotion Candidates

- Promote to `tasks/lessons.md` only after a repeated correction or failure pattern.
- Promote to `docs/researches/` only when it is durable repo knowledge with evidence.
- Promote to harness asset files only after verification across more than one task or fixture.
