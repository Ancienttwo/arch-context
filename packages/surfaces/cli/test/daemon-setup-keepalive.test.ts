import { expect, test } from "bun:test";
import { createDaemonSetupKeepalive } from "./daemon-setup-keepalive";

function sharingError(code: string) {
  return Object.assign(new Error(`fixture ${code}`), { code });
}

for (const code of ["EBUSY", "EPERM", "EACCES"]) {
  test(`daemon setup retries transient Windows ${code} before pinning its first client`, async () => {
    let reads = 0;
    let rpcCalls = 0;
    let now = 0;
    const first = { pid: 322, runtimeStatus: async () => { rpcCalls += 1; return { ok: true }; } };
    const setup = createDaemonSetupKeepalive({
      platform: "win32", timeoutMs: 100, now: () => now,
      readConnection: () => { if (++reads < 3) throw sharingError(code); return { pid: first.pid }; },
      createClient: (connection) => { expect(connection.pid).toBe(first.pid); return first; }
    });
    await setup.poll();
    now = 25;
    await setup.poll();
    expect(rpcCalls).toBe(0);
    now = 50;
    await setup.poll();
    now = 1_000; // Acquisition's deadline no longer applies once the original client is pinned.
    await setup.poll();
    expect(await setup.finish()).toBe(first);
    expect(reads).toBe(3);
    expect(rpcCalls).toBe(2);
  });

  test(`daemon setup fails permanent Windows ${code} at its acquisition deadline`, async () => {
    let reads = 0;
    let clients = 0;
    let now = 0;
    const error = sharingError(code);
    const setup = createDaemonSetupKeepalive({
      platform: "win32", timeoutMs: 100, now: () => now,
      readConnection: () => { reads += 1; throw error; },
      createClient: () => { clients += 1; return { runtimeStatus: async () => ({ ok: true }) }; }
    });
    await setup.poll();
    now = 99;
    await setup.poll();
    expect(reads).toBe(2);
    now = 100;
    await setup.poll();
    now = 101;
    await setup.poll();
    expect(reads).toBe(2);
    expect(clients).toBe(0);
    await expect(setup.finish()).rejects.toBe(error);
  });
}

test("daemon setup retains ENOENT and incomplete JSON publication retries", async () => {
  let reads = 0;
  const first = { runtimeStatus: async () => ({ ok: true }) };
  const setup = createDaemonSetupKeepalive({
    timeoutMs: 100,
    readConnection: () => { if (++reads === 1) throw sharingError("ENOENT"); if (reads === 2) throw new SyntaxError("fixture incomplete JSON"); return { pid: 322 }; },
    createClient: () => first
  });
  await setup.poll();
  await setup.poll();
  await setup.poll();
  expect(await setup.finish()).toBe(first);
  expect(reads).toBe(3);
});

test("daemon setup fails an unrelated read error immediately", async () => {
  let reads = 0;
  const error = sharingError("EINVAL");
  const setup = createDaemonSetupKeepalive({
    platform: "win32", timeoutMs: 100,
    readConnection: () => { reads += 1; throw error; },
    createClient: () => ({ runtimeStatus: async () => ({ ok: true }) })
  });
  await setup.poll();
  await setup.poll();
  expect(reads).toBe(1);
  await expect(setup.finish()).rejects.toBe(error);
});

test("daemon setup does not hide non-Windows permission failures", async () => {
  let reads = 0;
  const error = sharingError("EACCES");
  const setup = createDaemonSetupKeepalive({
    platform: "linux", timeoutMs: 100,
    readConnection: () => { reads += 1; throw error; },
    createClient: () => ({ runtimeStatus: async () => ({ ok: true }) })
  });
  await setup.poll();
  await setup.poll();
  expect(reads).toBe(1);
  await expect(setup.finish()).rejects.toBe(error);
});

test("daemon setup does not retry client construction after acquiring a connection", async () => {
  let reads = 0;
  let clients = 0;
  const error = sharingError("EBUSY");
  const setup = createDaemonSetupKeepalive({
    platform: "win32", timeoutMs: 100,
    readConnection: () => { reads += 1; return { pid: 322 }; },
    createClient: () => { clients += 1; throw error; }
  });
  await setup.poll();
  await setup.poll();
  expect(reads).toBe(1);
  expect(clients).toBe(1);
  await expect(setup.finish()).rejects.toBe(error);
});

test("daemon setup never rediscovers or retries a pinned client's sharing-shaped RPC error", async () => {
  let reads = 0;
  let clients = 0;
  let rpcCalls = 0;
  const error = sharingError("EBUSY");
  const setup = createDaemonSetupKeepalive({
    platform: "win32", timeoutMs: 100,
    readConnection: () => { reads += 1; return { pid: 322 }; },
    createClient: () => { clients += 1; return { runtimeStatus: async () => { rpcCalls += 1; throw error; } }; }
  });
  await setup.poll();
  await setup.poll();
  expect(reads).toBe(1);
  expect(clients).toBe(1);
  expect(rpcCalls).toBe(1);
  await expect(setup.finish()).rejects.toBe(error);
});

test("daemon setup keeps an unsuccessful pinned RPC envelope terminal", async () => {
  let reads = 0;
  let calls = 0;
  const setup = createDaemonSetupKeepalive({
    timeoutMs: 100,
    readConnection: () => { reads += 1; return { pid: 322 }; },
    createClient: () => ({ runtimeStatus: async () => { calls += 1; return { ok: false }; } })
  });
  await setup.poll();
  await setup.poll();
  expect(reads).toBe(1);
  expect(calls).toBe(1);
  await expect(setup.finish()).rejects.toThrow("daemon setup keepalive failed");
});

test("daemon setup stops polling and drains the accepted RPC before returning its client", async () => {
  let calls = 0;
  let resolveStatus!: (value: { ok: boolean }) => void;
  const first = { runtimeStatus: () => { calls += 1; return new Promise<{ ok: boolean }>((resolve) => { resolveStatus = resolve; }); } };
  const setup = createDaemonSetupKeepalive({ timeoutMs: 100, readConnection: () => ({ pid: 322 }), createClient: () => first });
  const polling = setup.poll();
  await Promise.resolve();
  await setup.poll();
  expect(calls).toBe(1); // A timer tick cannot overlap the still accepted request.
  let finished = false;
  const finishing = setup.finish().then((client) => { finished = true; return client; });
  await setup.poll();
  expect(finished).toBe(false);
  expect(calls).toBe(1);
  resolveStatus({ ok: true });
  await polling;
  expect(await finishing).toBe(first);
  expect(finished).toBe(true);
  await setup.poll();
  expect(calls).toBe(1);
});
