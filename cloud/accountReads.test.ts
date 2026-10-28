import { describe, expect, it } from "vitest";
import { createCloudHandler } from "./starlinkCloudHandler";
import type { AccountInventory, DishContext } from "../core/accountContext";

const inventory: AccountInventory = {
  accounts: [{ accountId: "ACC-B" }],
  services: [
    {
      accountId: "ACC-B",
      serviceLineNumber: "SL-2",
      terminals: [{ terminalId: "dish-b", routerIds: ["router-b"] }],
    },
  ],
};
const context: DishContext = {
  credentialId: "login-b",
  accountId: "ACC-B",
  serviceLineNumber: "SL-2",
  terminalId: "dish-b",
};

function backend() {
  const paths: string[] = [];
  let authCalls = 0;
  const handler = createCloudHandler({
    readCookie: () => "Starlink.Com.Sso=fake-session",
    retryDelayMs: 0,
    fetch: (async (input, init) => {
      const url = String(input);
      paths.push(url);
      if (url.includes("auth-rp")) {
        authCalls++;
        return Response.json({ accountId: "ACC-B" });
      }
      if (url.includes("service-lines?"))
        return Response.json({
          content: { results: [{ accountReferenceId: "ACC-B", serviceLineNumber: "SL-2" }] },
        });
      if (url.includes("/webagg/v2/accounts/service-line/SL-2"))
        return Response.json({
          content: {
            serviceLineNumber: "SL-2",
            accountReferenceId: "ACC-B",
            userTerminals: [{ userTerminalId: "dish-b" }],
          },
        });
      if (url.includes("/device-data/cache/v1/telemetry")) {
        expect(JSON.parse(String(init?.body))).toEqual({ accountNumber: "ACC-B" });
        return Response.json({
          data: {
            columnNamesByDeviceType: { u: ["type", "DeviceId", "Uptime", "ActiveAlerts"] },
            values: [
              ["u", "utdish-a", 10, [111]],
              ["u", "utdish-b", 20, [777]],
            ],
          },
        });
      }
      if (url.includes("/SL-2/annotated")) return Response.json({ usage: "selected-service" });
      throw new Error("Unexpected route");
    }) as typeof fetch,
  });
  return { handler, paths, authCalls: () => authCalls };
}

describe("explicit account reads", () => {
  it("discovers a login inventory without resolving a primary service", async () => {
    const { handler } = backend();
    expect((await handler.inventory()).services[0].serviceLineNumber).toBe("SL-2");
  });
  it("uses the selected account and only returns telemetry for the selected terminal/router", async () => {
    const { handler, paths } = backend();
    const result = await handler.readScoped("/cloud/telemetry", context, inventory);
    expect(result.status).toBe(200);
    expect(Object.keys((result.body as { deviceTelemetry: object }).deviceTelemetry)).toEqual([
      "utdish-b",
    ]);
    expect(paths.some((p) => p.includes("service-lines?"))).toBe(false);
    expect(
      (result.body as { deviceTelemetry: Record<string, { activeAlerts?: number[] }> })
        .deviceTelemetry["utdish-b"].activeAlerts,
    ).toEqual([777]);
  });
  it("reads usage for the selected service rather than the first service", async () => {
    const { handler, paths } = backend();
    expect((await handler.readScoped("/cloud/usage", context, inventory)).body).toEqual({
      usage: "selected-service",
    });
    expect(paths.some((p) => p.includes("account/ACC-B/service-line/SL-2/annotated"))).toBe(true);
  });
  it.each(["https://evil.invalid", "/cloud/device", "/cloud/telemetry?account=ACC-A"])(
    "rejects arbitrary route %s before contacting any host",
    async (route) => {
      const { handler, paths } = backend();
      expect((await handler.readScoped(route, context, inventory)).status).toBe(400);
      expect(paths).toEqual([]);
    },
  );
  it("rejects an account/service mismatch before even token refresh", async () => {
    const { handler, paths } = backend();
    expect(
      (await handler.readScoped("/cloud/usage", { ...context, accountId: "ACC-A" }, inventory))
        .status,
    ).toBe(403);
    expect(paths).toEqual([]);
  });
  it("shares a single token refresh between simultaneous reads in one session", async () => {
    const { handler, authCalls } = backend();
    await Promise.all([
      handler.readScoped("/cloud/usage", context, inventory),
      handler.readScoped("/cloud/telemetry", context, inventory),
    ]);
    expect(authCalls()).toBe(1);
  });
});
