import { describe, expect, it, vi } from "vitest";
import {
  handleRemoteRequest,
  runRemoteMonitoring,
  restrictLiveAccountRead,
} from "./remoteMonitoring";
import { RemoteRefresh } from "../cloud/remoteRefresh";

describe("Windows remote monitor lifecycle and request boundary", () => {
  it("schedules with no window, pauses in sleep/offline and catches up once on resume", () => {
    const engine = { tick: vi.fn(), wake: vi.fn(), close: vi.fn() } as unknown as RemoteRefresh;
    let online = true;
    let pulse!: () => void;
    let resume!: () => void;
    let suspend!: () => void;
    let changed!: () => void;
    const clean = vi.fn();
    const stop = runRemoteMonitoring(
      engine,
      (listener) => {
        changed = listener;
        return clean;
      },
      {
        every: (listener) => {
          pulse = listener;
          return clean;
        },
        onResume: (listener) => {
          resume = listener;
          return clean;
        },
        onSuspend: (listener) => {
          suspend = listener;
          return clean;
        },
        isOnline: () => online,
      },
    );
    expect(engine.tick).toHaveBeenCalledTimes(1);
    suspend();
    pulse();
    changed();
    expect(engine.tick).toHaveBeenCalledTimes(1);
    resume();
    expect(engine.wake).toHaveBeenCalledTimes(1);
    online = false;
    pulse();
    online = true;
    pulse();
    expect(engine.wake).toHaveBeenCalledTimes(2);
    stop();
    pulse();
    changed();
    expect(engine.close).toHaveBeenCalledTimes(1);
    expect(clean).toHaveBeenCalledTimes(4);
  });
  it("validates requests and exposes cache/manual/settings/expectation operations only", async () => {
    const engine = {
      manual: vi.fn(async () => ({ status: 200, body: {} })),
      cached: vi.fn(() => ({ status: 200, body: {} })),
      configure: vi.fn(),
      expectOffline: vi.fn(),
    } as unknown as RemoteRefresh;
    expect(
      await handleRemoteRequest(
        { kind: "remote-refresh", credentialId: "login", accountId: "A" },
        engine,
      ),
    ).toMatchObject({ status: 200 });
    expect(engine.manual).toHaveBeenCalledWith("login", "A");
    expect(
      await handleRemoteRequest(
        { kind: "remote-refresh", credentialId: "../x", accountId: "A" },
        engine,
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await handleRemoteRequest(
        { kind: "remote-settings", credentialId: "login", accountId: "A", intervalHours: "2" },
        engine,
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await handleRemoteRequest({ kind: "remote-expectation", enabled: "true" }, engine),
    ).toMatchObject({ status: 400 });
    expect(
      await handleRemoteRequest({ kind: "remote-fetch-url", url: "https://other.invalid" }, engine),
    ).toMatchObject({ status: 400 });
    expect(await handleRemoteRequest({ kind: "remote-cache", context: {} }, engine)).toMatchObject({
      status: 200,
    });
    expect(engine.cached).toHaveBeenCalledWith({}); // Context ownership is checked by the engine.
  });
  it("prevents production renderer requests from bypassing refresh limits through diagnostic live reads", () => {
    expect(restrictLiveAccountRead({ kind: "read", route: "/cloud/telemetry" }, true)).toBe(true);
    expect(restrictLiveAccountRead({ kind: "refresh" }, true)).toBe(true);
    expect(restrictLiveAccountRead({ kind: "read" }, false)).toBe(false);
    expect(restrictLiveAccountRead({ kind: "remote-refresh" }, true)).toBe(false);
  });
});
