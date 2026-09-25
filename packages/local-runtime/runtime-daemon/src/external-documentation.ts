import { ChangeSetRecoveryUnresolvedError } from "./changeset-recovery-error";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertPathHasNoSymlinkSegments, writeFileWithoutFollowingSymlinks } from "@archcontext/core/changeset-engine";
import type { prepareTask } from "@archcontext/core/application";
import { Context7ExternalDocumentationAdapter, assertContext7LibraryId, assertContext7Version, buildContext7Query } from "@archcontext/local-runtime/context7-adapter";
import { finalizeContextBudgetMetadata } from "@archcontext/core/context-compiler";
import { CONTEXT7_LOCKFILE_SCHEMA_VERSION, digestJson, errorEnvelope, okEnvelope, type Context7LibraryPinV1, type Context7LockfileV1, type ExternalDocumentationCacheEntry, type ExternalDocumentationFetchInput, type ExternalDocumentationPort, type ExternalDocumentationProvider, type ExternalDocumentationResourceV1, type Json, type JsonEnvelope } from "@archcontext/contracts";
import { type RuntimeLocalStore } from "@archcontext/local-runtime/local-store-sqlite";
import type { ArchctxDaemon, RepositorySession } from "./index";

export interface RuntimeDocsInput {
  command: "status" | "resolve" | "pin" | "fetch" | "purge";
  provider?: ExternalDocumentationProvider;
  libraryName?: string;
  libraryId?: string;
  version?: string;
  query?: string;
  intent?: string;
  approved?: boolean;
  allowNetwork?: boolean;
  forceRefresh?: boolean;
  all?: boolean;
}

export interface RuntimeResourceReadResult {
  schemaVersion: "archcontext.resource-read/v1";
  uri: string;
  dataClassification: "external-unverified-documentation";
  resource: ExternalDocumentationResourceV1;
}

const CONTEXT7_LOCKFILE = ".archcontext/integrations/context7.lock.yaml";

type PreparedTaskContext = Awaited<ReturnType<typeof prepareTask>>["context"];

interface PrepareUnknownsCandidate {
  packageName: string;
  libraryId: string;
  version: string;
  intent: string;
}

const CONTEXT7_PREPARE_FRAMEWORKS = [
  {
    packageName: "react",
    libraryId: "/facebook/react",
    scopePattern: /\b(react|jsx|hook|hooks|usestate|useeffect|component|suspense)\b/i,
    intentPattern: /\b(hook|hooks|usestate|useeffect|state|component|suspense|jsx)\b/i,
    intent: "state hooks"
  },
  {
    packageName: "next",
    libraryId: "/vercel/next.js",
    scopePattern: /\b(next(?:\.js)?|app router|route handler|middleware|server component)\b/i,
    intentPattern: /\b(app router|route handler|middleware|server component|routing|cache)\b/i,
    intent: "app router"
  },
  {
    packageName: "express",
    libraryId: "/expressjs/express",
    scopePattern: /\b(express|middleware|route handler)\b/i,
    intentPattern: /\b(middleware|route|handler|request|response)\b/i,
    intent: "middleware routing"
  }
] as const;

const EXTERNAL_DOCUMENTATION_RESOURCE_URI_PATTERN = /^archcontext:\/\/external-docs\/context7\/(sha256:[0-9a-f]{64})$/;

function parseExternalDocumentationResourceUri(uri: string): {
  provider: ExternalDocumentationProvider;
  contentDigest: string;
} | undefined {
  const match = EXTERNAL_DOCUMENTATION_RESOURCE_URI_PATTERN.exec(uri);
  if (!match) return undefined;
  return { provider: "context7", contentDigest: match[1] };
}

interface ExternalDocumentationContext {
  assertRunning(): void;
  openSession: ArchctxDaemon["openSession"];
  withWriter<T>(fn: () => Promise<T>): Promise<T>;
  clock(): string;
  externalDocumentation: ExternalDocumentationPort;
  externalDocumentationInjected: boolean;
  localStore: Pick<RuntimeLocalStore, "listExternalDocumentation" | "readExternalDocumentation" | "saveExternalDocumentation" | "purgeExternalDocumentation" | "readExternalDocumentationByContentDigest">;
}

export class ExternalDocumentationService {
  constructor(private readonly context: ExternalDocumentationContext) {}

  async docs(root: string, input: RuntimeDocsInput): Promise<JsonEnvelope> {
    this.context.assertRunning();
    const provider = input.provider ?? "context7";
    if (provider !== "context7") return errorEnvelope("docs", "AC_SCHEMA_INVALID", "docs provider must be context7");
    const session = await this.context.openSession(root);
    try {
      if (input.command === "status") {
        const lock = readContext7Lockfile(session.workspace.root);
        const cached = await this.context.localStore.listExternalDocumentation("context7");
        return okEnvelope("docs.status", {
          schemaVersion: "archcontext.external-docs-status/v1",
          provider: "context7",
          health: await this.context.externalDocumentation.health(),
          lock,
          cacheEntries: cached.map((entry) => ({
            provider: entry.provider,
            libraryId: entry.libraryId,
            version: entry.version,
            queryDigest: entry.queryDigest,
            contentDigest: entry.contentDigest,
            retrievedAt: entry.retrievedAt,
            expiresAt: entry.expiresAt,
            stale: Date.parse(entry.expiresAt) <= Date.parse(this.context.clock())
          })),
          defaultPrepareEgress: "none"
        } as unknown as Json);
      }
      if (input.command === "pin") {
        if (!input.libraryId || !input.version) return errorEnvelope("docs.pin", "AC_SCHEMA_INVALID", "docs pin requires --library-id and --version");
        assertContext7LibraryId(input.libraryId);
        assertContext7Version(input.version);
        const pin = {
          libraryId: input.libraryId,
          version: input.version,
          pinnedAt: this.context.clock(),
          source: "manual" as const
        };
        if (!input.approved) {
          return okEnvelope("docs.pin", {
            schemaVersion: "archcontext.context7-pin-preview/v1",
            approved: false,
            path: CONTEXT7_LOCKFILE,
            lock: upsertContext7Pin(readContext7LockfileState(session.workspace.root).lock, pin)
          } as unknown as Json);
        }
        // The approved pin writes a tracked `.archcontext/` file, so it is a writer like any other
        // (#172: refused while ChangeSet recovery is unresolved).
        return await this.context.withWriter(async () => {
          const current = readContext7LockfileState(session.workspace.root);
          const lock = upsertContext7Pin(current.lock, pin);
          writeContext7Lockfile(session.workspace.root, lock, current.expectedHash);
          return okEnvelope("docs.pin", {
            schemaVersion: "archcontext.context7-pin/v1",
            approved: true,
            path: CONTEXT7_LOCKFILE,
            lock
          } as unknown as Json);
        });
      }
      if (input.command === "resolve") {
        if (!input.allowNetwork) return errorEnvelope("docs.resolve", "AC_SCHEMA_INVALID", "docs resolve requires --allow-network");
        if (!input.libraryName || !input.query) return errorEnvelope("docs.resolve", "AC_SCHEMA_INVALID", "docs resolve requires --library and --query");
        return okEnvelope("docs.resolve", await this.manualExternalDocumentation().resolve({
          provider: "context7",
          libraryName: input.libraryName,
          query: input.query,
          fast: true
        }) as unknown as Json);
      }
      if (input.command === "fetch") {
        if (!input.allowNetwork) return errorEnvelope("docs.fetch", "AC_SCHEMA_INVALID", "docs fetch requires --allow-network");
        if (!input.libraryId || !input.intent) return errorEnvelope("docs.fetch", "AC_SCHEMA_INVALID", "docs fetch requires --library-id and --intent");
        assertContext7LibraryId(input.libraryId);
        const lock = readContext7Lockfile(session.workspace.root);
        const pinned = lock.libraries.find((library) => library.libraryId === input.libraryId);
        if (!pinned) return errorEnvelope("docs.fetch", "AC_SCHEMA_INVALID", "docs fetch requires a pinned library in .archcontext/integrations/context7.lock.yaml");
        const query = buildContext7Query({ intent: input.intent, query: input.query });
        const queryDigest = digestJson({ provider: "context7", libraryId: input.libraryId, version: pinned.version, query });
        const cached = await this.context.localStore.readExternalDocumentation({
          provider: "context7",
          libraryId: input.libraryId,
          version: pinned.version,
          queryDigest
        });
        if (cached && !input.forceRefresh && Date.parse(cached.expiresAt) > Date.parse(this.context.clock())) {
          return okEnvelope("docs.fetch", {
            schemaVersion: "archcontext.external-docs-fetch/v1",
            provider: "context7",
            cacheStatus: "fresh",
            resource: { ...cached.resource, cacheStatus: "fresh" },
            request: { libraryId: input.libraryId, version: pinned.version, queryDigest, intent: input.intent }
          } as unknown as Json);
        }
        const result = await this.manualExternalDocumentation().fetch({
          provider: "context7",
          libraryId: input.libraryId,
          version: pinned.version,
          intent: input.intent,
          ...(input.query ? { query: input.query } : {}),
          forceRefresh: input.forceRefresh
        } satisfies ExternalDocumentationFetchInput);
        const resource = { ...result.resource, queryDigest, cacheStatus: "fresh" as const };
        await this.context.localStore.saveExternalDocumentation({
          provider: "context7",
          libraryId: input.libraryId,
          version: pinned.version,
          queryDigest,
          contentDigest: resource.contentDigest,
          resource,
          retrievedAt: resource.retrievedAt,
          expiresAt: resource.expiresAt
        } satisfies ExternalDocumentationCacheEntry);
        return okEnvelope("docs.fetch", {
          ...result,
          cacheStatus: "miss",
          request: { ...result.request, queryDigest },
          resource
        } as unknown as Json);
      }
      if (input.command === "purge") {
        const purged = await this.context.localStore.purgeExternalDocumentation({
          provider: "context7",
          ...(input.libraryId ? { libraryId: input.libraryId } : {}),
          all: input.all
        });
        return okEnvelope("docs.purge", {
          schemaVersion: "archcontext.external-docs-purge/v1",
          purged
        } as unknown as Json);
      }
      return errorEnvelope("docs", "AC_SCHEMA_INVALID", "docs requires status|resolve|pin|fetch|purge");
    } catch (error) {
      const code = error instanceof ChangeSetRecoveryUnresolvedError ? "AC_PRECONDITION_FAILED" : "AC_SCHEMA_INVALID";
      return errorEnvelope(`docs.${input.command}`, code, error instanceof Error ? error.message : String(error));
    }
  }

  async readResource(root: string, uri: string): Promise<JsonEnvelope> {
    this.context.assertRunning();
    await this.context.openSession(root);
    const parsed = parseExternalDocumentationResourceUri(uri);
    if (!parsed) {
      return errorEnvelope("resource.read", "AC_SCHEMA_INVALID", "unsupported resource URI");
    }
    const cached = await this.context.localStore.readExternalDocumentationByContentDigest(parsed);
    if (!cached) {
      return errorEnvelope("resource.read", "AC_SCHEMA_INVALID", "external documentation resource is not present in the local daemon cache");
    }
    const cacheStatus = Date.parse(cached.expiresAt) > Date.parse(this.context.clock()) ? "fresh" : "stale";
    const resource: ExternalDocumentationResourceV1 = {
      ...cached.resource,
      uri,
      cacheStatus
    };
    const result: RuntimeResourceReadResult = {
      schemaVersion: "archcontext.resource-read/v1",
      uri,
      dataClassification: "external-unverified-documentation",
      resource
    };
    return okEnvelope("resource.read", result as unknown as Json);
  }

  private manualExternalDocumentation(): ExternalDocumentationPort {
    if (this.context.externalDocumentationInjected) return this.context.externalDocumentation;
    return new Context7ExternalDocumentationAdapter({
      enabled: true,
      mode: "manual",
      clock: this.context.clock
    });
  }

  async augmentPrepareContextWithExternalDocs(
    session: RepositorySession,
    task: string,
    context: PreparedTaskContext,
    maxBytes: number
  ): Promise<PreparedTaskContext> {
    let health;
    try {
      health = await this.context.externalDocumentation.health();
    } catch {
      return context;
    }
    if (health.provider !== "context7" || !health.enabled || health.mode !== "prepare-unknowns") return context;
    const lock = readContext7Lockfile(session.workspace.root);
    const candidate = resolvePrepareUnknownsCandidate(session.workspace.root, task, context, lock);
    if (!candidate) return context;
    const resource = await this.readOrFetchPrepareExternalDocumentation(candidate);
    if (!resource) return context;
    return appendExternalDocumentationToContext(context, resource, candidate, maxBytes);
  }

  private async readOrFetchPrepareExternalDocumentation(candidate: PrepareUnknownsCandidate): Promise<ExternalDocumentationResourceV1 | undefined> {
    const query = buildContext7Query({ intent: candidate.intent });
    const queryDigest = digestJson({
      provider: "context7",
      libraryId: candidate.libraryId,
      version: candidate.version,
      query
    });
    const cached = await this.context.localStore.readExternalDocumentation({
      provider: "context7",
      libraryId: candidate.libraryId,
      version: candidate.version,
      queryDigest
    });
    if (cached && Date.parse(cached.expiresAt) > Date.parse(this.context.clock())) {
      return { ...cached.resource, queryDigest, cacheStatus: "fresh" };
    }
    try {
      const result = await this.context.externalDocumentation.fetch({
        provider: "context7",
        libraryId: candidate.libraryId,
        version: candidate.version,
        intent: candidate.intent
      });
      const resource = { ...result.resource, queryDigest, cacheStatus: "fresh" as const };
      await this.context.localStore.saveExternalDocumentation({
        provider: "context7",
        libraryId: candidate.libraryId,
        version: candidate.version,
        queryDigest,
        contentDigest: resource.contentDigest,
        resource,
        retrievedAt: resource.retrievedAt,
        expiresAt: resource.expiresAt
      });
      return resource;
    } catch {
      return cached ? { ...cached.resource, queryDigest, cacheStatus: "stale" } : undefined;
    }
  }

}

function resolvePrepareUnknownsCandidate(root: string, task: string, context: PreparedTaskContext, lock: Context7LockfileV1): PrepareUnknownsCandidate | undefined {
  if (!prepareContextHasVersionRelatedUnknown(context)) return undefined;
  for (const framework of CONTEXT7_PREPARE_FRAMEWORKS) {
    if (!framework.scopePattern.test(task) || !framework.intentPattern.test(task)) continue;
    const pinned = lock.libraries.find((library) => library.libraryId === framework.libraryId);
    if (!pinned) continue;
    const exactVersion = readExactPackageVersion(root, framework.packageName);
    if (!exactVersion || exactVersion !== pinned.version) continue;
    return {
      packageName: framework.packageName,
      libraryId: framework.libraryId,
      version: exactVersion,
      intent: framework.intent
    };
  }
  return undefined;
}

function appendExternalDocumentationToContext(
  context: PreparedTaskContext,
  resource: ExternalDocumentationResourceV1,
  candidate: PrepareUnknownsCandidate,
  maxBytes: number
): PreparedTaskContext {
  const externalResource = {
    type: "external-docs",
    provider: resource.provider,
    uri: resource.uri,
    digest: resource.contentDigest,
    libraryId: candidate.libraryId,
    packageName: candidate.packageName,
    version: candidate.version,
    queryDigest: resource.queryDigest,
    trust: resource.trust,
    enforcement: resource.enforcement,
    cacheStatus: resource.cacheStatus,
    retrievedAt: resource.retrievedAt,
    expiresAt: resource.expiresAt
  } as Record<string, Json>;
  const resources = context.resources.some((entry) => entry.uri === resource.uri)
    ? context.resources
    : [...context.resources, externalResource as any];
  const unknown = `External documentation is advisory and untrusted for ${candidate.packageName}@${candidate.version}: ${candidate.intent}`;
  const unknowns = context.unknowns.includes(unknown) ? context.unknowns : [...context.unknowns, unknown];
  const augmented = {
    ...context,
    unknowns,
    resources,
    recommendedTargetState: {
      ...context.recommendedTargetState,
      externalDocumentation: {
        provider: resource.provider,
        libraryId: candidate.libraryId,
        packageName: candidate.packageName,
        version: candidate.version,
        intent: candidate.intent,
        resourceUri: resource.uri,
        contentDigest: resource.contentDigest,
        trust: resource.trust,
        enforcement: resource.enforcement
      }
    },
    extensions: {
      ...context.extensions,
      externalDocumentationDigest: digestJson({
        provider: resource.provider,
        libraryId: candidate.libraryId,
        version: candidate.version,
        queryDigest: resource.queryDigest,
        contentDigest: resource.contentDigest,
        cacheStatus: resource.cacheStatus
      } as unknown as Json)
    }
  };
  return finalizeContextBudgetMetadata(augmented, maxBytes);
}

function prepareContextHasVersionRelatedUnknown(context: PreparedTaskContext): boolean {
  const unknowns = context.unknowns.join(" ").toLowerCase();
  if (/\b(version|dependency|dependencies|package|lockfile|runtime dependency|pinned)\b/.test(unknowns)) return true;
  return context.architecturePressure.signals.includes("unpinned-runtime-dependency");
}

function readExactPackageVersion(root: string, packageName: string): string | undefined {
  const lockVersion = readPackageLockExactVersion(root, packageName);
  if (lockVersion) return lockVersion;
  for (const manifestPath of packageManifestPaths(root)) {
    const manifest = readJsonFile(manifestPath);
    const version = exactVersionFromManifest(manifest, packageName);
    if (version) return version;
  }
  return undefined;
}

function readPackageLockExactVersion(root: string, packageName: string): string | undefined {
  const lock = readJsonFile(resolve(root, "package-lock.json"));
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return undefined;
  const packages = (lock as { packages?: Record<string, unknown> }).packages;
  if (packages && typeof packages === "object") {
    const entry = packages[`node_modules/${packageName}`] as { version?: unknown } | undefined;
    if (typeof entry?.version === "string" && isExactPackageVersion(entry.version)) return entry.version;
  }
  const dependencies = (lock as { dependencies?: Record<string, unknown> }).dependencies;
  if (dependencies && typeof dependencies === "object") {
    const entry = dependencies[packageName] as { version?: unknown } | undefined;
    if (typeof entry?.version === "string" && isExactPackageVersion(entry.version)) return entry.version;
  }
  return undefined;
}

function packageManifestPaths(root: string): string[] {
  const paths = [resolve(root, "package.json")];
  const rootManifest = readJsonFile(paths[0]);
  for (const pattern of workspacePatternsFromManifest(rootManifest)) {
    for (const path of expandWorkspacePackageJson(root, pattern)) paths.push(path);
  }
  return [...new Set(paths)];
}

function workspacePatternsFromManifest(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  const workspaces = (manifest as { workspaces?: unknown }).workspaces;
  if (Array.isArray(workspaces)) return workspaces.filter((item): item is string => typeof item === "string");
  if (workspaces && typeof workspaces === "object" && Array.isArray((workspaces as { packages?: unknown }).packages)) {
    return (workspaces as { packages: unknown[] }).packages.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function expandWorkspacePackageJson(root: string, pattern: string): string[] {
  if (pattern.includes("**") || pattern.startsWith("/") || pattern.includes("\\")) return [];
  if (!pattern.includes("*")) {
    const path = resolve(root, pattern, "package.json");
    return existsSync(path) ? [path] : [];
  }
  if (!pattern.endsWith("/*")) return [];
  const base = resolve(root, pattern.slice(0, -2));
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(base, entry.name, "package.json"))
    .filter((path) => existsSync(path));
}

function exactVersionFromManifest(manifest: unknown, packageName: string): string | undefined {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies = (manifest as Record<string, unknown>)[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
    const value = (dependencies as Record<string, unknown>)[packageName];
    if (typeof value === "string" && isExactPackageVersion(value)) return value;
  }
  return undefined;
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isExactPackageVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function readContext7Lockfile(root: string): Context7LockfileV1 {
  return readContext7LockfileState(root).lock;
}

/**
 * The lockfile plus the hash of the exact bytes the lock was parsed from, so an approved pin can
 * carry that hash into the write as an optimistic-concurrency precondition. Reading once is what
 * makes the precondition meaningful: hashing a second read would only prove the file was stable
 * between two reads, not that the pin is being applied to the state it was computed from.
 */
function readContext7LockfileState(root: string): { lock: Context7LockfileV1; expectedHash: string } {
  const path = assertPathHasNoSymlinkSegments(root, CONTEXT7_LOCKFILE);
  if (!existsSync(path)) {
    return {
      lock: {
        schemaVersion: CONTEXT7_LOCKFILE_SCHEMA_VERSION,
        provider: "context7",
        libraries: []
      },
      expectedHash: "missing"
    };
  }
  const body = readFileSync(path, "utf8");
  const parsed = JSON.parse(body) as Context7LockfileV1;
  if (parsed.schemaVersion !== CONTEXT7_LOCKFILE_SCHEMA_VERSION || parsed.provider !== "context7" || !Array.isArray(parsed.libraries)) {
    throw new Error("Invalid Context7 lockfile");
  }
  for (const library of parsed.libraries) {
    assertContext7LibraryId(library.libraryId);
    assertContext7Version(library.version);
  }
  return {
    lock: {
      ...parsed,
      libraries: [...parsed.libraries].sort((a, b) => a.libraryId.localeCompare(b.libraryId))
    },
    expectedHash: digestJson({ body } as unknown as Json)
  };
}

function upsertContext7Pin(lock: Context7LockfileV1, pin: Context7LibraryPinV1): Context7LockfileV1 {
  return {
    schemaVersion: CONTEXT7_LOCKFILE_SCHEMA_VERSION,
    provider: "context7",
    libraries: [...lock.libraries.filter((library) => library.libraryId !== pin.libraryId), pin]
      .sort((a, b) => a.libraryId.localeCompare(b.libraryId))
  };
}

function writeContext7Lockfile(root: string, lock: Context7LockfileV1, expectedHash: string): void {
  writeFileWithoutFollowingSymlinks({
    root,
    path: CONTEXT7_LOCKFILE,
    body: JSON.stringify(lock, null, 2),
    mode: 0o600,
    expectedHash
  });
}
