import { describe, expect, it } from "vitest";
import { AccountClient } from "./accountClient";
import { parseAccountRoute, accountHash } from "./accountRoute";
const context = (accountId: string) => ({
  credentialId: "login",
  accountId,
  serviceLineNumber: "SL",
  terminalId: "UT",
});
const cached = (accountId: string) => ({
  snapshot: null,
  refresh: { accountId, credentialId: "login", intervalHours: 2, nextDueAt: 2000, retryCount: 0 },
  overdue: false,
  expectation: { enabled: false },
});
const deferred = () => {
  let resolve!: (v: { status: number; body: unknown }) => void;
  const promise = new Promise<{ status: number; body: unknown }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
describe("scoped account queries", () => {
  it("coalesces simultaneous readers and keeps account keys separate", async () => {
    let count = 0;
    const pending = deferred();
    const client = new AccountClient(async (input) => {
      count++;
      await pending.promise;
      return {
        status: 200,
        body: cached(input.kind === "remote-cache" ? input.context.accountId : ""),
      };
    });
    const a = client.remote(context("A"));
    const b = client.remote(context("B"));
    const p = a.load();
    const q = a.load();
    const r = b.load();
    expect(count).toBe(2);
    pending.resolve({ status: 200, body: {} });
    await Promise.all([p, q, r]);
    expect(a.get().data?.refresh.accountId).toBe("A");
    expect(b.get().data?.refresh.accountId).toBe("B");
    expect(a).not.toBe(b);
  });
  it("drops late replies after credential invalidation or account removal", async () => {
    const pending = deferred();
    const client = new AccountClient(async () => pending.promise);
    const query = client.remote(context("A"));
    const loading = query.load();
    client.invalidate({ kind: "sessions" });
    pending.resolve({ status: 200, body: cached("A") });
    await loading;
    expect(query.get().data).toBeUndefined();
  });
  it("retains cached values on a failed disk read without leaking exception text", async () => {
    let fail = false;
    const client = new AccountClient(async () => {
      if (fail) throw new Error("secret-cookie");
      return { status: 200, body: cached("A") };
    });
    const query = client.remote(context("A"));
    await query.load();
    fail = true;
    await query.load(true);
    expect(query.get().data?.refresh.accountId).toBe("A");
    expect(query.get().error).toBe("unavailable");
    expect(JSON.stringify(query.get())).not.toContain("secret-cookie");
  });
  it("rejects another account's snapshot even if the host returns success", async () => {
    const client = new AccountClient(async () => ({
      status: 200,
      body: {
        ...cached("A"),
        snapshot: {
          ...context("B"),
          source: "cloud",
          status: "online",
          observedAt: 1000,
          fetchedAt: 1000,
          routers: [],
        },
      },
    }));
    const query = client.remote(context("A"));
    await query.load();
    expect(query.get().data).toBeUndefined();
    expect(query.get().error).toBe("unavailable");
  });
});
describe("account fragment routes", () => {
  it("accepts service-first links and explicit terminals, rejecting malformed IDs and extra levels", () => {
    expect(parseAccountRoute("#/accounts/ACC/services/SL")).toEqual({
      kind: "service",
      accountId: "ACC",
      serviceLineNumber: "SL",
    });
    expect(
      parseAccountRoute(
        accountHash({
          kind: "service",
          accountId: "ACC",
          serviceLineNumber: "SL",
          terminalId: "UT",
        }),
      ),
    ).toEqual({ kind: "service", accountId: "ACC", serviceLineNumber: "SL", terminalId: "UT" });
    for (const value of [
      "#/accounts/../services/SL",
      "#/accounts/%2Fbad",
      "#/accounts/A/services/B/extra",
      "#secret=token",
    ])
      expect(parseAccountRoute(value)).toEqual({ kind: "invalid" });
  });
});

describe("cache change delivery", () => {
  it("rechecks an observed query when a snapshot event arrives during a pending read", async () => {
    const pending = deferred();
    let reads = 0;
    const client = new AccountClient(async () => {
      reads++;
      if (reads === 1) return pending.promise;
      return {
        status: 200,
        body: { ...cached("A"), refresh: { ...cached("A").refresh, nextDueAt: 9000 } },
      };
    });
    const query = client.remote(context("A"));
    const unsubscribe = query.subscribe(() => {});
    const first = query.load();
    client.invalidate({ kind: "snapshots", accountId: "A" });
    pending.resolve({ status: 200, body: cached("A") });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(query.get().data?.refresh.nextDueAt).toBe(9000);
    unsubscribe();
  });
});
