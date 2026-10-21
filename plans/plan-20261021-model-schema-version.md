# Plan: parse model schema versions from supported YAML

> **Status**: Executing
> **Base**: 8951c56b3aa7831e03347d267feec93bd3079397

## Authorization
User requested another bounded review, verified issues, fixes and separate PRs.

## Trace and decision
YAML flow parsing was added in #375, but listModelFiles still extracts schemaVersion by regex. A one-line unquoted flow mapping captures every following field and validateModel rejects it. Use the shared parser for structured model YAML metadata; retain the existing extraction route for Markdown/frontmatter and other files. Preserve invalid-model diagnostics.

## Task Breakdown
- [x] Reproduce valid flow mapping rejection through YamlModelStore.
- [x] Create a verified nonduplicate issue.
- [x] Parse model YAML metadata and retain invalid-version rejection tests.
- [x] Run validator tests, typecheck and independent review.
- [ ] Record expanded model-store test outcome.
- [ ] Commit, push and submit a separate linked PR.

## Evidence
- Issue: https://github.com/Ancienttwo/arch-context/issues/385
- Red: three public validateModel cases failed on baseline, each treating the flow-mapping tail as part of schemaVersion.
- Green: validate-model suite 28 passed, 0 failed, 89 assertions, including actual v9 rejection paired with every valid case.
- Typecheck and diff checks passed. Independent read-only review found no actionable flaws.
- Expanded model-store tests continue with the repository standard --timeout 60000; an earlier default-budget attempt was stopped after existing native Git fixtures exceeded its implicit 5-second limit.
- Only structured model YAML metadata changes. Markdown/frontmatter and generated-file metadata retain their previous handling; malformed model bodies remain available for path-specific validation diagnostics.
