import { describe, expect, it } from "vitest";
import { auditCloudReads } from "./capabilityAudit";

describe("read-only capability schema audit", () => {
  it("describes ActiveAlerts item types and fields without retaining alert contents", async () => {
    const reports: unknown[] = [];
    const response = Response.json({
      data: {
        columnNamesByDeviceType: { u: ["DeviceType", "DeviceId", "ActiveAlerts"] },
        values: [
          [
            "u",
            "ut-private",
            [{ id: 123, message: "private message", severity: "private severity" }],
          ],
          ["u", "ut-other", []],
        ],
      },
    });
    const audited = auditCloudReads((async () => response) as typeof fetch, (r) => reports.push(r));
    await audited("https://starlink.com/api/device-data/cache/v1/telemetry", { method: "POST" });
    expect(reports).toEqual([
      expect.objectContaining({
        schema: {
          devices: [
            expect.objectContaining({
              columns: expect.arrayContaining([
                expect.objectContaining({
                  name: "ActiveAlerts",
                  nonEmptyRows: 1,
                  itemTypes: ["object"],
                  itemFields: expect.arrayContaining([
                    { path: "[].id", types: ["number"] },
                    { path: "[].message", types: ["string"] },
                  ]),
                }),
              ]),
            }),
          ],
        },
      }),
    ]);
    expect(JSON.stringify(reports)).not.toMatch(/private|123/);
  });
  it("records unmapped telemetry columns and types without device IDs or values", async () => {
    const reports: unknown[] = [];
    const response = Response.json({
      data: {
        columnNamesByDeviceType: {
          u: ["type", "DeviceId", "Alerts", "Alignment", "ObstructionPercentTime"],
        },
        values: [["u", "ut-private-device", ["private-warning-message"], null, 0.123]],
      },
    });
    const audited = auditCloudReads((async () => response) as typeof fetch, (r) => reports.push(r));
    expect(
      await audited("https://starlink.com/api/device-data/cache/v1/telemetry", { method: "POST" }),
    ).toBe(response);
    expect(reports).toEqual([
      {
        source: "telemetry",
        status: 200,
        schema: {
          devices: [
            {
              kind: "dish",
              rows: 1,
              columns: [
                { name: "type", types: ["string"] },
                { name: "DeviceId", types: ["string"] },
                { name: "Alerts", types: ["array"] },
                { name: "Alignment", types: ["null"] },
                { name: "ObstructionPercentTime", types: ["number"] },
              ],
            },
          ],
        },
      },
    ]);
    expect(JSON.stringify(reports)).not.toMatch(/private|0\.123/);
    expect(await response.json()).toHaveProperty("data.values");
  });

  it("summarizes service status/alert paths while dropping all scalar values and unsafe keys", async () => {
    const reports: unknown[] = [];
    const response = Response.json({
      content: {
        nickname: "Private site",
        userTerminals: [
          { userTerminalId: "private-terminal", isOffline: false, lastConnected: null, alerts: [] },
          {
            userTerminalId: "other-terminal",
            isOffline: null,
            alerts: [{ message: "Private warning" }],
          },
        ],
        "private@example.com": "secret",
      },
    });
    const audited = auditCloudReads((async () => response) as typeof fetch, (r) => reports.push(r));
    await audited("https://starlink.com/api/webagg/v2/accounts/service-line/SL-private");
    expect(JSON.stringify(reports)).not.toMatch(/Private|private|other-terminal|secret/);
    expect(JSON.stringify(reports)).not.toContain('"isOffline":false');
    expect(reports).toEqual([
      expect.objectContaining({
        source: "service-detail",
        schema: expect.objectContaining({
          fields: expect.arrayContaining([
            { path: "content.userTerminals[].isOffline", types: ["boolean", "null"] },
            { path: "content.userTerminals[].alerts", types: ["array"] },
            { path: "content.userTerminals[].alerts[].message", types: ["string"] },
          ]),
        }),
      }),
    ]);
  });

  it("ignores auth, usage, other origins, and service writes without consuming them", async () => {
    const reports: unknown[] = [];
    let calls = 0;
    const audited = auditCloudReads(
      (async () => {
        calls++;
        return Response.json({ token: "secret" });
      }) as typeof fetch,
      (r) => reports.push(r),
    );
    await audited("https://api.starlink.com/auth-rp/auth/user");
    await audited("https://starlink.com/api/telemetryagg/v1/data-usage/account/private");
    await audited("https://other.invalid/api/device-data/cache/v1/telemetry", { method: "POST" });
    await audited("https://starlink.com/api/webagg/v2/accounts/service-line/private", {
      method: "PATCH",
    });
    expect(reports).toEqual([]);
    expect(calls).toBe(4);
  });

  it("does not change responses when JSON or the local audit sink fails", async () => {
    const response = new Response("not-json", { status: 200 });
    const audited = auditCloudReads((async () => response) as typeof fetch, () => {
      throw new Error("disk full");
    });
    expect(
      await audited("https://starlink.com/api/device-data/cache/v1/telemetry", { method: "POST" }),
    ).toBe(response);
    expect(await response.text()).toBe("not-json");
    const valid = Response.json({ data: { values: [] } });
    const brokenSink = auditCloudReads((async () => valid) as typeof fetch, () => {
      throw new Error("disk full");
    });
    expect(
      await brokenSink("https://starlink.com/api/device-data/cache/v1/telemetry", {
        method: "POST",
      }),
    ).toBe(valid);
    expect(await valid.json()).toEqual({ data: { values: [] } });
  });
});
