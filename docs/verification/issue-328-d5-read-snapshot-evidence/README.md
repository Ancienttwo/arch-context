# D5 public verification evidence

This five-file bundle makes the migrated benchmark fixture independently reconstructable.
It contains no archive, source/model/contract bodies, local machine paths, username, command
vectors, native-export bodies or raw diagnostic logs. The migration patch contains the
actual generated-document/manifest diff against the public source commit.

| File | Content |
|---|---|
| `migration.patch` | Complete, byte-identical migration patch; SHA-256 `05b76f8d58ab096ce47c5c5425eb8bb0d2bef60dc9aa06f09d9ebf583c7fc44f` |
| `migration-audit.json` | Every tracked file's before/after SHA-256 and byte count, changed-path audit, human-region byte ranges/hashes, native business-payload digests and all 32 sample bindings |
| `samples-allowlist.json` | Closed-field extraction of every original sample, source/engine/harness fingerprints, coverage and environment; original raw-file SHA-256 values retained |
| `recompute-migration-audit.ts` | Stateless fixture/native reader and hash verifier; writes results only to an external output directory |
| `README.md` | Reconstruction, provenance, deterministic transformations and limits |

## Fixed subjects and results

Representative source: `Ancienttwo/repo-harness@90cd97fb84fb92e242c70f8f7f1a6eb4411d9a49`.
Its identity is **90cd97fb + audited supported v3 migration**. The original v2 manifest was
refused before timing (zero samples); this bundle does not claim that unmodified v2 was readable.
Only the isolated fixture was migrated with supported projection apply. The patch changes
44 generated document/manifest paths. All other 5021 tracked files, including 460 model
files, are byte-identical. Forty mixed documents have 75 unchanged human regions. The three
whole-file diagrams were owned as `generated` in the old manifest. P2 remains unprovable.

Baseline engine: `a697adad7bf686f309405d7a9feef8173d8140a5`.
Measured candidate engine: `dabf86ab93cfea3566df0a994754086d5104e4a6`.
The later evidence commits retain the measured candidate's product-source bytes.

| Sample | Representative baseline, ms | Representative candidate, ms |
|---|---:|---:|
| 1 | 2443.1385 | 644.328041 |
| 2 | 666.072167 | 657.905 |
| 3 | 669.114792 | 629.909667 |
| 4 | 677.669542 | 626.057875 |
| 5 | 691.211458 | 607.513208 |

All 32 samples are retained: representative/control each have five edit and three full-debt
samples per phase. Each subject has its own fixed fingerprint, equal before/after:

- Representative: `sha256:86304321c404fc321f4fd0c8a86401c917660eab07f19d30a126d32309f8da17`.
- Control, unmodified arch-context@a697adad: `sha256:4cf037a4d8ba68867c154b380f218ae95d88710a1821ced5109870bbf34c5aa5`.

Coverage remains **partial**. Full debt is separate and practice evidence remains not
enabled/evaluated. Independent processes include startup/output drain; OS file caches were
not flushed and preparation/preflight can warm them. No first sample or historical 3016 ms
observation was discarded. These measurements are not a universal latency bound.

## Deterministic public transformations

The original private raw files remain intact. Their original SHA-256 values are:

- Before raw JSON: `f9779d438c7b03e49a28c670d8b8401e7ed586c539b32c7c466ebc282e66cd98`.
- After raw JSON: `34f4f98bf08347d1b7b180390913d25a86083d04607dfc697ba2e96c24f2147a`.
- Original committed benchmark summary: `79b8a6ecac0e8169e4d9245e13b696d530e53f79d9a1b248fc777ff68ed6b75c`.

1. The existing benchmark summary removes only `fixtureLock.subjects[*].root`,
   `subjects[*].root`, `runs[*].engine.entry` and `runs[*].samples[*].argv`: 38 provenance
   fields. It preserves all four whole reports and every other original value. The exact
   removed JSON pointers are recorded in its `publicEvidence` metadata.
2. `samples-allowlist.json` keeps the complete ordered 32-row sample set through a closed
   allowlist: phase, subject, kind/index, engine/source SHA, input fingerprint, literal
   changed paths, elapsed ns/ms, exit, report digest, coverage and validation/read-only
   flags. Engine entry paths and fixture roots are omitted. Reports remain deduplicated in
   the main summary. This derived file is not byte-identical raw JSON.
3. `migration-audit.json` retains the audited fields and adds all 5065 hash rows as closed
   tuples. `trackedFileHashColumns` defines their order: repo-relative path, before SHA-256,
   after SHA-256, before bytes, after bytes. No file body is added. Its `derivation` records
   the original audit and all-file manifest hashes.
4. The patch is unchanged. The portable verifier adds a real-path check preventing output
   inside either fixture and checks the published hash tuples against freshly read bytes.
   This changes no benchmark sample or measured product code.

Original hashes for the other four reviewed inputs are recorded below; the verifier's
published hash differs because of the two validation guards described above.

| Reviewed input | Original SHA-256 |
|---|---|
| README.md | `8515ed94157ba34ba5581d96176f1ed0dd779b5493b5d718ac7c334c92e4f953` |
| migration-audit.json | `98596525f1210a70402549042661eacb821da8010776e74098fbd0b9b5e74393` |
| migration.patch | `05b76f8d58ab096ce47c5c5425eb8bb0d2bef60dc9aa06f09d9ebf583c7fc44f` |
| recompute-migration-audit.ts | `97eba4ba5a458aed0a17e6f33083958cb6597b41f627339a1dbdb850095baba3` |
| samples-allowlist.json | `e672d13a7cd8fe987cee01e7f53ba6b0f45935f6aa84678e04824aad66d7b88b` |

The public payload was checked for absolute/local paths, the local username, email/private
key markers and credential-token shapes, and for repository-relative hash paths. Such
checks supplement actual payload review; they are not a blanket statement about the
excluded archive or original raw logs.

## Independent reconstruction and verification

In isolated temporary directories, prepare two copies of the public representative source
commit. Apply `migration.patch` only to the after copy. Keep that base Git ref available in
the after copy. Never apply it to a live consumer checkout.

Prepare this PR's ArchContext source and matching dependencies with Bun 1.4.3. Create an
output directory outside both fixtures and copy `samples-allowlist.json` and
`migration-audit.json` there. Then run:

```sh
bun recompute-migration-audit.ts <arch-context-root> <before-fixture> <after-fixture> <output-dir>
```

The verifier compares every tracked file's bytes and the published hash tuples. It uses
the canonical U4 scanner's UTF-8 byte ranges without trimming/newline conversion, compares
all human-region buffers, and reads native model/profile/contract payloads from the fixed
public ref and the migrated worktree. It reuses the original Git-visible file filtering,
`localeCompare` ordering and canonical JSON digest to recompute the representative input
fingerprint. Git's raw listing order is not a substitute for that producer ordering.

It validates every sample's phase/engine/source/input binding. Control sample bindings are
checked against their fixed lock; independently recomputing control content needs a separate
unmodified arch-context@a697adad fixture and the same file-list/digest rules. CodeGraph DB or
an archive is not needed for this migration-byte audit. Reproducing code-fact measurements
separately requires the documented complete CodeGraph 1.6.1 index preparation.

This verifies final logical content, not transient restored writes or lock-free ABA edits.
Call-local discovery reuse is not an atomic snapshot.
