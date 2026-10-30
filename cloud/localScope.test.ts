import { describe, expect, it } from "vitest";
import { createCloudHandler } from "./starlinkCloudHandler";
const context = {
  credentialId: "login-a",
  accountId: "ACC-A",
  serviceLineNumber: "SL-A",
  terminalId: "dish-a",
};
describe("verified local cloud targets", () => {
  it("uses the explicitly bound service and router instead of legacy first-service discovery", async () => {
    const urls: string[] = [];
    const routers: string[] = [];
    const handler = createCloudHandler({
      readCookie: () => "Starlink.Com.Sso=fake",
      retryDelayMs: 0,
      scope: { ...context, routerId: "Router-r-a", routerIds: ["r-a"], valid: () => true },
      fetch: (async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("auth-rp")) return Response.json({ accountId: "ACC-OTHER" });
        if (url.includes("service-lines?"))
          return Response.json({
            content: {
              results: [{ accountReferenceId: "ACC-OTHER", serviceLineNumber: "SL-OTHER" }],
            },
          });
        if (url.includes("telemetry"))
          return Response.json({
            data: {
              columnNamesByDeviceType: {
                u: ["DeviceType", "DeviceId"],
                r: ["DeviceType", "DeviceId"],
              },
              values: [],
            },
          });
        return Response.json({
          content: {
            serviceLineNumber: "SL-A",
            accountReferenceId: "ACC-A",
            userTerminals: [{ userTerminalId: "dish-a" }, { userTerminalId: "dish-other" }],
          },
        });
      }) as typeof fetch,
      readRouterSubnet: async (id) => {
        routers.push(id);
        return "192.168.1.0/24";
      },
    });
    expect((await handler.handle("/cloud/account")).status).toBe(200);
    expect(urls.some((url) => url.includes("service-line/SL-A"))).toBe(true);
    expect(urls.some((url) => url.includes("service-lines?"))).toBe(false);
    expect((await handler.handle("/cloud/router-subnet")).status).toBe(200);
    expect(routers).toEqual(["Router-r-a"]);
  });
  it("refuses a revoked local scope before dispatching any authenticated request", async () => {
    let calls = 0;
    const handler = createCloudHandler({
      scope: { ...context, routerId: "Router-r-a", routerIds: ["r-a"], valid: () => false },
      readCookie: () => "Starlink.Com.Sso=fake",
      fetch: (async () => {
        calls++;
        return Response.json({});
      }) as typeof fetch,
    });
    expect((await handler.handle("/cloud/account")).status).not.toBe(200);
    expect(calls).toBe(0);
  });
});
