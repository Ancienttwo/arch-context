import { isLoopbackRemote, writeJson } from "./loopback-http";
import { matchesLoopbackAuthority, matchesSecret } from "./loopback-auth";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { renderExplorerHtml } from "@archcontext/local-runtime/explorer-html";
import { EXPLORER_VIEW_IDS, digestJson, errorEnvelope, okEnvelope, type ArchitectureChangeFeedRecordV1, type ExplorerDeltaQueryV2, type ExplorerProjectionQueryV2, type ExplorerProjectionV2, type Json, type JsonEnvelope } from "@archcontext/contracts";

export interface ExplorerServerOptions {
  port?: number;
  tokenTtlSeconds?: number;
}

export interface ExplorerServerStatus {
  running: boolean;
  host: "127.0.0.1";
  port?: number;
  url?: string;
  tokenExpiresAt?: string;
  revoked: boolean;
  readOnly: true;
}

interface ExplorerServerSession {
  server: Server;
  root: string;
  host: "127.0.0.1";
  port: number;
  token: string;
  expiresAt: number;
  revoked: boolean;
  sseClients: Set<ServerResponse>;
  expiryTimer?: ReturnType<typeof setTimeout>;
  lastProjectionDigest?: string;
}

interface ExplorerServerContext {
  assertRunning(): void;
  clock(): string;
  explorerProjectionV2(root: string, input: ExplorerProjectionQueryV2): Promise<JsonEnvelope>;
  explorerProjectionDelta(root: string, input: ExplorerDeltaQueryV2): Promise<JsonEnvelope>;
}

export class ExplorerServerService {
  private explorer?: ExplorerServerSession;

  constructor(private readonly context: ExplorerServerContext) {}

  notifyExplorerInvalidation(projection: ExplorerProjectionV2, affectedOccurrenceIds: string[]): void {
    const explorer = this.explorer;
    if (!explorer || explorer.lastProjectionDigest === projection.projectionDigest) return;
    if (explorer.revoked || Date.parse(this.context.clock()) >= explorer.expiresAt) {
      for (const client of explorer.sseClients) client.end();
      explorer.sseClients.clear();
      return;
    }
    explorer.lastProjectionDigest = projection.projectionDigest;
    const payload = JSON.stringify({
      schemaVersion: "archcontext.explorer-invalidation/v1",
      projectionDigest: projection.projectionDigest,
      graphDigest: projection.cursor.graphDigest,
      observedFactsDigest: projection.cursor.observedFactsDigest,
      viewDefinitionDigest: projection.cursor.viewDefinitionDigest,
      affectedOccurrencesDigest: digestJson(affectedOccurrenceIds as unknown as Json)
    });
    for (const client of explorer.sseClients) client.write(`event: projection-invalidated\ndata: ${payload}\n\n`);
  }

  async startExplorer(root: string, options: ExplorerServerOptions = {}): Promise<JsonEnvelope> {
    this.context.assertRunning();
    await this.closeExplorer();
    const ttlSeconds = options.tokenTtlSeconds ?? 900;
    const token = randomBytes(18).toString("base64url");
    const expiresAt = Date.parse(this.context.clock()) + ttlSeconds * 1000;
    const holder = {} as ExplorerServerSession;
    const server = createServer((request, response) => {
      void this.handleExplorerRequest(request, response, holder).catch((error) => {
        writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    });
    Object.assign(holder, {
      server,
      root,
      host: "127.0.0.1",
      port: 0,
      token,
      expiresAt,
      revoked: false,
      sseClients: new Set<ServerResponse>()
    });
    await new Promise<void>((resolveListen) => server.listen(options.port ?? 0, "127.0.0.1", resolveListen));
    holder.port = (server.address() as AddressInfo).port;
    holder.expiryTimer = setTimeout(
      () => this.expireExplorerSession(holder),
      Math.max(0, expiresAt - Date.parse(this.context.clock()))
    );
    this.explorer = holder;
    return okEnvelope("explorer.start", {
      ...this.explorerStatusData(),
      token,
      tokenTtlSeconds: ttlSeconds
    } as Json);
  }

  async stopExplorer(): Promise<JsonEnvelope> {
    this.context.assertRunning();
    await this.closeExplorer();
    return okEnvelope("explorer.stop", this.explorerStatusData() as unknown as Json);
  }

  async revokeExplorerToken(): Promise<JsonEnvelope> {
    this.context.assertRunning();
    if (this.explorer) {
      if (this.explorer.expiryTimer) clearTimeout(this.explorer.expiryTimer);
      this.explorer.expiryTimer = undefined;
      this.explorer.revoked = true;
      for (const client of this.explorer.sseClients) client.end();
      this.explorer.sseClients.clear();
    }
    return okEnvelope("explorer.revoke", this.explorerStatusData() as unknown as Json);
  }

  explorerStatus(): JsonEnvelope {
    this.context.assertRunning();
    return okEnvelope("explorer.status", this.explorerStatusData() as unknown as Json);
  }

  notifyExplorerAuthorityInvalidation(root: string, record: ArchitectureChangeFeedRecordV1, occurrenceIds: string[]): void {
    const explorer = this.explorer;
    if (!explorer || explorer.root !== root) return;
    if (explorer.revoked || Date.parse(this.context.clock()) >= explorer.expiresAt) {
      for (const client of explorer.sseClients) client.end();
      explorer.sseClients.clear();
      return;
    }
    const payload = JSON.stringify({
      schemaVersion: "archcontext.explorer-authority-invalidation/v1",
      feedSequence: record.feedSequence,
      eventId: record.eventId,
      eventHash: record.eventHash,
      subjectsDigest: record.subjectsDigest,
      changedInputDigestsDigest: digestJson(record.changedInputDigests as unknown as Json),
      affectedOccurrencesDigest: digestJson(occurrenceIds as unknown as Json)
    });
    for (const client of explorer.sseClients) client.write(`event: authority-changed\ndata: ${payload}\n\n`);
  }

  private async handleExplorerRequest(request: IncomingMessage, response: ServerResponse, session: ExplorerServerSession): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${session.host}:${session.port}`);
    response.setHeader("Cache-Control", "no-store");
    if (!isLoopbackRemote(request.socket.remoteAddress) || !matchesLoopbackAuthority(request, `http://${session.host}:${session.port}`)) {
      writeJson(response, 403, { ok: false, error: "explorer request authority rejected" });
      return;
    }
    if (request.method !== "GET") {
      writeJson(response, 405, { ok: false, error: "explorer is read-only" });
      return;
    }
    if (!this.isExplorerAuthorized(request, url, session)) {
      writeJson(response, 401, { ok: false, error: "explorer token required" });
      return;
    }
    if (url.pathname === "/health") {
      writeJson(response, 200, { ok: true, running: true, readOnly: true, host: session.host });
      return;
    }
    if (url.pathname === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      response.write(": archcontext explorer digest invalidation\n\n");
      session.sseClients.add(response);
      request.on("close", () => session.sseClients.delete(response));
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      let query: ExplorerProjectionQueryV2;
      try {
        query = explorerProjectionQueryV2FromUrl(url);
      } catch (error) {
        writeJson(response, 400, errorEnvelope("explorer.projection.v2", "AC_SCHEMA_INVALID", error instanceof Error ? error.message : String(error)));
        return;
      }
      const result = await this.context.explorerProjectionV2(session.root, query);
      if (!result.ok) {
        writeJson(response, result.error?.code === "AC_PRECONDITION_FAILED" ? 409 : 400, result);
        return;
      }
      const projection = result.data as unknown as ExplorerProjectionV2;
      writeHtml(response, 200, renderExplorerHtml(projection, { focusSubjectId: query.focus?.subjectId }));
      return;
    }
    if (url.pathname === "/projection/v2") {
      let query: ExplorerProjectionQueryV2;
      try {
        query = explorerProjectionQueryV2FromUrl(url);
      } catch (error) {
        writeJson(response, 400, errorEnvelope(
          "explorer.projection.v2",
          "AC_SCHEMA_INVALID",
          error instanceof Error ? error.message : String(error)
        ));
        return;
      }
      const result = await this.context.explorerProjectionV2(session.root, query);
      writeJson(response, result.ok ? 200 : result.error?.code === "AC_PRECONDITION_FAILED" ? 409 : 400, result);
      return;
    }
    if (url.pathname === "/delta") {
      const baseEventId = url.searchParams.get("baseEventId");
      const headEventId = url.searchParams.get("headEventId");
      const baseProjectionDigest = url.searchParams.get("baseProjectionDigest");
      const headProjectionDigest = url.searchParams.get("headProjectionDigest");
      if (!baseEventId || !headEventId || !baseProjectionDigest || !headProjectionDigest) {
        writeJson(response, 400, errorEnvelope("explorer.delta", "AC_SCHEMA_INVALID", "baseEventId, headEventId, baseProjectionDigest and headProjectionDigest are required"));
        return;
      }
      const result = await this.context.explorerProjectionDelta(session.root, {
        schemaVersion: "archcontext.explorer-delta-query/v2",
        base: { eventId: baseEventId, projectionDigest: baseProjectionDigest },
        head: { eventId: headEventId, projectionDigest: headProjectionDigest }
      });
      writeJson(response, result.ok ? 200 : 409, result);
      return;
    }
    writeJson(response, 404, { ok: false, error: "not found" });
  }

  private isExplorerAuthorized(request: IncomingMessage, url: URL, session: ExplorerServerSession): boolean {
    if (session.revoked || Date.parse(this.context.clock()) >= session.expiresAt) return false;
    const authorization = request.headers.authorization ?? "";
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    return matchesSecret(bearer, `Bearer ${session.token}`) || matchesSecret(url.searchParams.get("token"), session.token);
  }

  private explorerStatusData(): ExplorerServerStatus {
    if (!this.explorer) return { running: false, host: "127.0.0.1", revoked: true, readOnly: true };
    return {
      running: true,
      host: this.explorer.host,
      port: this.explorer.port,
      url: `http://${this.explorer.host}:${this.explorer.port}/`,
      tokenExpiresAt: new Date(this.explorer.expiresAt).toISOString(),
      revoked: this.explorer.revoked,
      readOnly: true
    };
  }

  async closeExplorer(): Promise<void> {
    const current = this.explorer;
    if (!current) return;
    this.explorer = undefined;
    if (current.expiryTimer) clearTimeout(current.expiryTimer);
    current.expiryTimer = undefined;
    for (const client of current.sseClients) client.end();
    current.sseClients.clear();
    await new Promise<void>((resolveClose, rejectClose) => {
      current.server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }

  private expireExplorerSession(session: ExplorerServerSession): void {
    if (this.explorer !== session || session.revoked) return;
    session.expiryTimer = undefined;
    session.revoked = true;
    for (const client of session.sseClients) client.end();
    session.sseClients.clear();
  }
}

function explorerProjectionQueryV2FromUrl(url: URL): ExplorerProjectionQueryV2 {
  const expectedValues = {
    headSha: url.searchParams.get("expectedHeadSha") ?? undefined,
    worktreeDigest: url.searchParams.get("expectedWorktreeDigest") ?? undefined,
    graphDigest: url.searchParams.get("expectedGraphDigest") ?? undefined,
    observedFactsDigest: url.searchParams.get("expectedObservedFactsDigest") ?? undefined
  };
  const expectedRequired = [expectedValues.headSha, expectedValues.worktreeDigest, expectedValues.graphDigest];
  if (expectedRequired.some(Boolean) && !expectedRequired.every(Boolean)) {
    throw new Error("expectedHeadSha, expectedWorktreeDigest, and expectedGraphDigest must be provided together");
  }
  const maxNodes = parseExplorerInteger(url.searchParams.get("maxNodes"), 80, "maxNodes");
  const maxRelations = parseExplorerInteger(url.searchParams.get("maxRelations"), 160, "maxRelations");
  const depth = parseExplorerInteger(url.searchParams.get("depth"), 1, "depth") as 0 | 1 | 2;
  const viewId = url.searchParams.get("view") ?? "system-map";
  if (!(EXPLORER_VIEW_IDS as readonly string[]).includes(viewId)) throw new Error(`unsupported Explorer view: ${viewId}`);
  const semanticLevel = url.searchParams.get("level") ?? "context";
  if (!(["overview", "context", "detail"] as string[]).includes(semanticLevel)) throw new Error(`unsupported Explorer semantic level: ${semanticLevel}`);
  return {
    schemaVersion: "archcontext.explorer-projection-query/v2",
    viewId: viewId as ExplorerProjectionQueryV2["viewId"],
    semanticLevel: semanticLevel as NonNullable<ExplorerProjectionQueryV2["semanticLevel"]>,
    ...(url.searchParams.get("taskSessionId") ? { taskSessionId: url.searchParams.get("taskSessionId")! } : {}),
    ...(expectedRequired.every(Boolean) ? {
      expectedCursor: {
        headSha: expectedValues.headSha!,
        worktreeDigest: expectedValues.worktreeDigest!,
        graphDigest: expectedValues.graphDigest!,
        ...(expectedValues.observedFactsDigest ? { observedFactsDigest: expectedValues.observedFactsDigest } : {})
      }
    } : {}),
    ...(url.searchParams.get("focus") ? { focus: { subjectId: url.searchParams.get("focus")! } } : {}),
    expandedOccurrenceIds: url.searchParams.getAll("expand"),
    depth,
    budget: { maxNodes, maxRelations }
  };
}

function parseExplorerInteger(value: string | null, fallback: number, field: string): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed;
}

function writeHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  });
  response.end(body);
}
