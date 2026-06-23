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

const DEFAULT_CONTEXT7_API_BASE = "https://context7.com/api";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 24_576;
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
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

  constructor(options: Context7AdapterOptions = {}) {
    this.transport = options.transport ?? new HttpContext7Transport();
    this.apiKey = options.apiKey ?? process.env.CONTEXT7_API_KEY;
    this.enabled = options.enabled ?? false;
    this.mode = options.mode ?? "manual";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.clock = options.clock ?? (() => new Date(0).toISOString());
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
    const response = await this.transport.search({
      libraryName: input.libraryName,
      query: input.query,
      fast: input.fast ?? true,
      timeoutMs: this.timeoutMs,
      ...(this.apiKey ? { apiKey: this.apiKey } : {})
    });
    return {
      schemaVersion: "archcontext.external-docs-resolve/v1",
      provider: "context7",
      queryDigest: digestJson({ provider: "context7", libraryName: input.libraryName, query: input.query }),
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
    const docs = await this.transport.getContext({
      libraryId: `${input.libraryId}/${input.version}`,
      query,
      maxResults: input.maxResults ?? 4,
      timeoutMs: this.timeoutMs,
      ...(this.apiKey ? { apiKey: this.apiKey } : {})
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
    if (!response.ok) throw new Error(`Context7 search failed: ${response.status}`);
    return await response.json() as Context7SearchResponse;
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
    if (!response.ok) throw new Error(`Context7 context fetch failed: ${response.status}`);
    const payload = await response.json() as unknown;
    if (Array.isArray(payload)) return payload as Context7Documentation[];
    if (payload && typeof payload === "object" && Array.isArray((payload as any).results)) return (payload as any).results as Context7Documentation[];
    if (payload && typeof payload === "object" && Array.isArray((payload as any).docs)) return (payload as any).docs as Context7Documentation[];
    return [];
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
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}
