# Practice Catalog Assets

Built-in assets use `.yaml` files containing the JSON-compatible YAML subset.
The loader intentionally keeps parsing strict in the first release so catalog
digests stay stable across operating systems and formatter changes.

Authoring rules:

- Every practice is original ArchContext guidance, not copied source text.
- Every source reference must exist under `sources/`.
- Candidate terms are recall hints only; enforcement requires deterministic
  checks and repository opt-in.
- Built-in assets default to advisory.
- Repo overlays live under `.archcontext/practices/` and must use
  `overlay.mode` for `replace` or `disable`.
