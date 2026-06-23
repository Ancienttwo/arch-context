import {
  EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION,
  digestJson,
  type ExternalDocumentationFetchInput,
  type ExternalDocumentationFetchResult,
  type ExternalDocumentationLibraryCandidate,
  type ExternalDocumentationPort,
  type ExternalDocumentationProviderHealth,
  type ExternalDocumentationResolveInput,
  type ExternalDocumentationResolveResult,
  type ExternalDocumentationResourceSnippetV1,
  type ExternalDocumentationResourceV1,
  type Json
} from "@archcontext/contracts";

export interface Context7AdapterOptions {
  transport?: Context7Transport;
  apiKey?: string;
  enabled?: boolean;
  mode?: "manual" | "prepare-unknowns";
  timeoutMs?: number;
  maxBytes?: number;
  clock?: () => string;
  monotonicNowMs?: () => number;
  telemetry?: Context7ProviderTelemetryRecorder;
  retryBudget?: number;
  rateLimit?: Partial<Context7RateLimitOptions> | false;
  circuitBreaker?: Partial<Context7CircuitBreakerOptions> | false;
}

export interface Context7Transport {
  search(input: Context7SearchRequest): Promise<Context7SearchResponse>;
  getContext(input: Context7ContextRequest): Promise<Context7Documentation[]>;
}

export interface Context7SearchRequest {
  libraryName: string;
  query: string;
  fast: boolean;
  timeoutMs: number;
  apiKey?: string;
}

export interface Context7SearchResponse {
  results: Context7Library[];
  searchFilterApplied: boolean;
}

export interface Context7Library {
  id: string;
  title: string;
  description?: string;
  versions?: string[];
  trustScore?: number;
  benchmarkScore?: number;
}

export interface Context7ContextRequest {
  libraryId: string;
  query: string;
  maxResults: number;
  timeoutMs: number;
  apiKey?: string;
}

export interface Context7Documentation {
  title: string;
  content: string;
  source: string;
}

export type Context7ProviderOperation = "resolve" | "fetch";
export type Context7ProviderTelemetryStatus =
  | "success"
  | "http-error"
  | "timeout"
  | "rate-limited"
  | "malformed"
  | "transport-error"
  | "circuit-open";
export type Context7ProviderFailureStatus = Exclude<Context7ProviderTelemetryStatus, "success">;

export interface Context7ProviderTelemetryEvent {
  provider: "context7";
  operation: Context7ProviderOperation;
  queryDigest: string;
  status: Context7ProviderTelemetryStatus;
  latencyMs: number;
  byteCount: number;
  libraryId?: string;
  version?: string;
}

export interface Context7ProviderTelemetryRecorder {
  record(event: Context7ProviderTelemetryEvent): void | Promise<void>;
}

export interface Context7RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

export interface Context7CircuitBreakerOptions {
  failureThreshold: number;
  resetAfterMs: number;
}

export class Context7ProviderError extends Error {
  readonly kind: Context7ProviderFailureStatus;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly byteCount: number;

  constructor(
    kind: Context7ProviderFailureStatus,
    message: string,
    options: { statusCode?: number; retryable?: boolean; byteCount?: number; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "Context7ProviderError";
    this.kind = kind;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.byteCount = options.byteCount ?? 0;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

const DEFAULT_CONTEXT7_API_BASE = "https://context7.com/api";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 24_576;
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_RETRY_BUDGET = 1;
const DEFAULT_RATE_LIMIT: Context7RateLimitOptions = { maxRequests: 60, windowMs: 60_000 };
const DEFAULT_CIRCUIT_BREAKER: Context7CircuitBreakerOptions = { failureThreshold: 3, resetAfterMs: 60_000 };
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const LIBRARY_ID_PATTERN = /^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/@-]+$/;
const VERSION_PATTERN = /^[A-Za-z0-9._@:+-]+$/;
const INTENT_PATTERN = /^[a-z0-9][a-z0-9 .:_/-]{2,120}$/i;
const FORBIDDEN_OUTBOUND_PATTERNS = [
  /\/Users\/[^/\s]+\/Projects\//,
  /file:\/\//i,
  /```/,
  /\bdiff --git\b/i,
  /\b(?:symbol|symbols|caller|callers|callee|callees)\s*[:=]\s*[A-Za-z0-9_.$/-]+(?:\s*,\s*[A-Za-z0-9_.$/-]+)+/i,
  /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\b/,
  /Bearer\s+(?!\[REDACTED\])/i,
  /(access|refresh|secret|token)_[A-Za-z0-9_-]+/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/
];

export class Context7ExternalDocumentationAdapter implements ExternalDocumentationPort {
  readonly provider = "context7" as const;
  private readonly transport: Context7Transport;
  private readonly apiKey?: string;
  private readonly enabled: boolean;
  private readonly mode: "manual" | "prepare-unknowns";
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly clock: () => string;
  private readonly monotonicNowMs: () => number;
  private readonly telemetry?: Context7ProviderTelemetryRecorder;
  private readonly retryBudget: number;
  private readonly rateLimit?: Context7RateLimitOptions;
  private readonly circuitBreaker?: Context7CircuitBreakerOptions;
  private requestTimestamps: number[] = [];
  private consecutiveFailures = 0;
  private circuitOpenedAtMs: number | undefined;

  constructor(options: Context7AdapterOptions = {}) {
    this.transport = options.transport ?? new HttpContext7Transport();
    this.apiKey = options.apiKey ?? process.env.CONTEXT7_API_KEY;
    this.enabled = options.enabled ?? false;
    this.mode = options.mode ?? "manual";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.clock = options.clock ?? (() => new Date(0).toISOString());
    this.monotonicNowMs = options.monotonicNowMs ?? (() => Date.now());
    this.telemetry = options.telemetry;
    this.retryBudget = clampInteger(options.retryBudget ?? DEFAULT_RETRY_BUDGET, 0, 3);
    this.rateLimit = options.rateLimit === false ? undefined : {
      maxRequests: clampInteger(options.rateLimit?.maxRequests ?? DEFAULT_RATE_LIMIT.maxRequests, 1, 10_000),
      windowMs: clampInteger(options.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT.windowMs, 1, 24 * 60 * 60 * 1000)
    };
    this.circuitBreaker = options.circuitBreaker === false ? undefined : {
      failureThreshold: clampInteger(options.circuitBreaker?.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER.failureThreshold, 1, 1_000),
      resetAfterMs: clampInteger(options.circuitBreaker?.resetAfterMs ?? DEFAULT_CIRCUIT_BREAKER.resetAfterMs, 1, 24 * 60 * 60 * 1000)
    };
  }

  health(): ExternalDocumentationProviderHealth {
    return {
      provider: "context7",
      enabled: this.enabled,
      mode: this.mode,
      egress: this.enabled && this.mode === "prepare-unknowns" ? "prepare-unknowns" : this.enabled ? "manual-only" : "none",
      cache: "sqlite",
      keySource: this.apiKey ? "env" : "none"
    };
  }

  async resolve(input: ExternalDocumentationResolveInput): Promise<ExternalDocumentationResolveResult> {
    if (!this.enabled) throw new Error("Context7 external docs provider is disabled");
    if (input.provider !== "context7") throw new Error("Context7 adapter only supports provider=context7");
    assertSafeOutboundText(input.libraryName, "libraryName");
    assertSafeOutboundText(input.query, "query");
    const queryDigest = digestJson({ provider: "context7", libraryName: input.libraryName, query: input.query });
    const response = await this.executeProviderRequest({
      operation: "resolve",
      queryDigest,
      call: () => this.transport.search({
        libraryName: input.libraryName,
        query: input.query,
        fast: input.fast ?? true,
        timeoutMs: this.timeoutMs,
        ...(this.apiKey ? { apiKey: this.apiKey } : {})
      }),
      byteCountOf: (result) => byteCountJson({
        searchFilterApplied: result.searchFilterApplied,
        candidates: result.results.map(projectLibraryCandidate)
      })
    });
    return {
      schemaVersion: "archcontext.external-docs-resolve/v1",
      provider: "context7",
      queryDigest,
      candidates: response.results.map(projectLibraryCandidate),
      searchFilterApplied: response.searchFilterApplied,
      egress: "manual-only"
    };
  }

  async fetch(input: ExternalDocumentationFetchInput): Promise<ExternalDocumentationFetchResult> {
    if (!this.enabled) throw new Error("Context7 external docs provider is disabled");
    if (input.provider !== "context7") throw new Error("Context7 adapter only supports provider=context7");
    assertContext7LibraryId(input.libraryId);
    assertContext7Version(input.version);
    const query = buildContext7Query(input);
    assertSafeOutboundText(query, "query");
    const queryDigest = digestJson({ provider: "context7", libraryId: input.libraryId, version: input.version, query });
    const docs = await this.executeProviderRequest({
      operation: "fetch",
      queryDigest,
      libraryId: input.libraryId,
      version: input.version,
      call: () => this.transport.getContext({
        libraryId: `${input.libraryId}/${input.version}`,
        query,
        maxResults: input.maxResults ?? 4,
        timeoutMs: this.timeoutMs,
        ...(this.apiKey ? { apiKey: this.apiKey } : {})
      }),
      byteCountOf: (result) => result.reduce((total, doc) => total + Buffer.byteLength(cleanExternalText(doc.content), "utf8"), 0)
    });
    const resource = buildExternalDocumentationResource({
      libraryId: input.libraryId,
      version: input.version,
      query,
      docs,
      now: this.clock(),
      ttlSeconds: input.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      maxBytes: this.maxBytes
    });
    return {
      schemaVersion: "archcontext.external-docs-fetch/v1",
      provider: "context7",
      cacheStatus: "miss",
      resource,
      request: {
        libraryId: input.libraryId,
        version: input.version,
        queryDigest: resource.queryDigest,
        intent: input.intent
      }
    };
  }

  private async executeProviderRequest<T>(input: {
    operation: Context7ProviderOperation;
    queryDigest: string;
    libraryId?: string;
    version?: string;
    call: () => Promise<T>;
    byteCountOf: (result: T) => number;
  }): Promise<T> {
    const startedAtMs = this.monotonicNowMs();
    const circuitError = this.checkCircuitOpen(startedAtMs);
    if (circuitError) {
      await this.recordTelemetry(input, circuitError.kind, startedAtMs, circuitError.byteCount);
      throw circuitError;
    }

    const rateLimitError = this.consumeRateLimit(startedAtMs);
    if (rateLimitError) {
      await this.recordTelemetry(input, rateLimitError.kind, startedAtMs, rateLimitError.byteCount);
      throw rateLimitError;
    }

    let attempt = 0;
    while (attempt <= this.retryBudget) {
      try {
        const result = await input.call();
        this.noteProviderSuccess();
        await this.recordTelemetry(input, "success", startedAtMs, input.byteCountOf(result));
        return result;
      } catch (error) {
        const classified = classifyContext7Error(error);
        if (attempt >= this.retryBudget || !classified.retryable) {
          this.noteProviderFailure(startedAtMs);
          await this.recordTelemetry(input, classified.kind, startedAtMs, classified.byteCount);
          throw classified;
        }
        attempt++;
      }
    }

    const error = new Context7ProviderError("transport-error", "Context7 provider retry budget exhausted", { retryable: false });
    this.noteProviderFailure(startedAtMs);
    await this.recordTelemetry(input, error.kind, startedAtMs, error.byteCount);
    throw error;
  }

  private consumeRateLimit(nowMs: number): Context7ProviderError | undefined {
    if (!this.rateLimit) return undefined;
    const windowStart = nowMs - this.rateLimit.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > windowStart);
    if (this.requestTimestamps.length >= this.rateLimit.maxRequests) {
      return new Context7ProviderError("rate-limited", "Context7 provider local rate limit exceeded", { retryable: false });
    }
    this.requestTimestamps.push(nowMs);
    return undefined;
  }

  private checkCircuitOpen(nowMs: number): Context7ProviderError | undefined {
    if (!this.circuitBreaker || this.circuitOpenedAtMs === undefined) return undefined;
    if (nowMs - this.circuitOpenedAtMs >= this.circuitBreaker.resetAfterMs) return undefined;
    return new Context7ProviderError("circuit-open", "Context7 provider circuit breaker is open", { retryable: false });
  }

  private noteProviderSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenedAtMs = undefined;
  }

  private noteProviderFailure(nowMs: number): void {
    if (!this.circuitBreaker) return;
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.circuitBreaker.failureThreshold) {
      this.circuitOpenedAtMs = nowMs;
    }
  }

  private async recordTelemetry(
    input: Pick<Context7ProviderTelemetryEvent, "operation" | "queryDigest" | "libraryId" | "version">,
    status: Context7ProviderTelemetryStatus,
    startedAtMs: number,
    byteCount: number
  ): Promise<void> {
    if (!this.telemetry) return;
    const event: Context7ProviderTelemetryEvent = {
      provider: "context7",
      operation: input.operation,
      queryDigest: input.queryDigest,
      status,
      latencyMs: Math.max(0, Math.round(this.monotonicNowMs() - startedAtMs)),
      byteCount: Math.max(0, Math.round(byteCount)),
      ...(input.libraryId ? { libraryId: input.libraryId } : {}),
      ...(input.version ? { version: input.version } : {})
    };
    try {
      await this.telemetry.record(event);
    } catch {
      // Telemetry is advisory and must not change external-doc behavior.
    }
  }
}

export class HttpContext7Transport implements Context7Transport {
  constructor(private readonly baseUrl = DEFAULT_CONTEXT7_API_BASE) {}

  async search(input: Context7SearchRequest): Promise<Context7SearchResponse> {
    const url = new URL(`${this.baseUrl}/v2/libs/search`);
    url.searchParams.set("libraryName", input.libraryName);
    url.searchParams.set("query", input.query);
    url.searchParams.set("fast", input.fast ? "true" : "false");
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: authHeaders(input.apiKey)
    }, input.timeoutMs);
    if (!response.ok) throw httpStatusError("Context7 search failed", response);
    const { payload } = await parseJsonResponse(response, "Context7 search");
    return parseSearchResponse(payload);
  }

  async getContext(input: Context7ContextRequest): Promise<Context7Documentation[]> {
    const response = await fetchWithTimeout(`${this.baseUrl}/v1/context/get-documentation-context`, {
      method: "POST",
      headers: {
        ...authHeaders(input.apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        libraryId: input.libraryId,
        query: input.query,
        maxResults: input.maxResults
      })
    }, input.timeoutMs);
    if (!response.ok) throw httpStatusError("Context7 context fetch failed", response);
    const { payload } = await parseJsonResponse(response, "Context7 context fetch");
    return parseDocumentationResponse(payload);
  }
}

export function buildContext7Query(input: Pick<ExternalDocumentationFetchInput, "intent" | "query">): string {
  const intent = input.intent.trim();
  if (!INTENT_PATTERN.test(intent)) throw new Error("Context7 intent must be a bounded natural-language identifier");
  const query = input.query?.trim() || `Document ${intent} for this exact version. Return documentation data only.`;
  assertSafeOutboundText(query, "query");
  return query;
}

export function assertSafeOutboundText(value: string, label: string): void {
  if (!value || value.length > 500) throw new Error(`${label} must be 1..500 characters`);
  for (const pattern of FORBIDDEN_OUTBOUND_PATTERNS) {
    if (pattern.test(value)) throw new Error(`${label} contains forbidden outbound content: ${pattern}`);
  }
}

export function assertContext7LibraryId(libraryId: string): void {
  if (!LIBRARY_ID_PATTERN.test(libraryId)) throw new Error("Context7 libraryId must be /owner/project and repo-pinned");
}

export function assertContext7Version(version: string): void {
  if (!VERSION_PATTERN.test(version)) throw new Error("Context7 version must be an exact pinned version");
}

export function buildExternalDocumentationResource(input: {
  libraryId: string;
  version: string;
  query: string;
  docs: Context7Documentation[];
  now: string;
  ttlSeconds: number;
  maxBytes: number;
}): ExternalDocumentationResourceV1 {
  const snippets = input.docs.map(projectSnippet).filter(Boolean) as ExternalDocumentationResourceSnippetV1[];
  const body = snippets.map((snippet) => `${snippet.title}\n${snippet.sourceUri}\n${snippet.contentPreview}`).join("\n");
  const truncated = body.slice(0, input.maxBytes);
  const contentDigest = digestJson({
    provider: "context7",
    libraryId: input.libraryId,
    version: input.version,
    snippets: snippets as unknown as Json[]
  });
  const expiresAt = new Date(Date.parse(input.now) + input.ttlSeconds * 1000).toISOString();
  return {
    schemaVersion: EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION,
    provider: "context7",
    libraryId: input.libraryId,
    requestedVersion: input.version,
    resolvedVersion: input.version,
    queryDigest: digestJson({ provider: "context7", libraryId: input.libraryId, version: input.version, query: input.query }),
    contentDigest,
    retrievedAt: input.now,
    expiresAt,
    trust: "external-unverified",
    enforcement: "advisory-only",
    cacheStatus: "miss",
    uri: `archcontext://external-docs/context7/${contentDigest}`,
    byteCount: Buffer.byteLength(truncated, "utf8"),
    snippets,
    warning: "untrusted-documentation-data"
  };
}

function projectSnippet(doc: Context7Documentation): ExternalDocumentationResourceSnippetV1 | undefined {
  const title = cleanExternalText(doc.title).slice(0, 160);
  const content = cleanExternalText(doc.content);
  const sourceUri = normalizeSourceUri(doc.source);
  if (!title || !sourceUri) return undefined;
  return {
    title,
    contentPreview: content.slice(0, 4_000),
    contentDigest: digestJson({ title, content, sourceUri }),
    sourceUri,
    byteCount: Buffer.byteLength(content, "utf8")
  };
}

function projectLibraryCandidate(result: Context7Library): ExternalDocumentationLibraryCandidate {
  return {
    id: result.id,
    title: result.title,
    ...(result.description ? { description: cleanExternalText(result.description).slice(0, 240) } : {}),
    versions: [...new Set(result.versions ?? [])].filter((version) => VERSION_PATTERN.test(version)).sort(),
    ...(typeof result.trustScore === "number" ? { trustScore: result.trustScore } : {}),
    ...(typeof result.benchmarkScore === "number" ? { benchmarkScore: result.benchmarkScore } : {})
  };
}

function cleanExternalText(value: string): string {
  return String(value ?? "").replace(CONTROL_CHARS, "").trim();
}

function normalizeSourceUri(value: string): string | undefined {
  const clean = cleanExternalText(value);
  if (!/^https:\/\//i.test(clean)) return undefined;
  try {
    return new URL(clean).toString();
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Context7ProviderError("timeout", "Context7 provider request timed out", { retryable: true, cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function classifyContext7Error(error: unknown): Context7ProviderError {
  if (error instanceof Context7ProviderError) return error;
  if (isAbortError(error)) {
    return new Context7ProviderError("timeout", "Context7 provider request timed out", { retryable: true, cause: error });
  }
  return new Context7ProviderError("transport-error", "Context7 provider transport failed", { retryable: true, cause: error });
}

function httpStatusError(label: string, response: Response): Context7ProviderError {
  const statusCode = response.status;
  const kind: Context7ProviderFailureStatus = statusCode === 429 ? "rate-limited" : "http-error";
  return new Context7ProviderError(kind, `${label}: ${statusCode}`, {
    statusCode,
    retryable: statusCode === 429 || statusCode >= 500,
    byteCount: contentLengthByteCount(response)
  });
}

async function parseJsonResponse(response: Response, label: string): Promise<{ payload: unknown; byteCount: number }> {
  const body = await response.text();
  const byteCount = Buffer.byteLength(body, "utf8");
  try {
    return { payload: JSON.parse(body) as unknown, byteCount };
  } catch (error) {
    throw new Context7ProviderError("malformed", `${label} returned malformed JSON`, { retryable: false, byteCount, cause: error });
  }
}

function parseSearchResponse(payload: unknown): Context7SearchResponse {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new Context7ProviderError("malformed", "Context7 search returned malformed response", { retryable: false, byteCount: byteCountJson(payload) });
  }
  const results = ((payload as { results: unknown[] }).results).filter(isContext7Library);
  return {
    results,
    searchFilterApplied: Boolean((payload as { searchFilterApplied?: unknown }).searchFilterApplied)
  };
}

function parseDocumentationResponse(payload: unknown): Context7Documentation[] {
  const docs = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results
      : payload && typeof payload === "object" && Array.isArray((payload as { docs?: unknown }).docs)
        ? (payload as { docs: unknown[] }).docs
        : undefined;
  if (!docs) {
    throw new Context7ProviderError("malformed", "Context7 context fetch returned malformed response", { retryable: false, byteCount: byteCountJson(payload) });
  }
  if (!docs.every(isContext7Documentation)) {
    throw new Context7ProviderError("malformed", "Context7 context fetch returned malformed documentation entries", { retryable: false, byteCount: byteCountJson(payload) });
  }
  return docs;
}

function isContext7Library(value: unknown): value is Context7Library {
  return !!value
    && typeof value === "object"
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { title?: unknown }).title === "string";
}

function isContext7Documentation(value: unknown): value is Context7Documentation {
  return !!value
    && typeof value === "object"
    && typeof (value as { title?: unknown }).title === "string"
    && typeof (value as { content?: unknown }).content === "string"
    && typeof (value as { source?: unknown }).source === "string";
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

function byteCountJson(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function contentLengthByteCount(response: Response): number {
  const raw = response.headers.get("content-length");
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
