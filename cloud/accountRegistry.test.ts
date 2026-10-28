import { describe, expect, it } from "vitest";
import { AccountRegistry, type SavedCredential, type AccountStore } from "./accountRegistry";

function memoryStore() {
  const records = new Map<string, SavedCredential>();
  const store: AccountStore = {
    load: () => structuredClone([...records.values()]),
    save: (record) => {
      records.set(record.credentialId, structuredClone(record));
    },
  };
  return { store, records };
}

function network() {
  const requests: { session: string; url: string }[] = [];
  const signals: AbortSignal[] = [];
  const pending: { started?: () => void; resume?: Promise<void> } = {};
  let fail = false;
  const fetcher = (async (input, init) => {
    const url = String(input);
    if (init?.signal) signals.push(init.signal);
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    const key = cookie.includes("Sso=b") ? "b" : "a";
    requests.push({ session: key, url });
    if (cookie.includes("Sso=bad")) return new Response(null, { status: 401 });
    if (fail) throw new Error(`private upstream failure ${cookie}`);
    if (pending.resume) {
      pending.started?.();
      await pending.resume;
    }
    if (url.includes("auth-rp")) return Response.json({ accountId: `ACC-${key}` });
    if (url.includes("service-lines?"))
      return Response.json({
        content: {
          results: [{ accountReferenceId: `ACC-${key}`, serviceLineNumber: `SL-${key}` }],
        },
      });
    if (url.includes("/webagg/"))
      return Response.json({
        content: {
          serviceLineNumber: `SL-${key}`,
          userTerminals: [{ userTerminalId: `dish-${key}` }],
        },
      });
    return Response.json({ usage: key });
  }) as typeof fetch;
  return {
    fetcher,
    requests,
    signals,
    pending,
    fail: () => {
      fail = true;
    },
  };
}
const target = (credentialId: string, key: string) => ({
  credentialId,
  accountId: `ACC-${key}`,
  serviceLineNumber: `SL-${key}`,
  terminalId: `dish-${key}`,
});

describe("isolated saved logins", () => {
  it("retains two independent logins across restart without exposing secrets", async () => {
    const { store, records } = memoryStore();
    const net = network();
    let registry = new AccountRegistry({ store, fetch: net.fetcher });
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=a",
    });
    await registry.importSession({
      credentialId: "login-b",
      label: "Second",
      cookie: "Starlink.Com.Sso=b",
    });
    registry = new AccountRegistry({ store, fetch: net.fetcher });
    expect(registry.list().sessions.map((s) => s.label)).toEqual(["First", "Second"]);
    expect(JSON.stringify(registry.list())).not.toContain("Sso");
    expect(records.size).toBe(2);
    expect((await registry.read("login-b", "/cloud/usage", target("login-b", "b"))).body).toEqual({
      usage: "b",
    });
    registry.disconnect("login-a");
    expect(registry.list().sessions.map((s) => s.state)).toEqual(["disconnected", "connected"]);
    expect((await registry.read("login-b", "/cloud/usage", target("login-b", "b"))).status).toBe(
      200,
    );
  });
  it("does not overwrite a working session when an imported replacement is refused", async () => {
    const { store } = memoryStore();
    const net = network();
    const registry = new AccountRegistry({ store, fetch: net.fetcher });
    await registry.importSession({
      credentialId: "login-a",
      label: "Original",
      cookie: "Starlink.Com.Sso=a",
    });
    expect(
      (
        await registry.importSession({
          credentialId: "login-a",
          label: "Bad",
          cookie: "Starlink.Com.Sso=bad",
        })
      ).status,
    ).toBe(428);
    expect(registry.list().sessions[0].label).toBe("Original");
    expect((await registry.read("login-a", "/cloud/usage", target("login-a", "a"))).status).toBe(
      200,
    );
  });
  it("rejects cross-credential and arbitrary-host targets before issuing a request", async () => {
    const { store } = memoryStore();
    const net = network();
    const registry = new AccountRegistry({ store, fetch: net.fetcher });
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=a",
    });
    net.requests.length = 0;
    expect((await registry.read("login-a", "/cloud/usage", target("login-b", "a"))).status).toBe(
      403,
    );
    expect(
      (await registry.read("login-a", "https://other.invalid", target("login-a", "a"))).status,
    ).toBe(400);
    expect(net.requests).toEqual([]);
  });
  it("suppresses an in-flight read after disconnect and retains inventory for offline display", async () => {
    const { store } = memoryStore();
    const net = network();
    const registry = new AccountRegistry({ store, fetch: net.fetcher });
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=a",
    });
    let release!: () => void;
    net.pending.resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      net.pending.started = resolve;
    });
    const reading = registry.read("login-a", "/cloud/usage", target("login-a", "a"));
    await started;
    const signal = net.signals.at(-1)!;
    registry.disconnect("login-a");
    expect(signal.aborted).toBe(true);
    release();
    expect((await reading).status).toBe(409);
    expect(registry.list().sessions[0].inventory.accounts).toEqual([{ accountId: "ACC-a" }]);
  });
  it("does not resurrect a disconnected login when a pending replacement finishes", async () => {
    const { store } = memoryStore();
    const net = network();
    const registry = new AccountRegistry({ store, fetch: net.fetcher });
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=a",
    });
    let release!: () => void;
    net.pending.resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      net.pending.started = resolve;
    });
    const replacing = registry.importSession({
      credentialId: "login-a",
      label: "Replacement",
      cookie: "Starlink.Com.Sso=b",
    });
    await started;
    registry.disconnect("login-a");
    release();
    expect((await replacing).status).toBe(409);
    expect(registry.list().sessions[0].state).toBe("disconnected");
  });
  it("does not erase cached data or leak upstream secrets on a transport failure", async () => {
    const { store } = memoryStore();
    const net = network();
    const registry = new AccountRegistry({ store, fetch: net.fetcher });
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=a",
    });
    net.fail();
    const result = await registry.refreshInventory("login-a");
    expect(result.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain("Sso");
    expect(registry.list().sessions[0].inventory.services).toHaveLength(1);
  });
  it("stops tracking without signing out and refuses unknown or unsafe storage IDs", async () => {
    const { store } = memoryStore();
    const net = network();
    const registry = new AccountRegistry({ store, fetch: net.fetcher });
    expect(
      (
        await registry.importSession({
          credentialId: "../escape",
          label: "Bad",
          cookie: "Starlink.Com.Sso=a",
        })
      ).status,
    ).toBe(400);
    expect((await registry.read("missing", "/cloud/usage", target("missing", "a"))).status).toBe(
      404,
    );
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=a",
    });
    registry.setTracking("login-a", false);
    expect(registry.list().sessions[0]).toMatchObject({ state: "connected", tracking: false });
  });
});
