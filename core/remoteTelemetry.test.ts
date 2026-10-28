import { describe, expect, it } from "vitest";
import { decodeRemoteTelemetry, accountSnapshots } from "./remoteTelemetry";
import type { AccountInventory } from "./accountContext";

const inventory: AccountInventory = {
  accounts: [{ accountId: "A" }],
  services: [
    {
      accountId: "A",
      serviceLineNumber: "S",
      terminals: [{ terminalId: "one", routerIds: ["router"] }],
    },
  ],
};
const payload = (values: unknown[][] = []) => ({
  data: {
    columnNamesByDeviceType: {
      u: [
        "DeviceType",
        "DeviceId",
        "Uptime",
        "UtcTimestampNs",
        "ObstructionPercentTime",
        "SignalQuality",
      ],
      r: ["DeviceType", "DeviceId", "WifiUptimeS"],
    },
    values,
  },
});
const snapshots = (value: unknown) =>
  accountSnapshots("login", "A", inventory, decodeRemoteTelemetry(value), 2_000);

describe("strict remote snapshots", () => {
  it("rejects malformed empty legends and marks empty or truncated known-type rows incomplete", () => {
    expect(() =>
      decodeRemoteTelemetry({
        data: {
          columnNamesByDeviceType: { u: ["DeviceType", "DeviceId", "DeviceId"] },
          values: [],
        },
      }),
    ).toThrow();
    for (const row of [[], [null], ["u"], ["u", "utone"]]) {
      const value = payload([row]);
      expect(snapshots(value)[0].status).toBe("unknown");
    }
  });
  it("decodes reordered named columns, preserves zero and raw obstruction fractions", () => {
    const reading = decodeRemoteTelemetry({
      data: {
        columnNamesByDeviceType: {
          u: [
            "DeviceType",
            "ObstructionPercentTime",
            "UtcTimestampNs",
            "DeviceId",
            "Uptime",
            "ActiveAlerts",
          ],
        },
        values: [["u", 0.05, 1_000_000_000, "utone", 0, [82]]],
      },
    });
    expect(reading.devices.utone).toMatchObject({
      kind: "dish",
      observedAt: 1000,
      uptimeS: 0,
      obstructionFraction: 0.05,
    });
    expect(reading.devices.utone).not.toHaveProperty("activeAlerts");
  });
  it.each([null, false, "", "12", Infinity, NaN])(
    "never turns malformed numbers into zero: %j",
    (value) => {
      const reading = decodeRemoteTelemetry(payload([["u", "utone", value, null, value, value]]));
      expect(reading.devices.utone).toEqual({ kind: "dish", deviceId: "utone", observedAt: null });
    },
  );
  it("records a valid empty payload as an offline observation without a fabricated upstream time", () => {
    expect(snapshots(payload())[0]).toMatchObject({
      source: "cloud",
      accountId: "A",
      serviceLineNumber: "S",
      terminalId: "one",
      status: "offline",
      fetchedAt: 2000,
      observedAt: null,
    });
  });
  it("keeps router-only readings unknown and does not attach other account devices", () => {
    const snapshot = snapshots(
      payload([
        ["r", "Router-router", 12],
        ["u", "utother", 10, 1000],
      ]),
    )[0];
    expect(snapshot.status).toBe("unknown");
    expect(snapshot.routers).toHaveLength(1);
    expect(snapshot.dish).toBeUndefined();
  });
  it("does not turn a partial malformed account response into offline", () => {
    expect(snapshots(payload([["u", null, 0]]))[0].status).toBe("unknown");
  });
  it.each([null, {}, { data: {} }, { data: { values: [], columnNamesByDeviceType: {} } }])(
    "rejects invalid schemas instead of calling them offline: %j",
    (value) => {
      expect(() => decodeRemoteTelemetry(value)).toThrow();
    },
  );
  it("preserves an old observation when fetched again and ignores unknown device types", () => {
    const snapshot = snapshots(
      payload([
        ["u", "utone", 12, 1_000_000, null, null],
        ["x", "ignored"],
      ]),
    )[0];
    expect(snapshot.status).toBe("online");
    expect(snapshot.observedAt).toBe(1);
    expect(snapshot.fetchedAt).toBe(2000);
  });
  it("keeps account/service/terminal identity in every snapshot", () => {
    expect(
      accountSnapshots("login", "B", inventory, decodeRemoteTelemetry(payload()), 2_000),
    ).toEqual([]);
  });
});
