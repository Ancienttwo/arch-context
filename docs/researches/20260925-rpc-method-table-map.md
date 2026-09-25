# Typed RPC method table — issue #164

Baseline: `93e65f76cd020a21e8fbb2beec9b3caa661d0a17`, merged in PR #206 as `176e0a491b847fa2bddbde1fb451f24d36632711`.

## P1 — ownership

The old transport repeated 59 domain methods across the public interface, client wrappers, server switch, and timeout sets. `rpc-methods.ts` now owns their typed argument tuples, client defaults, timeout classes, argument decoding and response encoding/decoding. `RuntimeDaemonClient` and the client prototype derive from that table. `ArchctxDaemon implements RuntimeDaemonClient` checks the handler side; adding a method requires a table entry and the daemon handler.

Health and shutdown remain transport lifecycle operations. Feature implementations, ChangeSet authority, and the production composition root remain in the daemon. The method table imports feature DTOs as erased types, avoiding a runtime dependency on the facade. The RPC client/contract architecture component owns the shared method table and review codecs; the server consumes that contract.

## P2 — trace and preserved behavior

A client method applies its table-owned defaults before serializing the existing positional wire array. The server retains authentication, protocol-version checks, bounded body reads and the recovery gate. It checks the method name against the table's own keys, decodes arguments, invokes the daemon handler with its original receiver, awaits the result and encodes the response. Unknown and prototype property names cannot dispatch.

Ordinary handlers still validate their domain inputs and return their envelopes. The four developer-review operations retain strict boundary decoders, including rejection of caller-selected filesystem overrides. Their raw domain results use the same named envelopes and client-side error unwrapping as before. The reflection boundary erases individual tuples only after the registered method lookup; it does not claim schema validation for ordinary arguments.

Client defaults are observable wire behavior: omitted optional arguments become JSON null where previously serialized, numeric budgets retain their defaults, and ledger mutations retain `dryRun: true`. The unchanged transport still owns timeout enforcement, cancellation and connection handling.

## P3 — constraints and verification

This cutover removes the duplicate method inventories. It changes no persisted format, protocol version, mutation authority or domain validation policy. The table derives public argument types from typed callbacks; `NoInfer` prevents returned tuples from turning defaulted optional parameters into required parameters. Runtime reflection is confined to method installation and dispatch. At 10x traffic, daemon work and existing request limits remain the constraints; this change makes no throughput claim.

`rpc-wire-baseline.json` was captured by exercising the actual pre-table client at the baseline commit, not generated from the new table. Its 83 omitted/explicit argument cases cover all 59 methods. The real client/server transport tests compare daemon arguments, receiver binding, response shapes and timeout classes against that fixed oracle. They also reject unregistered/prototype method names and preserve raw-result failure unwrapping. Compile-only guards check optional numeric argument tuples and precise client return types.

Existing daemon integration cases exercise review start/sign/cleanup/recovery, refusal of caller-selected roots and malformed manifests, and refusal of untrusted worktree digest profiles before plan/apply. The self-model ownership changes use daemon ChangeSet and validate without errors.

Verification completed: `bun run verify` passed with 2007 tests and zero failures, including typecheck, package boundaries and all configured gates. A live import comparison confirmed the facade retains the same 34 runtime exports.

Feature-service extraction, a client-only MCP package entrypoint and cross-package helper ownership remain outstanding parts of #164. This PR does not close that issue.
