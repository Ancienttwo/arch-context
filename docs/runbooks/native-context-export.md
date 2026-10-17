# Native context export

Use the stateless local reader when a consumer needs canonical architecture data and original
human document bytes from one explicit source:

```sh
archctx export native --worktree --json
archctx export native --ref HEAD --profile repo-harness/v1 --format json
archctx export native --help
```

Exactly one source selector is required. The only profile is `repo-harness/v1`; the default and
only output format is JSON. Help and argument rejection do not read repository inputs. The
feature flag is `native-context-export-v1`. Existing diagram export commands keep their behavior.

## Sources and input closure

`--ref` resolves a commit-ish once, records the full commit SHA and tree OID, and reads selected
blobs by their fixed object IDs. Worktree edits and moving symbolic refs do not change that
snapshot. Missing selected objects fail locally; the reader disables lazy fetch and prompts.

`--worktree` includes tracked model paths (including tracked deletions) and nonignored untracked
model files, plus explicitly selected contracts and documents. It captures the full closure
twice, then checks membership, file identity and HEAD before returning. An observed change fails
with `native-context-input-changed`; rerun from a quiet worktree. This is a lock-free stable read,
not a transaction: an edit that returns to its original bytes and identity between observations
can escape detection. The reader takes no lock and performs no hidden retry.

Inputs are the manifest, direct `.yaml`/`.yml` files under the split model's `nodes`, `relations`
and `flows` directories, explicitly declared capability contract files, and architecture documents
selected by the existing documentation layout. `.gitkeep` is ignored. Nested model layouts,
symlinks, submodules, nested repositories and unsafe paths fail instead of producing partial data.
No schema file in the target repository is opened; canonical schemas are bundled with the reader.

Both selectors use local Git/filesystem reads. They do not create a daemon, task session, database,
CodeGraph index, model change, generated document or runtime receipt. Output goes to local stdout;
avoid persisting private contract or document bodies into shared logs.

## Payload and missing values

Success uses the existing envelope with `requestId: export.native` and data schema
`archcontext.native-context-export/v1`. It returns every canonical node, relation and flow with
original fields and all statuses, source paths, allowed node kinds, declared context budget,
capability profiles, deduplicated contracts, documents and sorted input records. `inputDigest`
binds the selected paths, roles, requirements, presence, modes and exact content digests.
Unrelated source edits do not change it. It is not an architecture freshness or acceptance proof.

Capability profiles expose the declared contracts, containment indexes and display-only literal
include anchors. Missing LSP or verification metadata is `null`; no defaults are invented. A
consumer may apply its own policy to those nulls. Declared missing contracts have `presence:
missing` and null text/size/digest. A present empty file has `presence: present`, text `""` and
zero bytes. Missing contracts stay in the input digest and do not block other consumers.

## Lossless human documents

Human regions are exact complements of validated generated blocks. Their text and byte/line
ranges retain BOM, CRLF, Unicode, fenced code, comments, blank lines and trailing whitespace.
Section 3 and literal `Optimization Backlog` are selected only from human H2 headings; headings
inside generated blocks, comments, fences or H3 subsections do not become section boundaries.
Duplicate matching headings fail as ambiguous. Each section distinguishes a missing document,
an absent heading, an empty body and a present body. Empty bodies retain their whitespace.

The current v6 producer remains unchanged. The reader additionally accepts only the observed v5
begin-marker shape with exactly `target`, `sourceDigest`, `rendererVersion` and `outputDigest`.
The renderer must be `archcontext.docs-renderer/v5`; both digest values require `sha256:` followed
by 64 lowercase hex characters. End markers contain only the matching target. Pairing, duplicate,
nested-region, target and generated-body checksum checks apply to both versions. Unknown versions
or attributes fail. Historical `sourceDigest` is read metadata; the reader does not compare it to
current sources or claim freshness.

The frozen public consumer corpus is `Ancienttwo/repo-harness` commit
`902c4ed7866f2b7359b1553a8cd64934496ea3c7`. Its 454 manifest/model inputs preserve the original
shared parser and consumer values. The additional 40 original v5 documents prove byte complement
and section coverage. The original strict-v6 rejection artifact is retained as historical evidence.
This reader does not change the consumer repository or establish that its old readers are removed.

## Limits and errors

The reader fails the whole response beyond 10,000 selected inputs, 8 MiB per file, 32 MiB total
input bytes, 32 MiB Git tree listing, or 64 MiB rendered JSON envelope including its final newline.
Each Git subprocess has a 10-second timeout; checked blob batches have a bounded 2 MiB framing
allowance. Large blobs are size-checked before body allocation. Data is never truncated.

Failures use existing error codes with closed native reason codes and bounded diagnostics:

| Condition | Example reason | Error code |
| --- | --- | --- |
| No Git worktree | `git-worktree-required` | `AC_REPO_NOT_FOUND` |
| No native model | `native-context-model-missing` | `AC_MODEL_ADOPTION_REQUIRED` |
| Invalid model, profile, UTF-8, marker or section | `native-document-marker-invalid` | `AC_SCHEMA_INVALID` |
| Unsafe path, revision or entry type | `native-context-path-unsafe` | `AC_PATH_DENIED` |
| Missing/unreadable blob or required input | `native-context-blob-unavailable` | `AC_PRECONDITION_FAILED` |
| Observed worktree drift | `native-context-input-changed` | `AC_PRECONDITION_FAILED` |
| Resource bound exceeded | `native-context-limit-exceeded` | `AC_PRECONDITION_FAILED` |

Only observed drift is retryable, with action `rerun-native-export`. Repair other inputs or
reduce their size before rerunning. Do not silently drop records, switch selectors, adopt a model,
regenerate documents or fall back to raw YAML parsing when this contract fails.

Model schema and reference failures report `details.issues`. Each reported issue keeps
`entityId`, `field`, and `invariant`. It also includes `path`, the repository-relative path
of the parsed file that holds the record. The reader binds paths to records. It does not
derive a filename from an ID. Duplicate, missing, and non-string IDs keep their source paths.
When all reported issues share one path, the failure boundary also sets `details.path`.
It computes this summary after it applies the diagnostic limits.
This applies to both `--ref` and `--worktree`.
For `native-context-path-unsafe` with model issues, the path identifies the file
that declares the unsafe value. It does not identify the unsafe value itself.
Path refusals without model issues keep their existing `details.path` meaning.

The `archctx-contracts` package adds optional `NativeModelIssue.path` and an optional third
argument to `nativeContextModelIssues`: a `ReadonlyMap<NativeModelRecord, string>`.
Callers must use the parsed record objects as keys. Old calls without this map retain their
three-field issues. The public issue schema is `schemas/runtime/native-model-issue.schema.json`.
Issues with source paths determine the summary even if a caller supplies a conflicting path.
Legacy issues without source paths keep an explicit path supplied by the caller.
Unknown source-index entries have no owner record, so those contract-only issues have no path.

Existing diagnostic limits still apply. At most 32 issues are reported. A diagnostic string
can use at most 256 UTF-8 bytes. The rendered failure envelope can use at most 8 KiB.
The failure boundary omits complete oversized issues or fields and reports omission counts.
It does not truncate paths or IDs.
Source paths count toward this budget, so fewer issues can fit in one response.
