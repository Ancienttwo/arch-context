# AR3 Typed Domain Perspectives Readback

## Verdict

PASS. Explorer V2 now has one canonical five-view catalog. `data-flow` and
`external-integrations` are exact typed subgraphs over the bounded daemon-selected
read set. No name/path/prose inference, alias, compatibility reader, fallback,
database migration, or cache rewrite was added.

## P1 · Map

- Contract authority: `packages/contracts/src/ports.ts` plus the two Explorer V2 JSON
  schemas and canonical fixture.
- Semantic authority: `packages/local-runtime/runtime-daemon/src/explorer-projection.ts`.
- Runtime/product entrypoints: daemon HTTP parser, CLI projection command, generic
  Explorer HTML view links, and packaged CLI smoke.
- Cache boundary: the existing manifest-addressed operational cache. No SQLite schema
  or lifecycle code changed.

The atomic cutover changes 13 implementation/test/schema files. The renderer remains
generic and receives only `ExplorerProjectionV2`.

## P2 · Traces

`data-flow` retains only exact `reads`, `writes`, `publishes`, and `subscribes`
relation kinds, then retains their exact endpoints. `external-integrations` seeds only
typed `external-system` architecture entities, then retains directly adjacent typed
relations and exact opposite endpoints. An edge between two already included neighbors
is not admitted unless it is directly adjacent to an external seed.

Both flows then cross the existing overview/focus, hard-budget, cursor, manifest,
projection-digest, HTTP/CLI, and HTML paths. Zero typed matches yields zero subjects,
zero relations, and no fabricated group.

## P3 · Decision Evidence

One coherent `selectViewGraph` operation owns both subjects and relations. This avoids
the previous two-step shape in which subject inclusion could accidentally admit an
unrelated induced edge. Selection is O(subjects + relations) within the bounded read
set. The first 10x-scale failure remains the public read budget, not an unbounded view
walk.

Every definition now carries an exact `selectionPolicy` discriminator. The pre-AR3
system-map digest was
`sha256:5fe7c1dfa525b83e80589a6654be6914f14b2bc4197f3598de5d8497ad76dbcf`;
the new digest is
`sha256:24a297a7925d53782ef14a12d5ae5d193ac34ff47c62da700bb3c8b539b9e512`.
The new view digests are:

- data-flow: `sha256:7c4da761780d99cb73c2eb8cc6293297584e228a9d0cae401f174a10666aa9c8`
- external-integrations: `sha256:ba98c297159485a5a5c9c305d616a10735b77c802a1478c2ca80a0392b80aa1b`

Existing cache rows therefore cannot masquerade as the new semantics; they become
ordinary manifest misses.

## Verification

- Compiler: 23 pass / 0 fail, including typed positives, adversarial names and paths,
  unrelated-neighbor exclusion, honest empty overview/context, focus, stale cursor,
  hard budgets, deterministic selection, backlinks, and distinct digests.
- Contract/schema, runtime HTTP, CLI, and HTML surface matrix: 325 pass / 0 fail.
- `bun run typecheck`: PASS.
- `bun run verify:explorer`: PASS. Default renderer p95 3.15 ms; public maximum p95
  18.25 ms; both deterministic, size-bounded, and free of external assets/private fields.
- `bun run scripts/packaged-cli-smoke.mjs`: PASS for both new view IDs.
- `node scripts/privacy-route-audit.mjs`: PASS.

Machine-readable evidence is in `docs/verification/ar3-domain-perspectives-readback.json`.
