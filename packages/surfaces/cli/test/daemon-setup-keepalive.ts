interface SetupClient {
  runtimeStatus(): Promise<{ ok: boolean }>;
}

/** Test-fixture preparation only: acquire once, then keep that client alive until drained. */
export function createDaemonSetupKeepalive<Connection, Client extends SetupClient>(options: {
  readConnection: () => Connection;
  createClient: (connection: Connection) => Client;
  timeoutMs: number;
  platform?: NodeJS.Platform;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  const platform = options.platform ?? process.platform;
  let client: Client | undefined;
  let inFlight: Promise<void> | undefined;
  let failure: unknown;
  let lastReadError: unknown;
  let stopped = false;

  async function poll(): Promise<void> {
    if (stopped || failure || inFlight) return;
    if (!client) {
      if (now() >= deadline) {
        failure = lastReadError ?? new Error("daemon setup connection publication timed out");
        return;
      }
      let connection: Connection;
      try {
        connection = options.readConnection();
      } catch (error) {
        lastReadError = error;
        const code = (error as NodeJS.ErrnoException).code;
        // Windows private creation uses FileShare.None: an existing path is not yet readable.
        // A persistent sharing/permission error still becomes terminal at the same deadline.
        const sharing = platform === "win32" && ["EBUSY", "EPERM", "EACCES"].includes(code ?? "");
        if (!(error instanceof SyntaxError || code === "ENOENT" || sharing)) failure = error;
        return;
      }
      try {
        client = options.createClient(connection);
      } catch (error) {
        failure = error;
        return;
      }
    }
    // RPC errors belong to this pinned client. They never re-enter connection acquisition.
    inFlight = Promise.resolve().then(() => client!.runtimeStatus()).then((status) => {
      if (!status.ok) throw new Error("daemon setup keepalive failed");
    }).catch((error) => { failure = error; }).finally(() => { inFlight = undefined; });
    await inFlight;
  }

  async function finish(): Promise<Client> {
    stopped = true;
    await inFlight;
    if (failure) throw failure;
    if (!client) throw lastReadError ?? new Error("daemon never published its setup connection");
    return client;
  }

  return { poll, finish };
}
