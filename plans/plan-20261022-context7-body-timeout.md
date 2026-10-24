# Context7 response body deadline
Status: Review

## Scope
Issue #397 on main b4d62fa7b0c3eca4d45dd00c0fd300ae1e79edaa. Authorized bounded repair. Keep the existing timeout active through body consumption for both HTTP operations.

## Task Breakdown
- [x] Reproduce body-read deadline gap and check duplicate ownership.
- [x] Repair both operations and run affected unit checks/typecheck.
- [x] Independent read-only review: no actionable findings.
- [ ] Submit linked Draft PR without full CI, as explicitly requested.

## Evidence and limitations
Two in-memory regressions fail on baseline and pass with the fix. Final affected adapter file: 14 passed, 60 assertions. Typecheck and diff check passed after fixing the new test signal narrowing and linking existing workspace dependencies. Same-shape RPC client already keeps its timer through response.json(). No production service or external provider was used.

The broader adapter directory run had 14 pass and 2 failures in unchanged egress-admission tests at Bun.serve (EADDRINUSE for port 0). Listening operations were stopped under the access-restriction instruction; no baseline rerun of the denied operation or permission escalation was attempted. This leaves those two integration cases unverified, not passed. Historical logs retained. Full CI is reserved for releases by user instruction; the commit deliberately carries [skip ci] and the PR remains Draft.
