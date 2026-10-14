# D5 public verification evidence

The benchmark summary is the single source for all **32 samples** (`/runs`) and all
**four whole reports** (`/reports`):
[issue-328-d5-read-snapshot-benchmark.json](../issue-328-d5-read-snapshot-benchmark.json).
This directory keeps only the migration patch, a small provenance manifest and its verifier.

| File | Purpose |
|---|---|
| `migration.patch` | Original, byte-identical generated-document/manifest migration diff |
| `migration-provenance.json` | Fixed public Git commits/trees, counts, content-root digests, original material hashes and recorded-section digests |
| `recompute-migration-audit.ts` | Reconstructs both fixtures from Git blobs, applies the patch and verifies bytes, fingerprints and every recorded sample |

The expanded 5065-file before/after table, duplicate 460-model-file table and per-document
range tables are reconstructed in memory. The duplicate sample file is removed. No JSON
was minified to achieve the reduction. All benchmark values, sample order, harness/input
fingerprints, first samples, failure history and partial coverage remain unchanged.

## Fixed inputs and preservation claims

Representative: `Ancienttwo/repo-harness@90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49`
plus the published patch, identified as **90cd97fb + audited supported v3 migration**.
The original v2 manifest was refused before timing (zero samples). Supported projection
apply changed 44 generated document/manifest paths; the remaining 5021 tracked files,
including 460 model files, are byte-identical. Forty mixed documents retain all 75 human
regions byte for byte. The old manifest owns the three whole-file diagrams as `generated`.
Native model/profile/contract business payloads are unchanged. P2 remains unprovable.

Control: unmodified `Ancienttwo/arch-context@a697adad7bf686f309405d7a9feef8173d8140a5`
(1710 Git-visible files). This is also the baseline engine. The measured candidate engine
is `dabf86ab93cfea3566df0a994754086d5104e4a6`; later evidence commits preserve its product bytes.

The provenance manifest binds UTF-8-byte-path-ordered file rows `{path,hash,bytes}` and
human-region rows `{path,targetId,regions:[{hash,bytes}]}` with canonical `digestJson`.
Input fingerprints separately retain the original Git-visible producer's `localeCompare`
ordering. Root digests replace published row dumps, not the checks themselves.

## Independent reconstruction and verification

Use this PR's ArchContext checkout with matching dependencies and Bun 1.4.3. Supply local
Git repositories containing the two fixed public source commits above; their worktree
contents are not used as fixture inputs. No archive, private before/after copies or
CodeGraph database is needed. Create an output directory outside both source repositories:

```sh
bun docs/verification/issue-328-d5-read-snapshot-evidence/recompute-migration-audit.ts \
  <arch-context-git-root> <repo-harness-git-root> <external-output-directory>
```

The script makes disposable local clones under the output directory and materializes
immutable Git blob bytes directly, avoiding checkout filters and user hooks. It applies
`migration.patch` only to the disposable representative clone. It then verifies both Git
trees, patch hash/length, file counts/roots, changed paths, all model bytes, scanner-derived
human buffers and native business-payload digests. Both input fingerprints are recomputed.

The script also checks canonical recorded-section digests, all four report schemas/digests,
32 sample phase/engine/source/input bindings, literal changed paths, sample counts/order,
ns/ms agreement, threshold flags, exit/parity/validation/read-only assertions and report
references/coverage. It writes one small `verification-result.json` outside the inputs;
reconstructed file/range rows are not republished. Output inside either source is rejected.

Recorded latency and CodeGraph evidence are not remeasured by this audit. Reproducing those
measurements needs the documented complete CodeGraph 1.6.1 preparation. Coverage stays
**partial**; full debt is separate and practice evidence remains not enabled/evaluated.
Processes were cold but OS file caches were not flushed; preparation can warm them.
This proves final logical content, not transient restored writes or concurrent ABA edits.
Call-local discovery reuse is not an atomic snapshot or a universal latency bound.
