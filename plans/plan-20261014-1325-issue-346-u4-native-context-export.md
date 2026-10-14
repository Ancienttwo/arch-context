# Plan: U4 native context export for repo-harness readers (#346)

> **Status**: Executing
> **Stage**: Design accepted in #349; implementation authorized as U4 sole writer.
> **Created**: 2026-10-14
> **Slug**: issue-346-u4-native-context-export
> **Artifact Level**: work-package design
> **Baseline**: 5e144af06c56a9d564d8a06356b732ded7f7fb22, including S4 #347 and D4 #348; reviewed design #349 at aadb427c79991e3bb987f3c89d11e51fb8047a75.
> **Promotion Reason**: replace downstream model and document parsers with one upstream read contract.
> **Verification Boundary**: this delivery changes only this plan; check scope, source references, requirements and whitespace. Product checks below belong to future implementation.
> **Rollback Surface**: revert the plan commit. Future implementation is a stateless additive reader and can be reverted without data migration.
> **Spec**: docs/spec.md
> **Upstream Issue**: https://github.com/Ancienttwo/arch-context/issues/346
> **Downstream Epic**: https://github.com/Ancienttwo/repo-harness/issues/690, R6
> **Implementation Start Gate**: S4 / PR #347 must be merged into main first; then the integration coordinator assigns a separate implementation worktree and sole writer. Before any CLI/main.ts edit, also confirm that D4 has released its write seat or that the integration coordinator explicitly hands over the exact shared hunk. S4 merge alone does not release D4's seat. This document does not authorize code, push, merge or publication.
> **Review Revision**: bounded P2 corrections — missing contract presence, duplicate-key coverage across all shared parser object constructors, canonical schema value constraints, and D4 CLI write-seat coordination.

## 1. Routing, sources and execution boundary

The U4 design owner prepares this plan; the integration coordinator owns integration and merge. Existing write-seat assignments remain authoritative. This design delivery contains no product implementation, scaffold, daemon call or architecture mutation.

Prepare and review this document in an isolated documentation worktree from the stated baseline. Keep the primary development checkout and the S4/D4 implementation worktrees unchanged; their assigned writers retain ownership. This plan does not require any particular machine, user directory or terminal layout.

Use root AGENTS.md and CLAUDE.md, .ai/harness/policy.json, .ai/context/context-map.json, .ai/context/capabilities.json, the plan template and repo-local skills as the repository workflow contracts. Planning is limited to this document and does not authorize product edits. Do not call prepare/checkpoint/complete solely to record the plan: those surfaces can create daemon-owned state and are outside the design scope.

The downstream design source is Ancienttwo/repo-harness, plans/plan-20261014-0209-architecture-debt-loop-690.md, sections 6.1 items 6–8 and 7.1 U4. The consumer source and frozen-corpus baseline is repo-harness@902c4ed7866f2b7359b1553a8cd64934496ea3c7. Use the relative consumer filenames/functions identified below; the downstream reader migration remains a separate R6 work package.

### P1: architecture and existing authorities

- contracts owns public JSON contracts, error vocabulary, canonicalization and schema validation. Canonical native schemas are schemas/repo/architecture-node.schema.json, architecture-relation.schema.json and architecture-flow.schema.json.
- architecture-domain owns parseJsonOrStableYaml, not Bun.YAML in another reader. Git-visible .archcontext model files remain the architecture authority under ADR-0040; SQLite is not an alternate source for this export.
- model-store-yaml owns model IO. The new reader belongs there and is independent of ModelStore write methods, runtime sessions, CodeGraph and ChangeSet.
- git-adapter already has readTrackedTreeEntries and a cat-file batch decoder inside readTrackedSourceFiles. Extract and harden that machinery, rather than copying repo-harness's CommitSnapshot or creating a temporary checkout.
- projection-engine/layout.ts owns repo-harness/v1 capability identity, explicit contract paths and modulePath. projection-engine owns the generated marker contract and native glob semantics.
- CLI is a thin trigger. The current export handler is in process but supports only mermaid, likec4 and structurizr and reads the current filesystem. context and agent-context do not provide this complete, commit-bound payload.

### P2: current consumers and missing coverage

repo-harness's model-reader.ts resolves HEAD once, lists its tree and reads blobs in batches, but parses YAML itself, validates a subset locally, translates capability profiles, and extracts section 3/backlog with heading regexes. state and capability-resolver have additional YAML readers. The U4 replacement must supply their actual inputs, not the smaller node shape used by diagram exports.

Current loadNativeModelFromArchContext / loadNativeModelFromModelFiles validates the node protocol, source shape and flow shape; it does not fully apply the canonical node/relation schemas or establish all uniqueness, containment and reference invariants. YamlModelStore.validateModel is also not a full native graph validator. Calling either alone is insufficient proof of a valid export.

humanOwnedMarkdownLines in prose-anchors.ts removes generated regions, fenced code, comments and blank lines. findGeneratedRegion in index.ts returns a normalized region-oriented slice. Neither can directly supply lossless human document bodies.

### P3: decision

Add one stateless native export contract, two explicit source selectors and one shared document-region scanner. Read input bytes first; parse, validate and derive profile values only from those captured bytes. A ref export never consults worktree bytes. A worktree export verifies the selected input set and bytes again before returning success. Use an additive implementation PR after S4; do not split publication into a schema-only feature and a later usable reader.

The fragile assumption is that downstream required policy metadata is already declared in native nodes. It is not true for every canonical ArchContext model, including this repository's baseline capability. Preserve missing optional metadata explicitly and let the downstream policy consumer reject an incomplete profile; do not invent values or migrate models inside U4.

## 2. Goal, acceptance and non-scope

The result is archctx export native --worktree or archctx export native --ref <commit-ish>, with profile repo-harness/v1. A consumer can obtain a complete validated native model, canonical node kinds, declared context budget, capability profile, explicit contract files, original component fields and lossless human document regions through the existing ArchctxClient transport.

Success requires:

1. One fixed commit/tree supplies every byte in ref mode, including manifest, models, contracts and documents. Branch movement, a dirty worktree or unrelated checkout cannot change the answer.
2. Worktree mode detects observed input membership, content, file-kind or HEAD changes during the read and refuses the result. It reports a validated stable read window, not an atomic filesystem transaction.
3. All node, relation and flow records pass the canonical schemas plus graph/path invariants. Invalid records are not dropped, including invalid flows.
4. Human content is not trimmed, reformatted, filtered or truncated. CRLF, fences, comments, blank lines and Unicode remain byte-preserving in exported UTF-8 strings/ranges.
5. Root contracts and shared contracts remain explicit, including declared paths whose files are missing. File presence is exported without blocking downstream contract status/creation; unreadable or unsafe existing files still fail. Literal filename anchors remain filenames; anchors have no ownership meaning.
6. Errors are typed for missing required inputs, invalid models, unsafe paths/refs, unavailable refs/blobs, observed read drift and size limits. No error becomes an empty success or a worktree fallback.
7. Packaged CLI and public contracts/schema fixtures are usable without repository source files, CodeGraph, daemon, SQLite or new credentials.

Out of scope: implementation in this planning delivery; release version selection or npm publication; changes to freshness, debt, complete, checkpoint, apply or acceptance semantics; CodeGraph queries or proof execution; resolving file ownership; ledger promotion; ChangeSets; editing .archcontext or generated docs; downstream YAML-reader deletion; plans/tasks artifact indexing; generated-summary freshness; model metadata migrations; support for additional export profiles or model layouts.

## 3. Current conflicts and their bounded resolutions

| Existing behavior / proposal conflict | Resolution in U4 |
| --- | --- |
| docs/spec.md describes thin CLI/MCP adapters sharing daemon RPC, while existing resolve/debt/docs anchors already have in-process read exceptions. | Record native export as another explicit stateless read exception in spec/runbook. Writes remain daemon/ChangeSet-owned. No generic CLI writer or daemon fallback. |
| Canonical node/v2 makes responsibilities and extensions optional. Downstream registry currently requires responsibilities, lspProfile and verification. This baseline capability lacks those metadata fields. | Export original field presence. lspProfile and verification are null when undeclared; present malformed values fail. Empty declared verification stays an empty array. R6's policy-specific thin projection may reject nulls; U4 does not supply typescript-lsp or verification defaults, or modify the baseline model. |
| parseRepoHarnessNodeProfile requires explicit contractFiles and derives a three-part capability identity, while the native schema allows other node identities. | Apply repo-harness/v1 requirements only to capability profile entries. Reject an incompatible capability identity or missing contractFiles with a typed profile error; never rename/skip the node. Non-capability native kinds remain fully exported. |
| Declared contract paths can exist in the model before their files exist. repo-harness@902c4ed capability-context.ts:226–247 displays exists state and :375–403 creates missing contracts. | Keep both path declarations mandatory and safe, but export each deduplicated file as presence present/missing. A missing file carries null text/byteLength/byteDigest and remains in inputs/inputDigest and worktree re-observation. Missing files are not export errors; existing unreadable/unsafe files remain errors. |
| primarySourceDirectory treats literal filenames as directories' parents and treats brackets/braces/! as wildcard boundaries; matchesGlob's canonical wildcard vocabulary is only * and ?. | Do not reuse primarySourceDirectory for includeAnchors. Derive display anchors from the existing globLiteralPrefixLength lexical rule, shared from a small source-globs module. Leave the legacy agent-context target behavior unchanged; its correction would be a separate write-path change. No copied registry anchor parser. |
| Projection read bodies normalize CRLF to LF for renderer comparisons. U4 must preserve human bytes. | Scan raw bytes. Keep normalization only in the existing projection integrity adapter when computing its established outputDigest. Never emit that normalized copy as human text. |
| Existing marker/citation adapters tolerate some malformed regions by treating them as missing or hiding uncertain text. U4 must reject ambiguity. | One scanner emits spans/tokens and diagnostics. Native export strictly rejects diagnostics; old adapters retain their existing result/error policy without keeping a second lexical parser. Valid-input projection/citation behavior must remain byte-compatible. |
| StableYamlParser.assignEntry overwrites duplicate keys; parseJsonOrStableYaml's whole-JSON branch and parseScalar's JSON object/array branch also use JSON.parse, which loses duplicate members before schema validation. The helper supports only a stable YAML subset. | Reject ambiguity at every object-construction entry: YAML mappings, whole JSON and JSON containers decoded by parseScalar, including nested objects and keys equal after JSON escape decoding. Keep all non-ambiguous accepted parsing values unchanged. Freeze the downstream corpus and its consumer values; unsupported constructs or mismatches are explicit coverage blockers, not permission for a general YAML rewrite or fallback. A syntax scan is not a parser conformance proof. |
| Canonical schema required means a key must exist; it does not imply that every string is nonempty. Node summary and relation intent permit empty strings. | Follow the canonical type/pattern/minLength/required constraints exactly, preserve empty component summaries and relation intents, and state additional capability-profile restrictions separately. Do not replace schema constraints with a blanket nonempty-field rule. |
| A lock-free worktree can change and return to its original bytes between observations. | Document that two complete observations detect observed drift, not every transient ABA edit. Verify path/file identity and bytes in both passes and immediately before response emission; do not promise serializable isolation or add a writer lock. |
| Issue #346 asks for API coverage confirmation; the detailed assignment proposes a new API and forbids a release promise now. | This plan maps existing gaps to the proposed contract. It does not assert that the API ships today or close #346. Integration coordinator confirms the implemented API and chooses release follow-through later. |

## 4. Public interface and data contract

### 4.1 CLI

The explicit forms are:

~~~sh
archctx export native --worktree --profile repo-harness/v1 --json
archctx export native --ref HEAD --profile repo-harness/v1 --json
archctx export native --ref <commit-ish> --profile repo-harness/v1 --format json
~~~

Exactly one of --worktree and --ref is required. The native subcommand defaults its profile to repo-harness/v1 if --profile is absent and accepts no other profile. It always emits the existing JSON envelope; --json and --format json are formatting aliases, not diagram format selectors. Duplicate selectors/values, missing values, unexpected positional arguments, unsupported formats/profiles and unknown flags fail before reading repository files. --help is read-free. Keep legacy diagram exports and their flag behavior unchanged.

Use requestId export.native and data.schemaVersion archcontext.native-context-export/v1. Advertise native-context-export-v1 only when the full reader and packaged smoke pass. Update ARCHCTX_FEATURES, the valid archctx-capabilities fixture and its schema together, alphabetically, as the final implementation advertisement change after S4 has landed.

### 4.2 Payload

| Field | Contract |
| --- | --- |
| schemaVersion | archcontext.native-context-export/v1. |
| profile | repo-harness/v1. |
| snapshot | source discriminator ref or worktree; fixed commitSha and treeOid in ref mode; observed headSha/headTreeOid in worktree mode; validation state stable-read for worktree, immutable-tree for ref. No absolute root, timestamp, branch-name identity or runtime identity. |
| inputDigest | Domain-separated digestJson over this export protocol, profile and the canonical input manifest described below. It identifies export inputs, not projection freshness or a receipt. |
| inputs | Byte-sorted path records with role, input requirement, presence, file mode, byte length and SHA-256 content digest. Required manifest/model inputs must be readable. Declared contracts and optional module documents permit presence missing: mode, byteLength and contentDigest are null, and the path/role/presence record remains part of inputDigest. |
| allowedNodeKinds | The exact ordered kind enum from the canonical architecture-node schema. No independently maintained local constant. |
| contextBudgetBytes | The declared positive safe integer at manifest.runtime.contextBudgetBytes. It is a consumer prompt budget, not a license to truncate the export. Missing/invalid values fail. |
| model.nodes / relations / flows | Every validated parsed record, with all canonical fields and extension values preserved, plus a separate id-to-source-path index. Arrays of records are ordered by bytewise ID; arrays inside records retain source order. Empty relation/flow sets are valid. |
| capabilityProfiles | Every capability, including planned/deprecated/removed ones: nodeId, status, domain, name, modulePath, contractFiles, includeAnchors, lspProfile, verification, directChildNodeIds and componentNodeIds. No active-only filter or ownership inference. |
| contracts | Unique declared AGENTS.md/CLAUDE.md paths, associated roles and capability node IDs, and presence present/missing. Present files carry raw UTF-8 text, byteLength and byteDigest; missing files carry null for all three. Shared/root files are represented once, even when missing. Both path declarations remain mandatory; file absence is a successful explicit state. |
| documents | Every mixed Markdown target from the canonical repo-harness layout, with path/targetId, associated capability IDs, missing/present document state, marker state, raw human regions and structured section3/backlog selections. Whole-file generated diagrams are not human prose inputs. |

The source-path index records the original file for each node, relation and flow. Do not regenerate reduced node objects through renderer adapters. Components' original summary, responsibilities, notes, source include/exclude/entrypoints, parent, ownership, interfaces, criticality, riskDomains and extensions retain their original presence and values. componentNodeIds is a containment index over component descendants whose nearest capability ancestor is this capability; directChildNodeIds names all direct children regardless of kind. Neither index claims source ownership.

Profile derivation reuses parseRepoHarnessNodeProfile and resolveArchitectureDocumentationLayout; do not derive modulePath from a second naming convention or consult the applied projection manifest. Explicit contractFiles paths are never rewritten from source prefixes. Deduplicate shared contract reads without rejecting multiple capabilities that declare the same root files.

Contract presence is not inferred from an IO failure. Missing means the selected source confirms no terminal entry after safe ancestor checks. An existing file that is unreadable, unsafe, a directory/link/gitlink, or whose recorded blob is unavailable fails the export. A present zero-byte contract remains present with empty text, zero byteLength and its real digest; it is not missing. A missing agents file, a missing claude file, or both missing must still allow capability-context status and later contract creation through downstream's existing writer.

For includeAnchors, use the literal complete path segments before the first * or ? segment. A wildcard inside a filename stops before that entire filename segment. Preserve literal bracket directories. Examples: src/app/[locale]/** gives src/app/[locale]; src/a.ts gives src/a.ts; src/a-*.ts gives src; **/*.ts yields no anchor. Duplicate anchors are removed in byte order. Do not expand globs, query the filesystem to reinterpret a filename, or use anchors for ownership. Source include/exclude remain verbatim in the native records; archctx resolve remains the ownership authority.

## 5. Snapshot and input reader

### 5.1 Selected inputs

The supported model is the canonical split layout: .archcontext/manifest.yaml, model root .archcontext/model, and direct .yaml/.yml children of nodes, relations and flows. Require the manifest's supported schemaVersion/layout/root and at least one node. Reject an incompatible declared layout/root; do not silently read a different hard-coded root. Git cannot represent an empty directory, so an absent relations/flows tree means an empty set; a malformed entry or declared reference is not an empty set. Unexpected nested model records cannot be silently omitted from a complete-model claim: reject unsupported nesting/entry kinds with their path.

After validating the captured model, derive the explicit contract paths and mixed document paths. Read only these additional paths. Source files selected by include globs, plans, tasks/contracts, ADR indexing, runtime state, .codegraph, source bodies and unrelated human architecture documents are not traversed for this export. Model selector paths are validated as paths/references, not opened as source code.

The closure includes optional absent module documents, all declared contract paths whether present or missing, and deduplicated shared paths. Every input path/state/raw digest participates in inputDigest; a missing contract uses a presence missing record with null byte fields rather than being omitted. Do not hash only the parsed model: comments, CRLF and human doc changes are still changes to the captured inputs. Identical raw inputs/profile give the same inputDigest across ref and worktree modes; snapshot identifies the source mode separately. Use the existing digestJson/content hashing convention and byte ordering, not localeCompare-based ordering or a second repository identity walker.

### 5.2 Ref mode

1. Validate the revision argument with the shared Git revision guard before spawning Git. Reject empty, option-shaped, whitespace/control/NUL-containing arguments. Pass argv directly, never through a shell. Preserve safe commit-ish forms such as HEAD~1 and annotated tags.
2. Resolve once using rev-parse --verify --end-of-options with the commit peel. Require exactly one full commit OID; resolve its tree from that OID. Reject missing, ambiguous or non-commit selectors. Never resolve the caller's symbolic ref again during this export.
3. List the fixed tree's relevant entries with NUL-delimited Git output; retain mode and objectId. Check every parent component used by an input path. Reject symlink mode 120000, gitlinks/submodules, non-regular files, invalid UTF-8 path bytes and unsafe path aliases in the selected input closure.
4. Read model/config blobs by object ID in a batch, derive the second input closure, then read present contracts/docs by object ID in a second bounded batch. A safely absent declared contract path produces its missing/null presence record, never a worktree lookup. A present entry with an unavailable blob still fails. Every batch is bound to the same tree. This is two IO batches, not two snapshots.
5. Validate batch headers against requested OID, object type and exact byte length, verify terminators and buffer bounds, and detect missing/corrupt/truncated responses. SHA-1 and SHA-256 repositories are supported. A missing object cannot trigger lazy fetch or a local filesystem fallback.

Use Git read-only options and GIT_NO_LAZY_FETCH=1; disable optional index locking/fsmonitor and suppress pager interaction. Do not use checkout, git worktree, git archive extraction, index writes, read-tree, filters, fetch, daemon or DB access in the implementation. Existing detached-review worktree helpers are specifically not the native export reader.

A branch moving after resolution is allowed: the result still reports and reads the originally fixed commit/tree. A force-deleted object that becomes unreadable fails with the typed blob error. Git objects and .git metadata are the only repository IO in ref mode; dirty/missing/symlinked worktree counterparts must have no effect.

### 5.3 Worktree mode

1. Capture repository root and HEAD/tree identity. Enumerate candidate input membership, preserving tracked-deleted and unsafe entries rather than using listGitVisibleFiles's regular-file filter to erase them. Include non-ignored untracked model files. Explicit derived contract/doc reads belong to the selected closure, not a repository-wide source scan.
2. Read raw bytes through segment-safe regular-file checks. Check directory/file identities around descriptor open/read and reject symlinks, junctions/reparse links, submodules and repository escapes. Track required manifest/model absence, declared contract presence present/missing and optional document absence separately. An existing unreadable file is not a missing file.
3. Parse/validate/derive from this first captured manifest/model. Assemble the full contracts/doc input closure and serialized output within the size bounds.
4. Repeat membership enumeration, manifest/model-derived path closure, presence of every declared contract path (including initially missing files), raw content hashes, file types/identities and HEAD/tree checks immediately before emission. Addition, deletion, rename, replacement, changed bytes, changed declared doc/contract paths, missing-to-present or present-to-missing contract transitions, or HEAD movement produces native-context-input-changed. Emit no successful partial payload.
5. One attempt only. Return a retryable typed error to the caller on observed drift; do not silently retry until a different tree becomes the accepted result.

No read lock or writer coordination token is acquired. Unrelated file edits that do not alter this input closure do not change inputDigest. A moved HEAD is still a snapshot precondition failure even if the relevant bytes happen to match. The documentation must explain the lock-free ABA limitation instead of calling this an atomic snapshot.

## 6. Full model validation and resource bounds

Parse each manifest/model input with parseJsonOrStableYaml; contract and Markdown document bodies are raw text and never go through the YAML parser. Reuse validateJsonSchema and the fixed canonical schema resolver, including $ref, allOf/oneOf, contains/minContains and not-applicable flow branches. Never use another YAML library, Bun.YAML fallback or regex schemaVersion extraction. Empty/invalid model input and duplicate object keys fail. This correction is limited to ambiguity detection; it must not change the values produced for non-ambiguous inputs accepted by the existing shared helper or become a general YAML rewrite.

Duplicate-key rejection must cover every object-construction entry in the shared helper: StableYamlParser.assignEntry, the whole-document JSON.parse path in parseJsonOrStableYaml (baseline architecture-domain/index.ts:476–480), and JSON objects/arrays decoded by parseScalar (baseline :907–913). Route JSON container decoding through one shared checked decode path that detects duplicate members before JSON.parse discards them, including nested objects inside arrays and keys that are equal after JSON escape decoding. Checking the resulting object or a JSON.parse reviver is insufficient because the duplicate is already lost. Equality is decoded key equality within one object, not global key uniqueness or Unicode/case normalization. The YAML mapping guard remains in its existing constructor. Do not add a native-only parser or alternate semantic JSON/YAML decoder.

Freeze a manifest/nodes/relations/flows corpus from repo-harness@902c4ed7866f2b7359b1553a8cd64934496ea3c7, with source paths/content digests and expected parsed values from the current downstream consumer. For its non-ambiguous accepted inputs, assert identical shared-helper values before/after the ambiguity correction and parity with the frozen consumer values. Any unsupported syntax or value mismatch must be listed by source path/construct as a U4 coverage blocker requiring a separately reviewed shared-parser change; a syntax grep is not proof of complete support. No fallback, silent coercion or general syntax expansion is authorized by this plan revision.

Known baseline language-support gaps include YAML comments, single-quoted scalars, block scalars, anchors/aliases/tags and flow-style containers that are not valid JSON. A required corpus input using one of these constructs, or producing a different value from the frozen consumer oracle, blocks that consumer's U4 coverage confirmation. Enumerate the exact source paths and constructs; do not label the YAML-reader replacement complete merely because schemas accept the shared helper's output. This ambiguity-only correction does not repair those language features.

The pure native validation routine checks:

- schema shape/protocol for every node, relation and flow, including unknown forbidden fields; apply the canonical type, pattern, minLength and required constraints exactly. required checks key presence only and does not imply nonempty strings. In particular, preserve an empty component summary and an empty relation intent when the canonical schema permits them;
- unique IDs across model entities and unique selector IDs where a reference would otherwise be ambiguous; do not add blanket nonempty checks beyond canonical field constraints;
- every parent exists and every parent chain is acyclic (including self cycles);
- every relation source/target and optional via references an existing node;
- every flow capabilityId names a capability; participant IDs are unique within a flow and each participant's nodeId exists;
- all step/outcome from/to/terminal references name declared participants; outcome IDs are unambiguous; repeated step identities cannot disagree about their definition;
- entrypointId/sourceSymbol/sinkId references resolve to a declared model selector tuple, including outcome steps. This checks declaration integrity only, never code-symbol existence or P2 proof;
- all model path-bearing fields and profile/doc/contract paths obey repository-relative POSIX safety. Reject absolute/drive/UNC paths, backslashes, controls, empty/dot/parent segments and escaping aliases. Validate globs without changing the canonical * / ? ownership grammar;
- separately declared repo-harness/v1 profile restrictions: a capability uses the three-part capability.<domain>.<name> identity accepted by parseRepoHarnessNodeProfile; both explicit contract path declarations are nonempty safe paths ending in the appropriate AGENTS.md/CLAUDE.md basename; derived module paths are unique; a declared lspProfile is a nonempty string, and declared verification is an array of strings (empty array allowed). Undeclared lspProfile/verification remain null. These restrictions do not make all native node names/summaries or relation intents nonempty, require contract file existence, or modify optional native fields/shared declarations.

Put the pure native invariants with the new contracts/native-context contract; IO stays in model-store-yaml. This does not redirect existing daemon validation, freshness or apply through the new reader. The published export schema references the existing node/relation/flow schemas, and allowedNodeKinds is taken from their canonical node kind enum, not repeated in a new authority. The reader bundles those schema documents; it cannot read arbitrary schema files from the user's repository or resolve schemas over the network.

Initial fixed resource bounds, owned/exported by the native context contract: 10,000 selected input files; 8 MiB per text input; 32 MiB total input bytes; 64 MiB complete JSON response including envelope/newline; 10 seconds per Git read process. Check sizes before body allocation where metadata is available, then validate actual bytes and the final UTF-8 response size. Git listing/batch limits must also be explicit; cap tree-list output at 32 MiB and batch response at total input limit plus bounded protocol overhead. No user flag disables these limits. A boundary excess returns a typed error with the named limit/observed amount and no partial data. contextBudgetBytes never caps native export content.

No new service, runtime, external API, MCP server, account or credentials are required. Runtime prerequisites are existing Git, the supported Node range and pinned Bun development tooling. No new npm parser dependency is needed. At 10x model/doc volume, bounded tree metadata and duplicated section text can hit the fixed limits; refusal is the designed behavior. Do not promise the debt RFC's three-second edit-time budget for a complete native export.

## 7. Shared lossless document scanner

Create projection-engine/document-regions.ts by extracting the generated marker lexer/span logic from index.ts, with offset-preserving human/generated slices and diagnostics. Native export, the existing findGeneratedRegion adapter and humanOwnedMarkdownLines all consume it. Citation fence/comment filtering remains an upper-layer transform over human spans. No consumer keeps a second BEGIN/END regex parser.

The scanner reads valid UTF-8 raw bytes and retains byte offsets, line numbers and original terminators. Marker-looking text in Markdown fences or ordinary HTML comments is literal content; reserved standalone/inline projection marker tokens outside those literals use the existing marker grammar. All non-generated bytes are returned as ordered humanRegions, including document title, scaffolding, arbitrary sections, comments and whitespace. Do not rewrite the text into Markdown lines or normalize BOM/CRLF.

For an actual marked document, native export rejects duplicate/nested/overlapping generated regions, unmatched/mismatched BEGIN/END, repeated attributes, malformed reserved marker syntax, unexpected target identity, unsupported renderer metadata and outputDigest integrity mismatch. Missing marker means markerState absent and the file remains human content; a lone broken marker is an error, not absent. Verify generated-body outputDigest with the existing renderer normalization/digest adapter without rendering new content or reading the projection manifest. Legacy projection adapters preserve their externally observable policy; the scanner supplies shared facts rather than changing apply's decisions.

Section recognition belongs to this shared document analysis layer. Recognize top-level human H2 section 3 headings (the existing numbered 3. slot, across legacy/en/zh-Hans/zh-Hant renderer headings) and the literal Optimization Backlog heading. Ignore apparent headings in fences/comments/generated spans. A section ends at the next actual human H2, not at an H3 or an example inside a fence. Do not choose the first of two matching section 3 or backlog headings: return native-document-section-ambiguous.

Each selected section records its exact heading bytes/range, ordered body ranges into humanRegions, and body text formed only from those ranges without inserted separators. Preserve all original body bytes; whitespace is used only to classify an empty body. Body text containing comments or a fence counts as content even if the citation layer would ignore it. Multiple human ranges retain their positions rather than pretending that removed generated bytes were adjacent text.

Section states are closed and distinct:

| State | Meaning |
| --- | --- |
| missing | The optional module document was not present in the selected source. Heading/body are null and ranges empty. |
| absent | Document exists but this human heading does not. Heading/body are null and ranges empty. |
| empty | Heading exists and body has only whitespace or zero bytes. Preserve that whitespace body, not null. |
| present | Heading and non-whitespace body exist. Preserve the exact body. |

Malformed markers and duplicate/ambiguous headings are errors, not a fifth successful state. All other human sections still survive in humanRegions, even when neither named section is present. No archived/orphan document discovery or plans/tasks header parser is added here.

## 8. Typed errors

Use the existing envelope/error code vocabulary, with a closed NativeContextReasonCode list, structured details and explicit actions/retryability in the new contract. Error text is diagnostic only; consumers dispatch on code/reasonCode. Do not extend AC_REFACTOR_RUN_TOO_LARGE to this unrelated reader.

| Code | Reason family | Details / handling |
| --- | --- | --- |
| AC_REPO_NOT_FOUND | git-worktree-required | Open a Git repository; no filesystem fallback. |
| AC_SCHEMA_INVALID | native-context-arguments-invalid, native-context-profile-invalid | Name offending flag/profile; no read for argument errors. |
| AC_MODEL_ADOPTION_REQUIRED | native-context-model-missing | Missing manifest or no native nodes; do not init/adopt automatically. |
| AC_SCHEMA_INVALID | native-context-model-invalid, native-context-budget-invalid, native-context-profile-incomplete, native-context-text-invalid | Path, entity ID/field and invariant reason; no dropped record/default metadata. Optional null LSP/verification is declared absence, not this error. |
| AC_SCHEMA_INVALID | native-context-input-ambiguous | Source path, parser branch/object location and duplicate decoded key; covers YAML mappings, whole JSON and inline/nested JSON containers. Do not include input values. |
| AC_PATH_DENIED | native-context-path-unsafe, native-context-entry-kind-unsupported, native-context-ref-unsafe | Safe path/role facts only; never dump input bodies or Git credential/environment output. |
| AC_PRECONDITION_FAILED | native-context-ref-unavailable, native-context-blob-unavailable, native-context-input-missing, native-context-input-unreadable | Requested source/path and local availability facts; missing required manifest/model inputs or an existing unreadable input fail. A safely absent declared contract is a successful missing/null record, not this error. No worktree or lazy-fetch fallback. Non-retryable until the caller changes/restores the input. |
| AC_PRECONDITION_FAILED | native-context-input-changed | Changed paths and identity/digest mismatch kind, bounded diagnostics; retryable, action rerun-native-export. |
| AC_SCHEMA_INVALID | native-document-marker-invalid, native-document-section-ambiguous | Path/target/ranges and diagnostic kind; no human-text excerpt required. |
| AC_PRECONDITION_FAILED | native-context-limit-exceeded | Limit name, maximum and observed bytes/count; non-retryable for the same inputs; no truncation. |
| AC_PRECONDITION_FAILED | native-context-git-read-failed | Failed read operation and timeout/unavailable category; no raw command stderr or environment echo. |

Both contract path declarations are required profile metadata, but their files may be safely missing in the selected source. Export the declared path and presence missing with null text/byteLength/byteDigest, keep it in inputs/inputDigest, and re-observe it in worktree mode. Optional module document absence uses its documented missing state. Existing unreadable/unsafe contracts, unavailable blobs for present entries, invalid/ambiguous models, missing refs, links and resource failures always fail the entire export; no partial-success mode is advertised. Operational error details may be bounded but must mark omitted diagnostic count; the successful model/document payload is never silently truncated.

## 9. Package/file ownership and implementation order

This is more than eight files and spans four logical components: contracts, Git/model IO, projection document/profile analysis and CLI. Keep it one usable additive PR, with internal commits in the following order. Do not start any of these commits before #347 merges and the integration coordinator assigns the independent writer. CLI/main.ts has an additional D4 write-seat gate: before editing it, confirm D4 has released the seat or obtain the integration coordinator's explicit handoff of the exact shared hunk. S4 merge or ownership of this U4 branch alone does not authorize that shared edit.

~~~text
CLI/native-context
       |
       v
model-store-yaml/native-context ----> git-adapter/blob-reader (read-only)
       |
       +----> contracts/native-context + canonical schemas
       |
       +----> projection-engine/document-regions + layout profile
                         |
                         v
                 canonical glob lexical helper
~~~

Core/contracts must not import local-runtime or surfaces. IO is in local-runtime; the CLI imports the narrow model-store-yaml native entry rather than the local-runtime root barrel. Avoid a layout.ts -> projection-engine/index.ts cycle: move the existing globLiteralPrefixLength helper into source-globs.ts and re-export it unchanged from index.ts. The new anchor projection uses that helper; ownership matching and the legacy primarySourceDirectory behavior remain unchanged.

| File group | Intended change |
| --- | --- |
| packages/contracts/src/native-context.ts; src/index.ts | Public export/section/input/profile types, limits, reason vocabulary and pure invariants. Re-export the new contract. |
| schemas/runtime/native-context-export.schema.json; packages/contracts/fixtures/valid/native-context-export.json; fixtures/invalid/native-context-*.json; test/native-context.test.ts | Canonical schema references, valid complete payload and targeted invalid cases. Published schema resolver and packaging assertions include the new artifacts. |
| packages/local-runtime/git-adapter/src/blob-reader.ts; src/index.ts; test/blob-reader.test.ts | Extract checked NUL tree-entry and batch-blob machinery; fixed revision/tree reader; keep existing tracked source metrics behavior through the same decoder. No detached worktree creation. |
| packages/local-runtime/model-store-yaml/src/native-context.ts; src/index.ts; test/native-context.test.ts; test/fixtures/native-context/** | Two source adapters, selected input closure, manifest budget/model validation, read stability and assembled native contract. Only fixture writes in tests. |
| packages/core/projection-engine/src/document-regions.ts; test/document-regions.test.ts | Single raw-byte generated/human scanner, strict native diagnostics and human section selections. |
| packages/core/projection-engine/src/source-globs.ts; layout.ts; index.ts; prose-anchors.ts; test/layout.test.ts; test/prose-anchors.test.ts | Share existing literal-prefix rule; derive profile/anchors once; adapt existing marker/citation readers without changing freshness/debt/apply semantics. These shared edits are serialized after S4. |
| packages/core/architecture-domain/src/index.ts; test/domain.test.ts; model-store-yaml/test/fixtures/native-context/downstream-corpus/** | Bounded ambiguity correction across YAML mappings, whole JSON and inline/nested JSON containers, including escaped-equivalent keys; freeze downstream corpus/value parity. No semantic parser rewrite. Unsupported corpus constructs/value mismatches are explicit blockers requiring separate review. |
| packages/surfaces/cli/src/native-context.ts; src/main.ts; test/native-context.test.ts | Thin native command dispatcher, subcommand flag/help preflight and typed JSON output. Keep legacy export behavior and runtime() untouched. Edit main.ts only after D4 releases its write seat or the integration coordinator explicitly hands over the shared hunk. |
| contracts/src/projection.ts; contracts/fixtures/valid/archctx-capabilities.json; schemas/runtime/archctx-capabilities.schema.json | Final feature advertisement trio; no changes to projection classification/result semantics. |
| scripts/packaged-cli-smoke.mjs; contracts/test/publishability.test.ts; docs/spec.md; docs/runbooks/native-context-export.md | Packaged stateless smoke and schema availability; document the new read exception, source selectors, lossless states and limits. No publish-script invocation. |

The future implementation scope excludes runtime-daemon freshness/debt/apply/complete handlers, their schema/results, .archcontext model files, docs/architecture generated outputs and repo-harness sources. Existing package export barrels can re-export the new narrow functions; no root umbrella import is introduced merely to expose them. Any extra shared-file change must be named in the implementation contract before it is edited.

Shared integration points are projection-engine/index.ts scanner/glob extraction, layout.ts profile derivation, CLI/main.ts dispatch and the feature advertisement trio. #347 owns projection classification and some of these shared surfaces. After its merge, reread their exact content in the new implementation worktree and apply the bounded extraction to that base. Independently confirm D4's CLI/main.ts seat is released, or record the integration coordinator's explicit shared-hunk handoff and its boundaries before any edit; do not infer release from #347 merging. Do not cherry-pick this plan into S4, rebase S4, take S4/D4's claim or modify their daemons/worktrees.

## 10. Consumer mapping: repo-harness epic section 6.1 items 6–8

| Existing consumer | Native export source | Downstream boundary |
| --- | --- | --- |
| Item 6: scripts/capability-resolver.ts readArchcontextNodeFiles and assets/templates/helpers copy; capability-context callers | --worktree model.nodes plus capabilityProfiles, contracts.presence and inputDigest | R6 deletes YAML reads/casts and uses ArchctxClient. capability-context.ts:226–247 can display declared-but-missing contract files, and :375–403 retains its existing creation writer; export does not block either consumer on file absence. Active-only display is a caller selection, not a completeness filter. |
| Item 6: state/resolve-effective-state.ts parseNodeYaml/loadArchcontextAuthority | --worktree capabilityProfiles, declared null metadata and source input identity | Registry mode remains separate. No fallback from archcontext failure to registry. Missing policy-required metadata yields a typed downstream rejection; no shadow parser/default. |
| Item 6: architecture/model-reader.ts HEAD reader and schema checks | --ref HEAD snapshot, complete canonically validated model, allowedNodeKinds, contextBudgetBytes, contracts/documents | Remove CommitSnapshot/model YAML/schema duplicate only once the upstream contract and frozen downstream parsing-value parity pass; unsupported corpus constructs/mismatches are explicit blockers. Ref reads stay isolated from the checkout. Invalid flows fail upstream; empty summaries/intents allowed by the canonical schemas are preserved. |
| Item 6: model-reader.ts worktree model reads; archctx-provider's remaining model-derived contract reads | --worktree model/profile/contract metadata or --ref for the required source mode | Reuse the sole ArchctxClient and shared response identity; no second process transport. |
| Item 7: capabilityRegistryFromArchcontextNodes and archcontextIncludeAnchor | capabilityProfiles contractFiles/modulePath/includeAnchors/lspProfile/verification, contracts.presence and native records | Keep only a thin policy/field-name projection if ContractScopeGuard/workstreams/context blocks require it. Anchors remain display/discovery values; archctx resolve decides ownership. Explicit root/shared contract paths survive even if their files are missing; literal filename anchors survive. Policy restrictions remain separate from canonical model validation. |
| Item 8: MODEL_NODE_KINDS, module component summaries | allowedNodeKinds and full model records/containment indexes | Delete copied kind enum and reduced native casts. Graph grouping/display nodes remain presentation, not canonical model kinds. |
| Item 8: section3FromMarkdown/backlogFromMarkdown | documents.humanRegions and structured section3/backlog states/ranges/text | Delete heading/marker slicing. UI may map explicit states to its own display labels but cannot equate missing, absent and empty evidence. |

plans/tasks artifact indexing, linked plan/contract status headers, workstream policy, prompt construction and graph display grouping stay downstream. U4 does not scan plans or tasks/contracts to provide linked_docs. Generated-summary freshness remains a separate upstream check response joined by the downstream consumer to the same commit; native export does not invent fresh/stale state.

After implementation, the integration coordinator provides the coverage confirmation on #346 and the exact feature/schema contract for R6. Do not claim that downstream reader deletion is complete, or promise a target release number in this plan.

## 11. Verification matrix and acceptance commands

| Test family | Required cases and oracles |
| --- | --- |
| Selector/CLI | Missing/both/duplicate selectors, missing ref/profile values, unknown flags, unsupported profile/format, --help with zero reads, --json/--format json parity and unchanged legacy exports. |
| HEAD/worktree isolation | Dirty manifest, node, contract and module doc affect only --worktree; --ref HEAD reads committed blobs even if on-disk counterparts are deleted or symlinked. Two separate worktrees at the same commit give identical ref inputDigest/payload apart from no local identity fields. |
| Moving refs | Move a branch after resolve and between the two blob batches; response still uses original commit/tree. Annotated tag/HEAD~1/full and abbreviated SHA work; ambiguous name, nonexistent/non-commit ref and unavailable promised blob fail without fallback/fetch. |
| Git/path safety | Option-shaped/output-shaped refs, whitespace/NUL/control input, absolute/drive/UNC/traversal paths, symlinked ancestors/files, junctions, gitlinks and selected non-UTF-8 paths fail. Batch wrong OID/type/size, short body/terminator and oversized listings fail. SHA-1/SHA-256 and quoted-looking UTF-8 filenames are handled without C-quote parsing. |
| Model completeness | All eight canonical node kinds; original component fields/extensions; all statuses; duplicate IDs; missing/self/cyclic parents; invalid relation endpoints/via; missing flow capability/participants/outcome terminals/selectors; required/not-applicable flow schema cases. Preserve empty component summary and relation intent when schema-valid; reject omitted required keys and values violating type/pattern/minLength. No invalid-record omission or blanket nonempty rule. |
| Shared parsing ambiguity / corpus parity | Duplicate YAML mapping keys, whole JSON members, parseScalar JSON objects/arrays, nested object members and escaped-equivalent keys all fail before overwrite. Same keys in separate objects and key-looking text inside strings remain valid. Frozen downstream manifest/node/relation/flow sources produce unchanged shared-helper values and match the frozen consumer oracle; enumerate unsupported syntax/value mismatches as coverage blockers. No general YAML rewrite/fallback. |
| Profile/contracts/anchors | Explicit root contracts shared by multiple capabilities; nested paths; only agents missing, only claude missing and both files missing export explicit presence/null bytes without error; present empty files remain present. Existing unreadable/unsafe files and unavailable present blobs fail. Missing path declarations still fail. Test separate profile restrictions, module collisions, no source-derived path rewrite, literal/bracket/wildcard-only/overlapping anchors, malformed present LSP/verification and absent/null metadata without defaults. |
| Human documents | LF/CRLF, Unicode/BOM, trailing blanks, comments, backtick/tilde fences, headings/markers inside literals, all renderer section-3 languages, H3 inside a section, missing/absent/empty/present, duplicate headings, malformed/mismatched/duplicate/nested markers, wrong target and bad outputDigest. Assert exact UTF-8 span round trips, not trimmed strings. |
| Worktree stability | Add/remove/rename/replace model inputs; change manifest budget/profile paths; edit contracts/human bytes; create/delete an optional doc; create one or both initially missing contracts, delete a present contract, swap a path to a link, or move HEAD during each read boundary. Missing-to-present transitions, including a newly created empty file, must produce input-changed; missing paths remain in the digest/re-observation closure. Use deterministic injected read hooks, not sleeps. Unrelated source edits do not move inputDigest; ABA remains a disclosed limitation. |
| Bounds | Exactly-at and over per-file/count/input/listing/response limits, multibyte UTF-8 accounting, large lossless human sections and contextBudgetBytes smaller than the response. Over-limit exports fail; no truncated success. |
| No side effects | Fresh isolated HOME/state directories; byte-identical worktree/index/runtime files before/after; no daemon process/control files, SQLite opens, CodeGraph/index reads, ChangeSet calls, checkout/worktree creation, network or lazy fetch. Throwing runtime/CodeGraph adapters prove the command does not use them. |
| Integration | Shared marker/citation/layout and Git metrics regressions; feature/schema/fixture parity; published canonical schemas and native export artifact present; packaged Node CLI works with repository development dependencies unavailable. |

Run from the future implementation worktree after dependencies are prepared through the repository's normal setup:

~~~sh
bun run typecheck
bun test --timeout 60000 packages/contracts/test/native-context.test.ts packages/contracts/test/contracts.test.ts
bun test --timeout 60000 packages/local-runtime/git-adapter/test/blob-reader.test.ts packages/local-runtime/git-adapter/test/git-adapter.test.ts
bun test --timeout 60000 packages/local-runtime/model-store-yaml/test/native-context.test.ts
bun test --timeout 60000 packages/core/projection-engine/test/document-regions.test.ts packages/core/projection-engine/test/layout.test.ts packages/core/projection-engine/test/prose-anchors.test.ts
bun test --timeout 60000 packages/core/architecture-domain/test/domain.test.ts
bun test --timeout 60000 packages/surfaces/cli/test/native-context.test.ts
bun test --timeout 60000 packages/contracts/test/publishability.test.ts
node scripts/package-boundary-audit.mjs
node scripts/packaged-cli-smoke.mjs
bun run verify
~~~

These paths include proposed new tests; they are not runnable until the implementation creates them. No product test pass is claimed by the plan commit. Packaged smoke uses an explicit complete fixture declaring profile metadata and contracts. The real baseline fixture with undeclared optional metadata must also return explicit nulls rather than require a hand-edited model. Run the existing hosted OS/Node matrix before merge; Windows coverage matters for CRLF, path safety and descriptor/link checks.

Manual implementation acceptance: export a fixed local commit and its dirty worktree; compare captured commit/tree, complete entity counts, inputDigest changes and byte-preserved section text. Deny network/CodeGraph/runtime access and confirm both selectors still work. Validate the emitted native response through the staged public schema/resolver. Attach an item 6–8 mapping and actual error examples to the PR evidence, without sending raw private document bodies into ledger artifacts.

## 12. Risks, stop conditions and rollback

| Risk | Mitigation / stop condition |
| --- | --- |
| S4 or another assigned writer owns a shared file, including D4's CLI/main.ts seat after S4 merges. | Wait for #347 merge and the integration coordinator's writer assignment; refresh the base and claims. Before editing CLI/main.ts, also confirm D4's seat is released or the integration coordinator explicitly hands over that exact shared hunk. S4 merge alone is insufficient. No implementation in the plan, S4 or D4 worktree, and no claim takeover. |
| Scanner extraction changes existing projection/citation behavior. | Preserve adapters and valid-input bytes; run established regression suites. Stop rather than rewrite freshness/debt/apply to accommodate the export. |
| Canonical parser cannot preserve a valid frozen downstream construct, or an ambiguity guard changes accepted values. | Require frozen corpus/shared-helper before-and-after/consumer value parity. List each unsupported construct or mismatch as a coverage blocker; only the reviewed duplicate-key ambiguity correction is in this revision. Broader shared-parser support needs separate review. Never switch to a native-only parser or fallback. |
| Missing contract presence is mistaken for a failed or unmeasured read. | Keep declared paths with present/missing and null byte fields only for safely confirmed absence. Existing unreadable/unsafe files still fail. Include missing paths in inputDigest and re-observation so creation during a worktree read is detected. |
| Upstream model profile differs from downstream assumptions. | Export absence explicitly or fail a required profile invariant; report the field mismatch. Do not repair model YAML, coerce IDs or add defaults. |
| Read-only Git attempts network/filter/checkout work. | Disable lazy fetch and expose only whitelisted read operations; no-side-effect tests fail the implementation. |
| An observed concurrent edit makes the output inconsistent. | Ref uses fixed OIDs; worktree compares two whole input closures and refuses drift. Disclose ABA limits, no lock claim. |
| Lossless data exceeds bounds or private data is accidentally persisted. | Fail the complete export on limits. Return local stdout data only; do not record bodies in runtime/ledger/evidence files. |
| Public schemas work from repo-relative paths but fail when packaged. | Stage/import smoke must pass without repository files. No schema duplication or publication-script workaround. |

Rollback of the implementation is a revert of its additive API, feature advertisement and shared pure extractions; no stored model/runtime format is changed. The integration coordinator handles any published consumer/version rollback separately. If a stop condition is hit, leave a typed design/implementation finding and the exact affected file/range for the integration coordinator; do not broaden U4 into downstream migrations or write-path repair.

## 13. Workflow inventory and handoff

This design document does not activate an Approved/Executing implementation contract. Its review unit is the plan under plans/; product work starts only after design acceptance, dependency completion and write-seat coordination. The integration coordinator owns publication and the upstream coverage confirmation.

Once the integration coordinator accepts the plan and #347 is merged, the assigned implementation writer creates its own branch/worktree from the then-current main containing #347. Before any CLI/main.ts edit, it must also record D4's confirmed write-seat release or the integration coordinator's explicit handoff of the shared hunk and its boundaries; plan acceptance/S4 merge/U4 branch ownership does not release that seat. Its work package uses this plan's basename for tasks/contracts, tasks/reviews and tasks/notes artifacts, records explicit allowed_paths from section 9, and projects an active plan/owner through the repository harness. Check records belong at .ai/harness/checks/latest.json and run evidence under .ai/harness/runs; tasks/current.md remains a derived snapshot, not a claim. Execution artifacts belong to the assigned implementation worktree; never adopt another writer's existing marker.

The implementation reviewer verifies every section 11 family and the scope exclusion, then the integration coordinator controls PR/merge and the #346 coverage confirmation. Publication/pin upgrades and downstream R6 remain separate owner decisions; this document makes no version commitment.

## Task Breakdown

- [x] Inspect rules, exact baseline, existing export/model/Git/marker/profile behavior and downstream items 6–8.
- [x] Define source selectors, public contract, full validation, lossless regions, typed failures and bounded resource policy.
- [x] Identify current architecture conflicts, non-scope and shared-file ownership/start gates.
- [x] Incorporate bounded review corrections for missing contract presence, all shared parser object-construction entries, canonical schema value constraints and D4's CLI write seat; synchronize contract/error/test/consumer sections.
- [x] Integration coordinator reviews this design and accepts or revises the contract.
- [x] Integration coordinator confirms #347 merged and assigns a separate sole implementation writer/worktree.
- [x] Before CLI/main.ts edits, integration coordinator confirms D4 released its write seat or explicitly hands over the exact shared hunk and records its boundaries.
- [ ] Implementation: shared pure contract/schema and checked blob/region primitives, preserving existing adapters.
- [ ] Implementation: both source adapters, complete model/profile/document assembly and stability checks.
- [ ] Implementation: native CLI/help, final capability trio, packaged schema/CLI smoke and runbook/spec exception.
- [ ] Reviewer verifies section 11 evidence and repo-harness item 6–8 coverage; integration coordinator handles upstream PR/merge/confirmation.

## Implementation authorization

The integration coordinator assigned U4 as the sole writer after S4 #347 and D4 #348 merged and explicitly confirmed release of the CLI main.ts seat. Product edits belong only to the independent U4 implementation worktree. The historical planning-only statements above describe #349; the active implementation contract below governs this work. RPC schema/version metadata, #328 D5–D7, deployment, release, issue closure and merge are excluded. Feature advertisement remains gated on RPC-writer coordination and complete packaged smoke.

- Contract: tasks/contracts/plan-20261014-1325-issue-346-u4-native-context-export.contract.md
- Review: tasks/reviews/plan-20261014-1325-issue-346-u4-native-context-export.review.md
- Notes: tasks/notes/plan-20261014-1325-issue-346-u4-native-context-export.notes.md
