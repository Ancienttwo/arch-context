# Local egress admission and kernel-denied first experience

## P1: boundary map

Existing production local outbound adapters are Context7 HTTP (`context7-adapter`),
CLI `npm view`, audit investigation subprocess and the audit GitHub executor.
CodeGraph's explicit telemetry option is separately gated before execution.
The shared authority is the existing local-runtime package's `egress-admission`
export; core and cloud acquire no runtime dependency. RPC/Explorer loopback remains
local. Injected cloud ports are not a new production transport in this slice.

## P2: concrete trace and defect

Manual `docs fetch --allow-network` -> daemon documentation service -> enabled
Context7 adapter -> HTTP transport -> fetch could make a request without a common
deny policy. The pre-fix regression actually reached a loopback HTTP server while
`ARCHCONTEXT_EGRESS_MODE=local-only`; it failed with exit 1. The same test now rejects
before any socket/request. Audit run/approve admission occurs before queued jobs or
publishing state changes, with an additional check at real spawn/exec. CLI update
checks have a distinct process environment and admission before `npm view`.

The old first-experience test merely removed provider environment variables; its
process tree still had network access. The new kernel-isolated execution requires
IPv4/IPv6 direct and descendant OS denials and a positive loopback control. An
unisolated probe fails rather than producing a success artifact. FG6 v2 rejects old,
missing, simulated, duplicate-family and incomplete isolation proof.

## P3: decision and tradeoff

`configured` preserves existing opt-ins and user consent. `local-only` is an
additional deny authority; it cannot grant consent. Invalid modes reject. The same
decision drives application admission and reporting, including npm and telemetry.
Context7 redirects are refused. No global fetch monkeypatch, proxy-only claim,
compatibility evidence conversion, new queue or separate workspace is introduced.
At 10x volume provider/process latency remains dominant; admission is constant-time.
Runtime application checks do not claim OS confinement of arbitrary injected code.
Kernel isolation is an explicit verification boundary for the whole E2E tree.

## Verification authority

Pre-fix, focused tests and local logs are retained in the ignored
`_ops/remaining-issues/egress/` directory. Committed local execution proof is
`docs/verification/fg6-local-no-cloud-readback.json`; hosted results are recorded only
after their actual run finishes. Operator commands and ownership of the network
sandbox helper are in `docs/runbooks/local-egress-policy.md`.

Linux namespace semantics: [network_namespaces(7)](https://man7.org/linux/man-pages/man7/network_namespaces.7.html)
and [unshare(1)](https://www.man7.org/linux/man-pages/man1/unshare.1.html).
macOS acceptance is based on measured Seatbelt denial and completed workflow,
not on assuming that a sandbox command launched successfully.

This implements the bounded #171 item locally; broader verification stopped at two projection/RPC failures. Current status and source hashes: `docs/verification/20260925-egress-local-checkpoint.json`. Hosted acceptance and publication are pending. Historical DE1/DE3/S6 evidence,
#164 facade work and whole-plan acceptance are separate remaining items. No cloud
provider delivery, merge, release or umbrella issue closure is implied.
