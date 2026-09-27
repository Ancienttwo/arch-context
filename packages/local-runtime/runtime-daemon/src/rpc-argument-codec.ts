/**
 * Small, local decoders for the positional `params: unknown[]` array every `RUNTIME_RPC_METHODS`
 * entry receives on the dispatch side (`ArchctxRuntimeRpcServer.dispatch`, see rpc-server.ts). They
 * replace the blind `params as Args` cast with a strict runtime check per positional slot: every
 * decoder here validates wire-level *shape* — is this slot the JS type the method's own
 * `encodeArgs` signature declares (string / number / string[] / plain object)? They do not reach
 * into the fields of the domain object types (`RuntimeCheckpointInput`,
 * `RuntimeAgentJobClaimRpcInput`, ...) — that stays each handler's job.
 *
 * Invalid input throws `RuntimeRpcInputInvalidError`, a typed subclass of `Error` whose message
 * keeps the `runtime-rpc-input-invalid: <context> <detail>` text the developer-review decoders
 * (`decodeStartDeveloperReviewRunParams` and friends in developer-review-codec.ts, which import and
 * throw the same class) already used. `rpc-server.ts`'s dispatch catch maps this type to
 * `errorEnvelope(method, "AC_SCHEMA_INVALID", error.message)` — HTTP 200 with a structured
 * `{ code, message, severity, retryable, action }` error, the same shape every handler's own
 * validation already answers with. Because that mapping exists at the server, every decoder below
 * can reject a malformed positional slot outright without racing any handler's own error contract:
 * there is no more "uncaught 500" outcome for a decode failure to fall into, so `rpcRequiredObject`
 * rejects absence the same way it rejects a wrong type. (An earlier version of this file carried a
 * `rpcHandlerValidatedObject` passthrough for slots whose handler had its own graceful decoding;
 * that carve-out is gone now that the server maps decode failures to the same structured shape those
 * handlers already produced.)
 *
 * `params` itself is checked before any of these run: every general (`envelopeMethod`) table entry
 * rejects a non-array `params` container up front (see `envelopeMethod` in rpc-methods.ts). Indexing
 * a string or a plain object as if it were an array silently produces plausible-looking-but-wrong
 * values instead of failing (`"/tmp/x"[0]` is the character `"/"`, not the first real argument).
 *
 * Optional variants (`rpcOptionalString`, `rpcOptionalNumber`, `rpcOptionalStringArray`,
 * `rpcOptionalObject`) still pass `undefined`/`null` through unchanged rather than rejecting them:
 * that is not malformed input, it is the wire's "omitted" representation for a parameter whose
 * `encodeArgs` signature has a JS default — `Reflect.apply(handler, daemon, decodedArgs)` still
 * triggers that default whenever the decoded slot is `undefined`, exactly as under the previous
 * `params as Args` cast.
 */

export class RuntimeRpcInputInvalidError extends Error {
  constructor(context: string, detail: string) {
    super(`runtime-rpc-input-invalid: ${context} ${detail}`);
    this.name = "RuntimeRpcInputInvalidError";
  }
}

export function rpcInputInvalid(context: string, detail: string): RuntimeRpcInputInvalidError {
  return new RuntimeRpcInputInvalidError(context, detail);
}

/** Required positional string. Rejects missing/`null`/wrong-type; empty string is a valid string. */
export function rpcRequiredString(params: readonly unknown[], index: number, context: string, label: string): string {
  const value = params[index];
  if (typeof value !== "string") throw rpcInputInvalid(context, `${label} must be a string`);
  return value;
}

/**
 * Optional positional string. `undefined` and `null` both mean "omitted" on the wire (a JSON array
 * turns an `undefined` element into `null`, see `RuntimeRpcClient`'s `JSON.stringify` of `params`),
 * so both pass through unchanged rather than being normalized to one or the other.
 */
export function rpcOptionalString(params: readonly unknown[], index: number, context: string, label: string): string | undefined {
  const value = params[index];
  if (value === undefined || value === null) return value as undefined;
  if (typeof value !== "string") throw rpcInputInvalid(context, `${label} must be a string`);
  return value;
}

export function rpcOptionalNumber(params: readonly unknown[], index: number, context: string, label: string): number | undefined {
  const value = params[index];
  if (value === undefined || value === null) return value as undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw rpcInputInvalid(context, `${label} must be a number`);
  return value;
}

/** Optional positional array of strings (e.g. `sync`'s `changedPaths: string[] = []`). */
export function rpcOptionalStringArray(params: readonly unknown[], index: number, context: string, label: string): string[] | undefined {
  const value = params[index];
  if (value === undefined || value === null) return value as undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw rpcInputInvalid(context, `${label} must be an array of strings`);
  return value as string[];
}

function isPlainRpcObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Required positional object. Rejects missing/`null`/wrong-type outright. `T` is the caller's
 * declared domain input type; it is not verified field-by-field — that stays the handler's job.
 */
export function rpcRequiredObject<T>(params: readonly unknown[], index: number, context: string, label: string): T {
  const value = params[index];
  if (!isPlainRpcObject(value)) throw rpcInputInvalid(context, `${label} must be an object`);
  return value as T;
}

/** Optional positional object; `undefined`/`null` pass through so the handler's own default applies. */
export function rpcOptionalObject<T>(params: readonly unknown[], index: number, context: string, label: string): T | undefined {
  const value = params[index];
  if (value === undefined || value === null) return value as undefined;
  if (!isPlainRpcObject(value)) throw rpcInputInvalid(context, `${label} must be an object`);
  return value as T;
}
