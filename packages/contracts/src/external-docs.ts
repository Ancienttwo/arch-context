import type { Json } from "./schema";

export const EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION = "archcontext.external-document/v1" as const;
export const CONTEXT7_LOCKFILE_SCHEMA_VERSION = "archcontext.context7-lock/v1" as const;

export type ExternalDocumentationProvider = "context7";
export type ExternalDocumentationTrust = "external-unverified";
export type ExternalDocumentationEnforcement = "advisory-only";
export type ExternalDocumentationCacheStatus = "fresh" | "stale" | "miss";
export type ExternalDocumentationMode = "manual" | "prepare-unknowns";

export interface ExternalDocumentationResourceSnippetV1 {
  title: string;
  contentPreview: string;
  contentDigest: string;
  sourceUri: string;
  byteCount: number;
}

export interface ExternalDocumentationResourceV1 {
  schemaVersion: typeof EXTERNAL_DOCUMENTATION_RESOURCE_SCHEMA_VERSION;
  provider: ExternalDocumentationProvider;
  libraryId: string;
  requestedVersion?: string;
  resolvedVersion?: string;
  queryDigest: string;
  contentDigest: string;
  retrievedAt: string;
  expiresAt: string;
  trust: ExternalDocumentationTrust;
  enforcement: ExternalDocumentationEnforcement;
  cacheStatus: ExternalDocumentationCacheStatus;
  uri: string;
  byteCount: number;
  snippets: ExternalDocumentationResourceSnippetV1[];
  warning: "untrusted-documentation-data";
  metadata?: Record<string, Json>;
}

export interface Context7LibraryPinV1 {
  libraryId: string;
  version: string;
  pinnedAt: string;
  source: "manual";
}

export interface Context7LockfileV1 {
  schemaVersion: typeof CONTEXT7_LOCKFILE_SCHEMA_VERSION;
  provider: "context7";
  libraries: Context7LibraryPinV1[];
}

export interface ExternalDocumentationProviderHealth {
  provider: ExternalDocumentationProvider;
  enabled: boolean;
  mode: ExternalDocumentationMode;
  egress: "none" | "manual-only" | "prepare-unknowns";
  cache: "sqlite";
  keySource: "env" | "os-credential" | "none";
}

export interface ExternalDocumentationResolveInput {
  provider: ExternalDocumentationProvider;
  libraryName: string;
  query: string;
  fast?: boolean;
}

export interface ExternalDocumentationLibraryCandidate {
  id: string;
  title: string;
  description?: string;
  versions: string[];
  trustScore?: number;
  benchmarkScore?: number;
}

export interface ExternalDocumentationResolveResult {
  schemaVersion: "archcontext.external-docs-resolve/v1";
  provider: ExternalDocumentationProvider;
  queryDigest: string;
  candidates: ExternalDocumentationLibraryCandidate[];
  searchFilterApplied: boolean;
  egress: "manual-only";
}

export interface ExternalDocumentationFetchInput {
  provider: ExternalDocumentationProvider;
  libraryId: string;
  version: string;
  intent: string;
  query?: string;
  maxResults?: number;
  ttlSeconds?: number;
  forceRefresh?: boolean;
}

export interface ExternalDocumentationFetchResult {
  schemaVersion: "archcontext.external-docs-fetch/v1";
  provider: ExternalDocumentationProvider;
  cacheStatus: ExternalDocumentationCacheStatus;
  resource: ExternalDocumentationResourceV1;
  request: {
    libraryId: string;
    version: string;
    queryDigest: string;
    intent: string;
  };
}

export interface ExternalDocumentationPurgeInput {
  provider?: ExternalDocumentationProvider;
  libraryId?: string;
  all?: boolean;
}

export interface ExternalDocumentationPurgeResult {
  schemaVersion: "archcontext.external-docs-purge/v1";
  purged: number;
}

export interface ExternalDocumentationCacheEntry {
  provider: ExternalDocumentationProvider;
  libraryId: string;
  version: string;
  queryDigest: string;
  contentDigest: string;
  resource: ExternalDocumentationResourceV1;
  retrievedAt: string;
  expiresAt: string;
}

export interface ExternalDocumentationPort {
  health(): ExternalDocumentationProviderHealth | Promise<ExternalDocumentationProviderHealth>;
  resolve(input: ExternalDocumentationResolveInput): Promise<ExternalDocumentationResolveResult>;
  fetch(input: ExternalDocumentationFetchInput): Promise<ExternalDocumentationFetchResult>;
}
