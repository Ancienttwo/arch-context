# Local outbound admission

`ARCHCONTEXT_EGRESS_MODE=local-only` denies the local product's Context7 requests,
audit investigator launch, GitHub issue operations and npm update lookup. Set it
on each CLI/daemon process that must enforce the policy. An already-running daemon
retains its own environment; changing a CLI environment does not change that daemon.
`doctor` reports daemon policy separately from the CLI update operation.

The default `configured` mode retains each feature's existing opt-in, audit user
consent, publishing confirmation and credential requirements. It grants none of
those permissions. Any other policy value is rejected. Local RPC/Explorer traffic,
cached documentation and explicitly supplied `ARCHCONTEXT_LATEST_VERSION` remain
local operations. `DO_NOT_TRACK` defaults to `1`; an explicit different value is
rejected before CodeGraph execution under `local-only` rather than silently changed.
Manual `docs --allow-network` and enabled audit configuration cannot override denial.
Optional prepare documentation keeps its existing cache/advisory behavior without
calling the provider when denied.

The authority is `packages/local-runtime/runtime-daemon/src/egress-admission.ts`.
Real HTTP/process boundaries and service admission use the same decision; CLI/RPC
errors use `AC_POLICY_VIOLATION`. Runtime reports label this as
`enforcement: application-admission`. This is not an OS sandbox for arbitrary
host-injected ports or third-party executables.

## Kernel-isolated first experience

Run `node scripts/local-no-cloud-e2e.mjs` from the installed development repository.
Its owned helper `scripts/local-network-sandbox.mjs` re-executes the complete test
process tree under macOS Seatbelt or a Linux network namespace with only loopback.
Linux requires `sudo -n`, `unshare`, `ip` and `setpriv`; it creates a new namespace,
enables its loopback and drops back to the original user. It does not change host
interfaces or firewall rules. Other hosts and failed isolation launch are refused.

The proof requires direct and child-process IPv4/IPv6 sockets to receive OS denial,
plus a successful loopback connection. Timeouts, remote refusals and environment-only
runs cannot count as proof. The full doctor/init/sync/MCP/task/review workflow must
then pass in the isolated process tree. `Verify` runs this additional proof once on
Ubuntu / Node 22 and uploads `local-no-cloud-network-linux-node-22`; Windows retains
its existing full product verification but has no network-isolation claim.

`bun scripts/fg6-local-no-cloud-readback.ts run --json` records the actual local
execution in `docs/verification/fg6-local-no-cloud-readback.json`.
`bun scripts/fg6-local-no-cloud-readback.ts inspect --json` accepts v2 kernel proof
only. Earlier v1 environment-only evidence must be regenerated, never translated.
