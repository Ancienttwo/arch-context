# Explorer AR1 Navigation and Live Freshness Readback

> **Status**: PASS
> **Captured**: 2026-07-12

AR1 keeps all semantic state in the existing URL/query contract and all visual state
inside one transient SVG viewport transform. It changes no projection, compiler,
database, ledger, package, or SSE producer contract.

Verified behavior:

- Exact `expand` toggle removes only the selected value, preserves duplicate unrelated
  values, and never duplicates a newly selected group.
- Focus sets `focus` plus `level=detail`; overview breadcrumb removes only `focus` and
  sets `level=overview`. Token, budgets, depth, task session, view, and unrelated
  repeated parameters survive.
- Fit, zoom, wheel, pan, and keyboard controls update only the SVG viewport transform;
  editable controls ignore topology shortcuts and no navigation/network action occurs.
- `authority-changed` schedules an unconditional shared debounce; two events produce
  one reload.
- `projection-invalidated` reloads only for the current view-definition digest and a
  nonempty projection digest different from the rendered one.
- Malformed payload, EventSource error, missing token, and expired token fail closed,
  close the stream, and expose `live updates disconnected`; no retry or ambient cookie
  authentication path exists.
- The daemon emits the exact self-contained CSP including `frame-ancestors 'none'`.
- Static SVG, relation table, and Inspector remain in the HTML without JavaScript.

Focused result: 115 pass / 0 fail; TypeScript typecheck PASS and `verify:explorer`
PASS. Contract verification and strict Sprint verification also pass.

No compatibility runtime, dual navigation path, fallback auth, external asset,
dependency, or semantic inference was added.
