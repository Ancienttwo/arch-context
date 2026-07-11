# AR4 Integrated Product Readback

Verdict: **PASS**. AR0-AR4 now form one accepted, authority-aware architecture-reading
product path. No compatibility reader, cache rewrite, database migration, authority
promotion, remote dependency, or browser-side semantic inference was added.

## P1 · Architecture Map

- `.archcontext/` remains Git-visible architecture truth; SQLite remains rebuildable
  operational state.
- Explorer V2 has one typed compiler boundary, one manifest-addressed disposable cache,
  one token-gated loopback daemon surface, and one self-contained HTML renderer.
- ADR-0044 now records the accepted five-view/Inspector/navigation/freshness boundary.
  ADR-0045 was not changed.
- The existing architecture-context module is registered through the supported
  capability-config path; `capability-resolver validate` reports no errors.

## P2 · Accepted Product Flow

The real local daemon issued a short-lived bearer token, served the self-contained V2
projection on `127.0.0.1`, and was exercised in the visible in-app browser. All five
view controls were present; typed views with no matching authority rendered honest
empty states. Expand/collapse and focus changed only exact URL state. Fit/zoom changed
SVG transform from scale 1 to 1.20 and back to 1 without changing projection URL state.
The view-root breadcrumb returned focused detail to context.

At 375 px, the fixed page reports `scrollWidth=clientWidth=375`; only the topology
container retains intentional internal scrolling (`640/299`). A normal session reached
connected freshness and an expired session visibly reached disconnected. Exact
`authority-changed` debounce and `projection-invalidated` digest qualification remain
covered by inline-runtime tests; the daemon test proves an already-open SSE response
ends at token expiry.

Screenshots are retained outside repository authority at:
`/Users/ancienttwo/.gstack/projects/arch-context/designs/explorer-ar4-20260712/`.

## P3 · Decision and Reviews

Three browser-discovered P1 ship blockers were fixed: page-level narrow overflow, a
no-op focused breadcrumb, and established SSE clients surviving token expiry. The
expiry timer is session-owned, aligned to the absolute expiry after listen completes,
and cleared on revoke/close. The browser never infers subject identity or semantics.

Architecture review: **PASS**. The diff preserves one projection authority, typed
selection, bounded reads, disposable geometry/cache, and the Git/SQLite authority
split. At 10x scale, public query budgets remain the intentional first stop.

Security review: **PASS**. Loopback bind, bearer authentication, expiry/revocation,
GET-only/read-only/no-store, self-contained CSP, output escaping, zero external assets,
zero route egress, and forbidden-body exclusion all remain enforced. Established SSE
clients are now closed at expiry, not only rejected on their next request.

## Verification

- Focused product matrix: **404 pass / 0 fail**; `tsc --noEmit` PASS.
- Full `bun run verify`: **1083 pass / 0 fail**; eval verdict PASS.
- `verify:explorer`: PASS. Compiler 10k p95 **1.90 ms**, 100k p95 **0.58 ms**.
- Renderer default 80/160 p95 **0.92 ms**, **155,677 bytes**.
- Renderer public maximum 1000/5000 p95 **15.44 ms**, **3,295,057 bytes**.
- Determinism, reversed-input parity, privacy, no external assets, and V1-reference
  inventory: PASS / zero findings.
- Packaged CLI smoke, privacy route audit, and capability registry validation: PASS.
- Seven-pass design review: **9.0 → 9.8**, three findings fixed, zero unresolved
  decisions.

User-owned `.ai/harness/delegation/subagent-stop-quality.json` remained byte-identical:
SHA-256 `10fc961f78b6a26a16b9fa9d1fea368d4b4493e7d825add46495df0b760e14ea`.
