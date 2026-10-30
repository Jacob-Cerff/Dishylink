import { describe, expect, it, vi } from "vitest";
import { RecordingIdentity, RecordingProofUnavailable } from "./recordingIdentity";
it("withholds unverified data on timeout without permanently blocking recovery", async () => {
  vi.useFakeTimers();
  try {
    const identity = new RecordingIdentity("dish-a");
    const sample = identity.verify(
      { dishGetObstructionMap: {} },
      { target: "dish", startedAt: 1, receivedAt: 2 },
    );
    const failure = expect(sample).rejects.toBeInstanceOf(RecordingProofUnavailable);
    await vi.advanceTimersByTimeAsync(12000);
    await failure;
    expect(identity.blocked).toBe(false);
    await identity.verify(
      { dishGetStatus: { deviceInfo: { id: "utdish-a" } } },
      { target: "dish", startedAt: 3, receivedAt: 4 },
    );
  } finally {
    vi.useRealTimers();
  }
});
it("withholds identity-free samples until a status request started after their arrival proves the source", async () => {
  const identity = new RecordingIdentity("dish-a");
  const accepted: string[] = [];
  const sample = identity
    .verify(
      { wifiGetClients: { clients: ["site-b-client"] } },
      { target: "router", startedAt: 10, receivedAt: 11 },
    )
    .then(
      () => {
        accepted.push("site-b-client");
      },
      () => {},
    );
  await identity.verify(
    { dishGetStatus: { deviceInfo: { id: "utdish-a" } } },
    { target: "dish", startedAt: 1, receivedAt: 12 },
  );
  expect(accepted).toEqual([]);
  await expect(
    identity.verify(
      { dishGetStatus: { deviceInfo: { id: "utdish-b" } } },
      { target: "dish", startedAt: 13, receivedAt: 14 },
    ),
  ).rejects.toThrow();
  await sample;
  expect(accepted).toEqual([]);
});
it("releases same-source data only after fresh dish and router status proofs", async () => {
  const identity = new RecordingIdentity("dish-a");
  let accepted = false;
  const sample = identity
    .verify({ wifiGetClients: {} }, { target: "router", startedAt: 1, receivedAt: 2 })
    .then(() => {
      accepted = true;
    });
  await identity.verify(
    { dishGetStatus: { deviceInfo: { id: "utdish-a" } } },
    { target: "dish", startedAt: 3, receivedAt: 4 },
  );
  expect(accepted).toBe(false);
  await identity.verify(
    { wifiGetStatus: { deviceInfo: { id: "Router-router-a" } } },
    { target: "router", startedAt: 5, receivedAt: 6 },
  );
  await sample;
  expect(accepted).toBe(true);
});
describe("LAN recording provenance", () => {
  it("blocks a reply from a different dish before it can enter the original recording", () => {
    const source = new RecordingIdentity("dish-a");
    expect(source.observe({ dishGetStatus: { deviceInfo: { id: "utdish-a" } } })).toEqual({
      terminalId: "dish-a",
      routerId: null,
    });
    expect(() => source.observe({ dishGetStatus: { deviceInfo: { id: "utdish-b" } } })).toThrow();
    expect(source.blocked).toBe(true);
    expect(() => source.observe({ dishGetHistory: {} })).toThrow();
  });
  it("learns the router from existing status replies and blocks replacement-router carryover", () => {
    const source = new RecordingIdentity("dish-a");
    expect(source.observe({ wifiGetStatus: { deviceInfo: { id: "Router-r-a" } } })).toEqual({
      terminalId: "dish-a",
      routerId: "r-a",
    });
    expect(() => source.observe({ wifiGetStatus: { deviceInfo: { id: "Router-r-b" } } })).toThrow();
  });
});
