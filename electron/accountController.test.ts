import { describe, expect, it } from "vitest";
import { AccountRegistry, type SavedCredential } from "../cloud/accountRegistry";
import { AccountController, trustedAccountFrame } from "./accountController";
import type { CloudResult } from "../cloud/starlinkCloudHandler";

function setup() {
  const records = new Map<string, SavedCredential>();
  const registry = new AccountRegistry({
    store: {
      load: () => [...records.values()],
      save: (r) => {
        records.set(r.credentialId, r);
      },
    },
    fetch: (async (input) =>
      String(input).includes("auth-rp")
        ? Response.json({ accountId: "ACC-A" })
        : Response.json({ content: { results: [] } })) as typeof fetch,
  });
  const partitions: string[] = [];
  const cleared: string[] = [];
  const controller = new AccountController({
    registry,
    login: async (partition, adopt) => {
      partitions.push(partition);
      return adopt("Starlink.Com.Sso=test");
    },
    clearPartition: async (partition) => {
      cleared.push(partition);
    },
  });
  return { registry, controller, partitions, cleared, records };
}

describe("desktop account operation boundary", () => {
  it("gives every new sign-in its own partition and reconnects only the named sign-in", async () => {
    const { controller, registry, partitions, cleared } = setup();
    const first = await controller.handle({ kind: "sign-in", label: "First" });
    const id = (first.body as { credentialId: string }).credentialId;
    await controller.handle({ kind: "sign-in", label: "Second" });
    await controller.handle({ kind: "sign-in", credentialId: id });
    expect(partitions[0]).toBe(`persist:starlink-login-${id}`);
    expect(partitions[0]).not.toBe(partitions[1]);
    expect(partitions[2]).toBe(partitions[0]);
    await controller.handle({ kind: "disconnect", credentialId: id });
    expect(cleared).toEqual([partitions[0], partitions[1], partitions[0], partitions[0]]);
    expect(registry.list().sessions.map((s) => s.state)).toEqual(["disconnected", "connected"]);
    expect(JSON.stringify((await controller.handle({ kind: "list" })).body)).not.toContain("Sso");
  });
  it.each([
    null,
    [],
    {},
    { kind: "delete-history" },
    { kind: "read", credentialId: "../bad" },
    { kind: "import", label: "Test", cookie: 12 },
  ])("rejects malformed/unsupported operations %j", async (request) => {
    const { controller, partitions } = setup();
    expect((await controller.handle(request)).status).toBe(400);
    expect(partitions).toEqual([]);
  });
  it("shares simultaneous reconnect requests instead of opening two login windows", async () => {
    const { registry } = setup();
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=test",
    });
    let release!: (result: CloudResult) => void;
    let calls = 0;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const controller = new AccountController({
      registry,
      clearPartition: async () => {},
      login: async () => {
        calls++;
        notifyStarted();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const one = controller.handle({ kind: "sign-in", credentialId: "login-a" });
    const two = controller.handle({ kind: "sign-in", credentialId: "login-a" });
    await started;
    expect(calls).toBe(1);
    release({ status: 499, body: { error: "cancelled" } });
    expect((await one).status).toBe(499);
    expect((await two).status).toBe(499);
  });
  it("rejects unknown reconnects and stops tracking independently of authentication", async () => {
    const { controller, registry } = setup();
    expect((await controller.handle({ kind: "sign-in", credentialId: "missing" })).status).toBe(
      404,
    );
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=test",
    });
    await controller.handle({ kind: "tracking", credentialId: "login-a", enabled: false });
    expect(registry.list().sessions[0]).toMatchObject({ tracking: false, state: "connected" });
  });

  it("lets a cookie import replace a cancelled reconnect without the old window invalidating it", async () => {
    const { registry } = setup();
    await registry.importSession({
      credentialId: "login-a",
      label: "First",
      cookie: "Starlink.Com.Sso=test",
    });
    const controller = new AccountController({
      registry,
      clearPartition: async () => {},
      login: async (_partition, _adopt, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ status: 499, body: {} }), {
            once: true,
          });
        }),
    });
    const reconnecting = controller.handle({ kind: "sign-in", credentialId: "login-a" });
    const imported = await controller.handle({
      kind: "import",
      credentialId: "login-a",
      label: "Imported",
      cookie: "Starlink.Com.Sso=replacement",
    });
    expect((await reconnecting).status).toBe(499);
    expect(imported.status).toBe(200);
    expect(registry.list().sessions[0].label).toBe("Imported");
  });

  it("does not silently restore the previous browser login after importing a different session", async () => {
    const { registry, records } = setup();
    await registry.importSession({
      credentialId: "login-a",
      label: "A",
      cookie: "Starlink.Com.Sso=a",
    });
    let nativeCookie: string | null = "Starlink.Com.Sso=a";
    const controller = new AccountController({
      registry,
      clearPartition: async () => {
        nativeCookie = null;
      },
      login: async (_partition, adopt) => adopt(nativeCookie ?? "Starlink.Com.Sso=b"),
    });
    await controller.handle({
      kind: "import",
      credentialId: "login-a",
      label: "B",
      cookie: "Starlink.Com.Sso=b",
    });
    expect((await controller.handle({ kind: "sign-in", credentialId: "login-a" })).status).toBe(
      200,
    );
    expect(records.get("login-a")?.cookie).toBe("Starlink.Com.Sso=b");
  });
});

describe("account IPC sender validation", () => {
  it.each([
    ["http://localhost:5173/", "http://localhost:5173/", true, true, true],
    ["http://localhost:5174/", "http://localhost:5173/", true, true, false],
    ["https://starlink.com/account", "http://localhost:5173/", false, true, false],
    ["http://localhost:5173/", "http://localhost:5173/", true, false, false],
    ["app://dishylink/index.html", "app://dishylink/index.html", true, true, true],
    ["app://evil/index.html", "app://dishylink/index.html", true, true, false],
  ])("checks the actual main frame %s", (url, expected, main, top, allowed) => {
    expect(trustedAccountFrame(url, expected, main, top)).toBe(allowed);
  });
});
