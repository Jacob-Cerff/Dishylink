import { describe, expect, it, vi } from "vitest";
import { RemoteRefresh } from "./remoteRefresh";
import type { CredentialSummary } from "./accountRegistry";
import type { RemoteAccountRecord } from "../electron/remoteSnapshotStore";
import { HOUR_MS } from "../core/remoteTelemetry";
import type { CloudResult } from "./starlinkCloudHandler";

function setup(count = 2, sharedCredential = false) {
  let now = 1000;
  const records = new Map<string, RemoteAccountRecord>();
  const credentialBackoffs = new Map<string, number>();
  const tokens = new Map<string, object>();
  const identities = new Map<string, object>();
  const sessions: CredentialSummary[] = [];
  for (let i = 0; i < count; i++) {
    const credentialId = sharedCredential ? "login" : `login${i}`;
    let session = sessions.find((s) => s.credentialId === credentialId);
    if (!session) {
      session = {
        credentialId,
        label: credentialId,
        tracking: true,
        state: "connected",
        inventory: { accounts: [], services: [] },
      };
      sessions.push(session);
      tokens.set(credentialId, {});
      identities.set(credentialId, {});
    }
    session.inventory.accounts.push({ accountId: `A${i}` });
    session.inventory.services.push({
      accountId: `A${i}`,
      serviceLineNumber: `S${i}`,
      terminals: [{ terminalId: "dish", routerIds: [] }],
    });
  }
  const calls: string[] = [];
  let collect: (id: string, account: string) => Promise<CloudResult> = async () => ({
    status: 200,
    body: { devices: {}, incomplete: false },
  });
  const store = {
    get: (accountId: string, credentialId: string): RemoteAccountRecord =>
      structuredClone(
        records.get(accountId) ?? {
          version: 1,
          accountId,
          state: { accountId, credentialId, intervalHours: 2, nextDueAt: 0, retryCount: 0 },
          snapshots: [],
          attempts: [],
          expectations: {},
        },
      ),
    save: (record: RemoteAccountRecord) => {
      records.set(record.accountId, structuredClone(record));
    },
    prune: () => {},
    credentialBackoff: (id: string) => credentialBackoffs.get(id) ?? 0,
    saveCredentialBackoff: (id: string, until: number) => {
      credentialBackoffs.set(id, Math.max(credentialBackoffs.get(id) ?? 0, until));
    },
  };
  const registry = {
    list: () => ({ sessions: structuredClone(sessions) }),
    sessionToken: (id: string) => tokens.get(id),
    sessionIdentity: (id: string) => identities.get(id),
    refreshInventory: vi.fn(async () => ({ status: 200, body: {} })),
    collectAccount: async (id: string, account: string) => {
      calls.push(account);
      return collect(id, account);
    },
  };
  const engine = new RemoteRefresh({ registry, store, now: () => now, random: () => 0 });
  return {
    engine,
    store,
    registry,
    sessions,
    tokens,
    identities,
    calls,
    records,
    advance: (ms: number) => {
      now += ms;
    },
    collect: (callback: typeof collect) => {
      collect = callback;
    },
    context: (index = 0) => ({
      credentialId: sharedCredential ? "login" : `login${index}`,
      accountId: `A${index}`,
      serviceLineNumber: `S${index}`,
      terminalId: "dish",
    }),
  };
}

describe("account background refresh", () => {
  it("refreshes nine accounts once each every two hours with no renderer", async () => {
    const { engine, calls, advance, records } = setup(9);
    engine.tick();
    await engine.idle();
    expect(calls).toHaveLength(9);
    expect(records.get("A0")?.snapshots[0].status).toBe("offline");
    advance(2 * HOUR_MS - 1);
    engine.tick();
    await engine.idle();
    expect(calls).toHaveLength(9);
    advance(1);
    engine.tick();
    await engine.idle();
    expect(calls).toHaveLength(18);
  });
  it("limits global concurrency to two and serializes accounts sharing a credential", async () => {
    const { engine, collect, calls } = setup(4);
    const release: (() => void)[] = [];
    collect(async () => {
      await new Promise<void>((r) => release.push(r));
      return { status: 200, body: { devices: {}, incomplete: false } };
    });
    engine.tick();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    release.splice(0).forEach((r) => r());
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    release.splice(0).forEach((r) => r());
    await engine.idle();
    const shared = setup(3, true);
    let active = 0;
    let max = 0;
    shared.collect(async () => {
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      return { status: 200, body: { devices: {}, incomplete: false } };
    });
    shared.engine.tick();
    await shared.engine.idle();
    expect(max).toBe(1);
    expect(shared.registry.refreshInventory).toHaveBeenCalledTimes(1);
  });
  it("shares manual and automatic work and enforces cooldown after completion", async () => {
    const { engine, calls, context, advance } = setup(1);
    engine.tick();
    const manual = engine.manual("login0", "A0");
    await engine.idle();
    expect((await manual).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect((await engine.manual("login0", "A0")).status).toBe(429);
    expect(engine.cached(context()).status).toBe(200);
    advance(300_000);
    expect((await engine.manual("login0", "A0")).status).toBe(200);
    expect(calls).toHaveLength(2);
  });
  it("honors Retry-After for manual and automatic requests while other accounts succeed", async () => {
    const { engine, collect, advance, calls, records } = setup();
    collect(async (_id, account) =>
      account === "A0"
        ? { status: 429, body: { retryAfterMs: 6 * HOUR_MS } }
        : { status: 200, body: { devices: {}, incomplete: false } },
    );
    engine.tick();
    await engine.idle();
    expect(records.get("A1")?.state.lastSuccessAt).toBeDefined();
    expect((await engine.manual("login0", "A0")).status).toBe(429);
    advance(2 * HOUR_MS);
    engine.tick();
    await engine.idle();
    expect(calls.filter((a) => a === "A0")).toHaveLength(1);
  });
  it("bounds transient retries to three attempts then waits for the regular interval", async () => {
    const { engine, collect, advance, calls } = setup(1);
    collect(async () => ({ status: 502, body: {} }));
    for (const delta of [0, 30_000, 60_000, 120_000]) {
      advance(delta);
      engine.tick();
      await engine.idle();
    }
    expect(calls).toHaveLength(3);
  });
  it("drops late replies after reconnect, stop tracking or terminal removal", async () => {
    for (const mode of ["reconnect", "tracking", "terminal"] as const) {
      const fixture = setup(1);
      let release!: () => void;
      fixture.collect(async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { status: 200, body: { devices: {}, incomplete: false } };
      });
      fixture.engine.tick();
      await vi.waitFor(() => expect(fixture.calls).toHaveLength(1));
      if (mode === "reconnect") fixture.tokens.set("login0", {});
      if (mode === "tracking") fixture.sessions[0].tracking = false;
      if (mode === "terminal") fixture.sessions[0].inventory.services = [];
      release();
      await fixture.engine.idle();
      expect(fixture.records.get("A0")?.snapshots).toHaveLength(0);
    }
  });
  it("does one catch-up after sleep, persists scheduling and preserves cache when a refresh fails", async () => {
    const fixture = setup(1);
    fixture.engine.tick();
    await fixture.engine.idle();
    fixture.advance(24 * HOUR_MS);
    fixture.engine.wake();
    await fixture.engine.idle();
    expect(fixture.calls).toHaveLength(2);
    fixture.engine.tick();
    await fixture.engine.idle();
    expect(fixture.calls).toHaveLength(2);
    fixture.collect(async () => ({ status: 502, body: {} }));
    fixture.advance(2 * HOUR_MS);
    fixture.engine.tick();
    await fixture.engine.idle();
    const cached = fixture.engine.cached(fixture.context());
    expect(cached.body).toMatchObject({
      snapshot: { status: "offline" },
      refresh: { error: "network" },
    });
    const restarted = new RemoteRefresh({
      registry: fixture.registry,
      store: fixture.store,
      now: () => 1000 + 26 * HOUR_MS,
      random: () => 0,
    });
    restarted.tick();
    await restarted.idle();
    expect(fixture.calls).toHaveLength(3);
  });
  it("isolates expired sessions and restarts a reconnected credential without waiting two hours", async () => {
    const fixture = setup();
    fixture.collect(async (_id, account) => {
      if (account === "A0") {
        fixture.sessions[0].state = "reconnect-required";
        return { status: 428, body: {} };
      }
      return { status: 200, body: { devices: {}, incomplete: false } };
    });
    fixture.engine.tick();
    await fixture.engine.idle();
    expect(fixture.records.get("A0")?.state.error).toBe("auth");
    expect(fixture.records.get("A1")?.state.lastSuccessAt).toBeDefined();
    fixture.sessions[0].state = "connected";
    fixture.tokens.set("login0", {});
    fixture.collect(async () => ({ status: 200, body: { devices: {}, incomplete: false } }));
    fixture.engine.tick();
    await fixture.engine.idle();
    expect(fixture.calls.filter((a) => a === "A0")).toHaveLength(2);
  });
  it("validates metadata/configuration without remote writes or stopping sampling", async () => {
    const f = setup(1);
    expect(f.engine.expectOffline(f.context(), true, "Holiday").status).toBe(200);
    expect(f.engine.configure("login0", "A0", 4).status).toBe(200);
    expect(f.engine.configure("login0", "A0", 0).status).toBe(400);
    expect(f.engine.expectOffline({ ...f.context(), accountId: "wrong" }, true).status).toBe(403);
    expect(f.engine.cached({ ...f.context(), terminalId: "wrong" }).status).toBe(403);
    f.engine.tick();
    await f.engine.idle();
    expect(f.calls).toHaveLength(1);
    expect(f.engine.cached(f.context()).body).toMatchObject({
      expectation: { enabled: true, reason: "Holiday" },
    });
  });
  it("deduplicates accounts exposed by multiple logins", async () => {
    const f = setup();
    f.sessions[1].inventory = structuredClone(f.sessions[0].inventory);
    f.engine.tick();
    await f.engine.idle();
    expect(f.calls).toEqual(["A0"]);
  });
  it("preserves server backoff across tracking changes and reconnect tokens", async () => {
    const f = setup(1);
    f.collect(async () => ({ status: 429, body: { retryAfterMs: 6 * HOUR_MS } }));
    f.engine.tick();
    await f.engine.idle();
    f.tokens.set("login0", {});
    f.advance(1000);
    f.engine.tick();
    await f.engine.idle();
    expect(f.calls).toHaveLength(1);
    expect((await f.engine.manual("login0", "A0")).status).toBe(429);
  });
  it("preserves due time and failed-cycle budget across real tracking stop/start lease changes", async () => {
    const f = setup(1);
    f.engine.tick();
    await f.engine.idle();
    const due = f.records.get("A0")!.state.nextDueAt;
    f.tokens.set("login0", {});
    f.advance(60_000);
    f.engine.tick();
    await f.engine.idle();
    expect(f.calls).toHaveLength(1);
    expect(f.records.get("A0")!.state.nextDueAt).toBe(due);
    f.collect(async () => ({ status: 502, body: {} }));
    f.advance(2 * HOUR_MS);
    f.engine.tick();
    await f.engine.idle();
    const retries = f.records.get("A0")!.state.retryCount;
    f.tokens.set("login0", {});
    f.engine.tick();
    await f.engine.idle();
    expect(f.records.get("A0")!.state.retryCount).toBe(retries);
  });
  it("keeps expected-offline context when the same terminal moves to another service", () => {
    const f = setup(1);
    f.engine.expectOffline(f.context(), true, "Holiday");
    f.sessions[0].inventory.services[0].serviceLineNumber = "new-service";
    expect(
      f.engine.cached({ ...f.context(), serviceLineNumber: "new-service" }).body,
    ).toMatchObject({ expectation: { enabled: true, reason: "Holiday" } });
  });
  it("persists shared inventory/auth backoff before draining another account on the same login", async () => {
    const f = setup(2, true);
    f.registry.refreshInventory.mockResolvedValue({
      status: 429,
      body: { retryAfterMs: 6 * HOUR_MS },
    });
    f.engine.tick();
    await f.engine.idle();
    expect(f.registry.refreshInventory).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(0);
    const restarted = new RemoteRefresh({
      registry: f.registry,
      store: f.store,
      now: () => 60_000,
      random: () => 0,
    });
    restarted.tick();
    await restarted.idle();
    expect(f.registry.refreshInventory).toHaveBeenCalledTimes(1);
    expect((await restarted.manual("login", "A1")).status).toBe(429);
  });
  it("does not reset a completed failed-cycle budget by resubmitting or toggling refresh settings", async () => {
    const f = setup(1);
    f.engine.tick();
    await f.engine.idle();
    f.collect(async () => ({ status: 502, body: {} }));
    for (const delta of [2 * HOUR_MS, 30_000, 60_000]) {
      f.advance(delta);
      f.engine.tick();
      await f.engine.idle();
    }
    const due = f.records.get("A0")!.state.nextDueAt;
    f.engine.configure("login0", "A0", 2);
    expect(f.records.get("A0")!.state.nextDueAt).toBe(due);
    f.engine.configure("login0", "A0", 4);
    f.engine.configure("login0", "A0", 2);
    f.advance(120_000);
    f.engine.tick();
    await f.engine.idle();
    expect(f.calls).toHaveLength(4); // One success, then the three allowed attempts.
  });
  it("keeps the due time when changing the preferred credential for a shared account", async () => {
    const f = setup();
    f.sessions[1].inventory = structuredClone(f.sessions[0].inventory);
    f.engine.tick();
    await f.engine.idle();
    const other = f.records.get("A0")!.state.credentialId === "login0" ? "login1" : "login0";
    f.engine.configure(other, "A0", 2);
    f.engine.tick();
    await f.engine.idle();
    expect(f.calls).toHaveLength(1);
  });
});
