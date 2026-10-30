import { describe, expect, it } from "vitest";
import { LocalMonitor, type Recorder } from "./localMonitor";
const stableIdentity = {};
const context = {
  credentialId: "login-a",
  accountId: "ACC-A",
  serviceLineNumber: "SL-A",
  terminalId: "dish-a",
};
function fixture() {
  let probes = 0;
  const opened: string[] = [];
  const closed: string[] = [];
  let terminal = "utdish-a";
  const recorder: Recorder = {
    request: async () => ({ status: 200, body: { samples: [] } }),
    configure: () => {},
    close: async () => {
      closed.push(terminal);
    },
  };
  const monitor = new LocalMonitor({
    probe: async () => {
      probes++;
      return terminal;
    },
    open: async (id) => {
      opened.push(id);
      return recorder;
    },
    member: () => true,
    identity: () => stableIdentity,
    binding: () => true,
  });
  return {
    monitor,
    opened,
    closed,
    probes: () => probes,
    setTerminal: (id: string) => {
      terminal = id;
    },
  };
}
describe("Windows local recorder lifecycle", () => {
  it("does no LAN work at remote-only startup and opens recording only after explicit identity verification", async () => {
    const f = fixture();
    expect(f.probes()).toBe(0);
    expect(f.opened).toEqual([]);
    await f.monitor.connect();
    expect(f.opened).toEqual(["dish-a"]);
    expect(f.monitor.state().terminalId).toBe("dish-a");
    f.monitor.disconnect();
    expect(f.monitor.state().status).toBe("idle");
  });
  it("rejects cross-terminal selection and old view responses after a network change", async () => {
    const f = fixture();
    await f.monitor.connect();
    expect(f.monitor.select({ ...context, terminalId: "dish-b" })).toBeNull();
    const grant = f.monitor.select(context)!;
    expect(grant).toBeTruthy();
    f.monitor.invalidate();
    expect(await f.monitor.api(grant, "/api/samples", "GET")).toMatchObject({ status: 409 });
    f.setTerminal("utdish-b");
    await f.monitor.connect();
    expect(f.opened).toEqual(["dish-a", "dish-b"]);
    expect(await f.monitor.api(grant, "/api/samples", "GET")).toMatchObject({ status: 409 });
  });
  it("lets a verified recorder continue independently after the user leaves for a remote page", async () => {
    const f = fixture();
    await f.monitor.connect();
    const grant = f.monitor.select(context)!;
    f.monitor.leave(grant);
    expect(f.monitor.state().recording).toBe(true);
    expect(await f.monitor.api(grant, "/api/samples", "GET")).toMatchObject({ status: 409 });
  });
  it("suppresses an identity probe that finishes after disconnect", async () => {
    let release!: (value: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const opened: string[] = [];
    const monitor = new LocalMonitor({
      probe: () => gate,
      open: async (id) => {
        opened.push(id);
        throw new Error("unexpected");
      },
      member: () => false,
      identity: () => stableIdentity,
      binding: () => false,
    });
    const pending = monitor.connect();
    monitor.disconnect();
    release("utdish-a");
    await pending;
    expect(opened).toEqual([]);
    expect(monitor.state().terminalId).toBeNull();
  });
});

describe("local context invalidation", () => {
  it("enables retained-view automation when router identity arrives after selection", async () => {
    const configurations: { controls: boolean }[] = [];
    let observed!: (dish: string | null, router: string | null) => void;
    const monitor = new LocalMonitor({
      probe: async () => "utdish-a",
      open: async (_id, _generation, observe) => {
        observed = observe;
        return {
          request: async () => ({ status: 200, body: {} }),
          close: async () => {},
          configure: (value) => {
            configurations.push(value);
          },
        };
      },
      member: () => true,
      identity: () => stableIdentity,
      binding: (_context, _id, router) => router === "router-a",
    });
    await monitor.connect();
    monitor.select(context);
    expect(monitor.automationContext()).toBeUndefined();
    observed("dish-a", "router-a");
    expect(monitor.automationContext()).toEqual(context);
    expect(configurations.at(-1)?.controls).toBe(true);
  });
  it("rejects an invented account and loses its lease when its credential is replaced", async () => {
    let identity: object = {};
    const recorder: Recorder = {
      request: async () => ({ status: 200, body: { samples: [] } }),
      configure: () => {},
      close: async () => {},
    };
    const monitor = new LocalMonitor({
      probe: async () => "utdish-a",
      open: async () => recorder,
      binding: () => true,
      member: (ctx) => ctx.accountId === "ACC-A",
      identity: () => identity,
    });
    await monitor.connect();
    expect(monitor.select({ ...context, accountId: "ACC-B" })).toBeNull();
    const lease = monitor.select(context)!;
    const authorization = monitor.state().authorizationGeneration ?? 0;
    identity = {};
    monitor.reconcile();
    expect(monitor.state().authorizationGeneration).toBe(authorization + 1);
    expect(await monitor.api(lease, "/api/samples", "GET")).toMatchObject({ status: 409 });
  });
});

describe("local history response boundaries", () => {
  it("labels scoped API responses and refuses guest metadata/rule writes", async () => {
    const f = fixture();
    await f.monitor.connect();
    const guest = f.monitor.select()!;
    expect(await f.monitor.api(guest, "/api/samples", "GET")).toMatchObject({
      status: 200,
      body: { recordingSource: { kind: "lan", terminalId: "dish-a" } },
    });
    expect(await f.monitor.api(guest, "/api/meters?clientKey=123", "POST")).toMatchObject({
      status: 403,
    });
  });
  it("suppresses an old recorder response that finishes after identity invalidation", async () => {
    let release!: (value: { status: number; body: unknown }) => void;
    const pending = new Promise<{ status: number; body: unknown }>((resolve) => {
      release = resolve;
    });
    const recorder: Recorder = {
      request: () => pending,
      configure: () => {},
      close: async () => {},
    };
    const monitor = new LocalMonitor({
      probe: async () => "utdish-a",
      open: async () => recorder,
      member: () => true,
      identity: () => stableIdentity,
      binding: () => true,
    });
    await monitor.connect();
    const lease = monitor.select(context)!;
    const reading = monitor.api(lease, "/api/samples", "GET");
    monitor.invalidate();
    release({ status: 200, body: { samples: ["old private A"] } });
    expect(await reading).toEqual({ status: 409, body: { error: "local_source_changed" } });
  });
});
