import { describe, expect, it } from "vitest";
import { deviceTelemetryFrom } from "./starlinkCloudHandler";

describe("cloud active alert codes", () => {
  it("reads dish and router numeric codes by legend name without interpreting severity", () => {
    const result = deviceTelemetryFrom({
      data: {
        columnNamesByDeviceType: {
          u: ["DeviceType", "ActiveAlerts", "DeviceId"],
          r: ["DeviceType", "DeviceId", "ActiveAlerts"],
        },
        values: [
          ["u", [0, 777], "ut-dish"],
          ["r", "Router-one", [888]],
        ],
      },
    });
    expect(result["ut-dish"].activeAlerts).toEqual([0, 777]);
    expect(result["Router-one"].activeAlerts).toEqual([888]);
    expect(result["ut-dish"]).not.toHaveProperty("severity");
  });
  it.each([null, undefined, "777", ["777"], [NaN], [-1], [1.5], [{ message: "do not forward" }]])(
    "keeps invalid or missing alert coverage unknown: %j",
    (alerts) => {
      const result = deviceTelemetryFrom({
        data: {
          columnNamesByDeviceType: { u: ["DeviceType", "DeviceId", "ActiveAlerts"] },
          values: [["u", "ut-dish", alerts]],
        },
      });
      expect(result["ut-dish"].activeAlerts).toBeUndefined();
    },
  );
  it("preserves a reported empty list separately from an absent column", () => {
    const result = deviceTelemetryFrom({
      data: {
        columnNamesByDeviceType: {
          u: ["DeviceType", "DeviceId", "ActiveAlerts"],
          r: ["DeviceType", "DeviceId"],
        },
        values: [
          ["u", "ut-dish", []],
          ["r", "Router-one"],
        ],
      },
    });
    expect(result["ut-dish"].activeAlerts).toEqual([]);
    expect(result["Router-one"].activeAlerts).toBeUndefined();
  });
});
