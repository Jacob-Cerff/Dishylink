import { describe, expect, it } from "vitest";
import { AccountRegistry } from "./accountRegistry";
import { createCloudHandler } from "./starlinkCloudHandler";
function setup(reply: () => Response) {
  let posts = 0;
  const registry = new AccountRegistry({
    store: { load: () => [], save: () => {} },
    fetch: (async (input) => {
      const url = String(input);
      if (url.includes("auth-rp")) return Response.json({ accountId: "A" });
      if (url.includes("service-lines?"))
        return Response.json({
          content: { results: [{ accountReferenceId: "A", serviceLineNumber: "S" }] },
        });
      if (url.includes("service-line/"))
        return Response.json({
          content: { userTerminals: [{ userTerminalId: "one" }, { userTerminalId: "two" }] },
        });
      posts++;
      return reply();
    }) as typeof fetch,
  });
  return { registry, posts: () => posts };
}
async function connect(registry: AccountRegistry) {
  await registry.importSession({
    credentialId: "login",
    label: "A",
    cookie: "Starlink.Com.Sso=fake",
  });
}
describe("trusted account-wide collection", () => {
  it("marks auth-endpoint Retry-After as shared across the credential", async () => {
    const handler = createCloudHandler({
      readCookie: () => "Starlink.Com.Sso=fake",
      fetch: (async () =>
        new Response(null, { status: 429, headers: { "Retry-After": "3600" } })) as typeof fetch,
    });
    expect(await handler.accountTelemetry("A")).toMatchObject({
      status: 429,
      body: { credentialScoped: true, retryAfterMs: 3_600_000 },
    });
  });
  it("does not change leases or notify listeners for no-op tracking settings", async () => {
    const { registry } = setup(() => Response.json({}));
    await connect(registry);
    let changed = 0;
    registry.subscribe(() => {
      changed++;
    });
    const token = registry.sessionToken("login");
    registry.setTracking("login", true);
    registry.setTracking("login", true);
    expect(registry.sessionToken("login")).toBe(token);
    expect(changed).toBe(0);
  });
  it("collects once per account and validates membership before network work", async () => {
    const { registry, posts } = setup(() =>
      Response.json({
        data: { columnNamesByDeviceType: { u: ["DeviceType", "DeviceId"] }, values: [] },
      }),
    );
    await connect(registry);
    expect((await registry.collectAccount("login", "other")).status).toBe(403);
    expect(posts()).toBe(0);
    expect((await registry.collectAccount("login", "A")).body).toEqual({
      devices: {},
      incomplete: false,
    });
    expect(posts()).toBe(1);
  });
  it("preserves Retry-After and does not confuse invalid JSON schema with offline", async () => {
    let response = new Response(null, { status: 429, headers: { "Retry-After": "7200" } });
    const { registry } = setup(() => response);
    await connect(registry);
    expect(await registry.collectAccount("login", "A")).toMatchObject({
      status: 429,
      body: { retryAfterMs: 7_200_000 },
    });
    response = Response.json({ unrelated: true });
    expect((await registry.collectAccount("login", "A")).status).toBe(502);
  });
  it("invalidates collection leases after stop/restart tracking and credential replacement", async () => {
    const { registry } = setup(() => Response.json({}));
    await connect(registry);
    const token = registry.sessionToken("login");
    registry.setTracking("login", false);
    registry.setTracking("login", true);
    expect(registry.isCurrentSession("login", token)).toBe(false);
    const next = registry.sessionToken("login");
    await connect(registry);
    expect(registry.isCurrentSession("login", next)).toBe(false);
  });
  it("notifies subscribers without exposing secrets and isolates auth expiry", async () => {
    const { registry } = setup(() => new Response(null, { status: 401 }));
    let changes = 0;
    registry.subscribe(() => {
      changes++;
    });
    await connect(registry);
    expect((await registry.collectAccount("login", "A")).status).toBe(428);
    expect(registry.list().sessions[0].state).toBe("reconnect-required");
    expect(changes).toBeGreaterThanOrEqual(2);
  });
});
