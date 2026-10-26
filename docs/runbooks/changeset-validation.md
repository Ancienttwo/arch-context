# ChangeSet base validation

Plan and apply use the same repair-aware base validation rule. A plan whose base
has blocking errors fails before the draft is saved, with `plan-model-invalid`.
Apply and ledger projection refuse an invalid base with `apply-model-invalid`.
Both failures are non-retryable and direct the caller to `repair-model`.

The error details contain `issueCount`, at most eight `diagnostics` entries
(`path`, `code`), and `omittedIssueCount`. Locations and codes come from the
validation authority; error text is never parsed to guess them. Missing files,
missing schema versions and node-schema errors currently have structured
locations. Other errors and paths above the diagnostic byte budget count as
omitted. Run `archctx validate --json` for the full local validation report.

Raw validator messages, source bodies, absolute paths and process output are not
copied into the refusal. Existing dangling-reference, node-schema and manifest
layer-order repair exemptions still apply to the base; post-apply validation
remains strict. Rebuilding an unchanged plan cannot repair a blocking base.
