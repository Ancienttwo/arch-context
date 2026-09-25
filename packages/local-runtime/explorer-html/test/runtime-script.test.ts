import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ExplorerProjectionV2 } from "@archcontext/contracts";
import { renderExplorerHtml } from "../src/index";

const projection = JSON.parse(readFileSync(
  new URL("../../../contracts/fixtures/valid/explorer-projection-v2.json", import.meta.url),
  "utf8"
)) as ExplorerProjectionV2;

describe("Explorer inline runtime", () => {
  test("toggles exact expand state and preserves unrelated URL state", () => {
    const expand = element({ "data-expand": "occurrence.group.one" });
    const focus = element({ "data-focus": "module.runtime" });
    const breadcrumb = element({ "data-breadcrumb-level": "context" });
    const view = element({ "data-view": "drift-pressure" });
    const harness = execute({
      url: "http://127.0.0.1:7420/?maxNodes=80&depth=2&expand=occurrence.group.one&expand=occurrence.group.two&expand=occurrence.group.two",
      selectors: {
        "[data-expand]": [expand],
        "[data-focus]": [focus],
        "[data-breadcrumb-level]": [breadcrumb],
        "[data-view]": [view]
      }
    });

    expand.dispatch("click");
    let url = new URL(harness.window.location.href);
    expect(url.searchParams.getAll("expand")).toEqual(["occurrence.group.two", "occurrence.group.two"]);
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.searchParams.get("maxNodes")).toBe("80");
    expect(url.searchParams.get("depth")).toBe("2");

    harness.window.location.href = "http://127.0.0.1:7420/?expand=occurrence.group.two";
    expand.dispatch("click");
    url = new URL(harness.window.location.href);
    expect(url.searchParams.getAll("expand")).toEqual(["occurrence.group.two", "occurrence.group.one"]);

    focus.dispatch("click");
    url = new URL(harness.window.location.href);
    expect(url.searchParams.get("focus")).toBe("module.runtime");
    expect(url.searchParams.get("level")).toBe("detail");
    expect(url.searchParams.getAll("expand")).toEqual(["occurrence.group.two", "occurrence.group.one"]);

    breadcrumb.dispatch("click");
    url = new URL(harness.window.location.href);
    expect(url.searchParams.get("focus")).toBeNull();
    expect(url.searchParams.get("level")).toBe("context");
    expect(url.searchParams.has("token")).toBe(false);

    view.dispatch("click");
    url = new URL(harness.window.location.href);
    expect(url.searchParams.get("view")).toBe("drift-pressure");
    expect(url.searchParams.get("level")).toBe("context");
  });

  test("coalesces authority events and qualifies projection invalidation by both digests", async () => {
    const live = element({}, "live-status");
    const harness = execute({ elementsById: { "live-status": live } });
    const source = harness.sources[0];
    await source.ready;
    expect(source.url).toBe("/events");
    expect(source.headers).toEqual({ Authorization: "Bearer secret" });
    expect(live.textContent).toBe("live updates connected");

    await source.emit("authority-changed", { data: "" });
    await source.emit("authority-changed", { data: "not-used" });
    expect(harness.pendingTimers()).toBe(1);
    harness.flushTimers();
    expect(harness.reloads()).toBe(1);

    await source.emit("projection-invalidated", { data: JSON.stringify({
      viewDefinitionDigest: projection.cursor.viewDefinitionDigest,
      projectionDigest: projection.projectionDigest
    }) });
    await source.emit("projection-invalidated", { data: JSON.stringify({
      viewDefinitionDigest: "sha256:different-view",
      projectionDigest: "sha256:new-projection"
    }) });
    expect(harness.pendingTimers()).toBe(0);

    await source.emit("projection-invalidated", { data: JSON.stringify({
      viewDefinitionDigest: projection.cursor.viewDefinitionDigest,
      projectionDigest: "sha256:new-projection"
    }) });
    await source.emit("projection-invalidated", { data: JSON.stringify({
      viewDefinitionDigest: projection.cursor.viewDefinitionDigest,
      projectionDigest: "sha256:newer-projection"
    }) });
    expect(harness.pendingTimers()).toBe(1);
    harness.flushTimers();
    expect(harness.reloads()).toBe(2);
  });

  test("fails closed on malformed events, EventSource errors, without a session", async () => {
    const live = element({}, "live-status");
    const harness = execute({ elementsById: { "live-status": live } });
    const source = harness.sources[0];
    await source.ready;
    await source.emit("projection-invalidated", { data: "{" });
    expect(source.closed).toBe(true);
    expect(live.textContent).toBe("live updates disconnected");
    expect(live.getAttribute("data-live-state")).toBe("disconnected");
    expect(harness.pendingTimers()).toBe(0);

    const errorLive = element({}, "live-status");
    const onError = execute({ elementsById: { "live-status": errorLive } });
    await onError.sources[0].emit("authority-changed", { data: "" });
    expect(onError.pendingTimers()).toBe(1);
    await onError.sources[0].emit("error", {});
    expect(onError.sources[0].closed).toBe(true);
    expect(errorLive.textContent).toBe("live updates disconnected");
    expect(onError.pendingTimers()).toBe(0);
    onError.flushTimers();
    expect(onError.reloads()).toBe(0);

    const missingTokenLive = element({}, "live-status");
    const missingToken = execute({
      token: null,
      url: "http://127.0.0.1:7420/",
      elementsById: { "live-status": missingTokenLive }
    });
    expect(missingToken.sources).toHaveLength(0);
    expect(missingTokenLive.textContent).toBe("live updates disconnected");
  });

  test("keeps zoom pan and keyboard transforms transient", () => {
    const viewport = element();
    const svg = element({}, "topology-svg");
    const zoomIn = element({ "data-topology-action": "zoom-in" });
    const fit = element({ "data-topology-action": "fit" });
    const harness = execute({
      selectors: {
        "[data-topology-viewport]": [viewport],
        ".topology-svg": [svg],
        "[data-topology-action]": [zoomIn, fit]
      }
    });
    const originalUrl = harness.window.location.href;

    zoomIn.dispatch("click");
    expect(viewport.getAttribute("transform")).toBe("translate(0 0) scale(1.20)");
    svg.dispatch("pointerdown", { clientX: 10, clientY: 20, pointerId: 1 });
    svg.dispatch("pointermove", { clientX: 35, clientY: 55, pointerId: 1 });
    svg.dispatch("pointerup", {});
    expect(viewport.getAttribute("transform")).toBe("translate(25 35) scale(1.20)");

    fit.dispatch("click");
    expect(viewport.getAttribute("transform")).toBe("translate(0 0) scale(1.00)");
    harness.window.dispatch("keydown", { key: "+", target: { tagName: "INPUT" } });
    expect(viewport.getAttribute("transform")).toBe("translate(0 0) scale(1.00)");
    harness.window.dispatch("keydown", { key: "+", target: { tagName: "BODY" } });
    expect(viewport.getAttribute("transform")).toBe("translate(0 0) scale(1.20)");
    expect(harness.window.location.href).toBe(originalUrl);
    expect(harness.reloads()).toBe(0);
  });
});

type Listener = (event: any) => void;

class FakeElement {
  readonly listeners = new Map<string, Listener[]>();
  readonly attributes = new Map<string, string>();
  hidden = false;
  value = "";
  textContent = "";
  tagName = "BUTTON";
  isContentEditable = false;

  constructor(attributes: Record<string, string> = {}, readonly id?: string) {
    for (const [key, value] of Object.entries(attributes)) this.attributes.set(key, value);
  }

  addEventListener(name: string, listener: Listener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  dispatch(name: string, event: Record<string, unknown> = {}): void {
    const payload = { preventDefault() {}, target: this, ...event };
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)); }
  setPointerCapture(_pointerId: number): void {}
}

class FakeEventSource {
  closed = false;
  ready: Promise<void>;
  private readyResolve!: () => void;
  private waiting?: (value: ReadableStreamReadResult<Uint8Array>) => void;
  private delivered?: () => void;
  constructor(readonly url: string, readonly headers: unknown) {
    this.ready = new Promise((resolve) => { this.readyResolve = resolve; });
  }
  read(): Promise<ReadableStreamReadResult<Uint8Array>> {
    this.readyResolve();
    this.delivered?.();
    this.delivered = undefined;
    return new Promise((resolve) => { this.waiting = resolve; });
  }
  async emit(name: string, event: Record<string, unknown>): Promise<void> {
    await this.ready;
    const delivered = new Promise<void>((resolve) => { this.delivered = resolve; });
    if(name === "error") this.waiting?.({ done: true, value: undefined });
    else this.waiting?.({ done: false, value: new TextEncoder().encode(`event: ${name}\ndata: ${event.data ?? ""}\n\n`) });
    await delivered;
  }
  close(): void {
    this.closed = true;
    this.delivered?.();
    this.delivered = undefined;
    this.waiting?.({ done: true, value: undefined });
  }
}

function element(attributes: Record<string, string> = {}, id?: string): FakeElement {
  return new FakeElement(attributes, id);
}

function execute(options: {
  url?: string;
  token?: string | null;
  selectors?: Record<string, FakeElement[]>;
  elementsById?: Record<string, FakeElement>;
} = {}) {
  const html = renderExplorerHtml(projection);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Explorer runtime script missing");
  const selectors = options.selectors ?? {};
  const elementsById = options.elementsById ?? {};
  const document = {
    querySelectorAll(selector: string): FakeElement[] { return selectors[selector] ?? []; },
    getElementById(id: string): FakeElement | null { return elementsById[id] ?? null; }
  };
  const sources: FakeEventSource[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let reloadCount = 0;
  const windowListeners = new Map<string, Listener[]>();
  const location = {
    href: options.url ?? "http://127.0.0.1:7420/?maxNodes=80&maxRelations=160",
    reload() { reloadCount += 1; }
  };
  const window = {
    location,
    sessionStorage: {
      getItem: () => options.token === null ? null : options.token ?? "secret",
      removeItem() {}
    },
    async fetch(url: string, options: RequestInit) {
      const source = new FakeEventSource(url, options.headers);
      expect(options.credentials).toBe("omit");
      expect(options.redirect).toBe("error");
      sources.push(source);
      options.signal!.addEventListener("abort", () => source.close());
      return { ok: true, status: 200, body: { getReader: () => ({ read: () => source.read(), cancel: () => source.close() }) } };
    },
    setTimeout(callback: () => void, _delay: number): number {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id: number): void { timers.delete(id); },
    addEventListener(name: string, listener: Listener): void {
      const listeners = windowListeners.get(name) ?? [];
      listeners.push(listener);
      windowListeners.set(name, listeners);
    },
    dispatch(name: string, event: Record<string, unknown>): void {
      const payload = { preventDefault() {}, ...event };
      for (const listener of windowListeners.get(name) ?? []) listener(payload);
    }
  };
  new Function("window", "document", "URL", script)(window, document, URL);
  return {
    window,
    sources,
    reloads: () => reloadCount,
    pendingTimers: () => timers.size,
    flushTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    }
  };
}
