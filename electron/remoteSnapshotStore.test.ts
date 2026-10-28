import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RemoteSnapshotStore } from "./remoteSnapshotStore";
import { RETENTION_MS, type RemoteSnapshot } from "../core/remoteTelemetry";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "remote-store-"));
  directories.push(directory);
  return directory;
}
const snapshot = (at: number, accountId = "A"): RemoteSnapshot => ({
  credentialId: "login",
  accountId,
  serviceLineNumber: "S",
  terminalId: "same",
  source: "cloud",
  status: "online",
  observedAt: 100,
  fetchedAt: at,
  routers: [],
});

describe("remote snapshot persistence", () => {
  it("persists credential-level upstream deadlines independently of the active account", () => {
    const directory = setup();
    const store = new RemoteSnapshotStore(directory, () => 1000);
    store.saveCredentialBackoff("login", 7_200_000);
    store.saveCredentialBackoff("login", 1000);
    expect(new RemoteSnapshotStore(directory).credentialBackoff("login")).toBe(7_200_000);
    expect(() => store.saveCredentialBackoff("../outside", 9999)).toThrow();
  });
  it("deduplicates observations while retaining fetch attempts and survives restart", () => {
    const directory = setup();
    const store = new RemoteSnapshotStore(directory, () => 1000);
    const record = store.get("A", "login");
    record.snapshots.push(snapshot(900), snapshot(1000));
    record.attempts.push({ at: 900, outcome: "success" }, { at: 1000, outcome: "success" });
    store.save(record);
    const loaded = new RemoteSnapshotStore(directory, () => 1000).get("A", "login");
    expect(loaded.snapshots).toEqual([snapshot(1000)]);
    expect(loaded.attempts).toHaveLength(2);
    expect(loaded.snapshots[0].observedAt).toBe(100);
  });
  it("keeps identical terminal IDs in separate accounts and persists expected-offline context", () => {
    const store = new RemoteSnapshotStore(setup(), () => 1000);
    for (const accountId of ["A", "B"]) {
      const record = store.get(accountId, "login");
      record.snapshots.push(snapshot(1000, accountId));
      record.expectations['["S","same"]'] = { enabled: accountId === "A", reason: "Holiday" };
      store.save(record);
    }
    expect(store.get("A", "login").expectations['["S","same"]'].enabled).toBe(true);
    expect(store.get("B", "login").expectations['["S","same"]'].enabled).toBe(false);
  });
  it("prunes 90-day history and attempts without deleting latest retained metadata", () => {
    const store = new RemoteSnapshotStore(setup(), () => RETENTION_MS + 1000);
    const record = store.get("A", "login");
    record.snapshots.push(snapshot(1), { ...snapshot(RETENTION_MS + 999), observedAt: 200 });
    record.attempts.push(
      { at: 1, outcome: "success" },
      { at: RETENTION_MS + 999, outcome: "network" },
    );
    record.state.lastSuccessAt = 1;
    store.save(record);
    expect(store.get("A", "login").snapshots).toHaveLength(1);
    expect(store.get("A", "login").attempts).toHaveLength(1);
    expect(store.get("A", "login").state.lastSuccessAt).toBe(1);
  });
  it("ignores interrupted temporary files and does not replace a valid cache after failed commit", () => {
    const directory = setup();
    const store = new RemoteSnapshotStore(directory, () => 1000);
    const record = store.get("A", "login");
    store.save(record);
    writeFileSync(join(directory, ".A-interrupted.tmp"), "unfinished");
    const failing = new RemoteSnapshotStore(
      directory,
      () => 1000,
      () => {
        throw new Error("disk full");
      },
    );
    const changed = failing.get("A", "login");
    changed.state.lastSuccessAt = 1000;
    expect(() => failing.save(changed)).toThrow();
    expect(
      new RemoteSnapshotStore(directory).get("A", "login").state.lastSuccessAt,
    ).toBeUndefined();
  });
  it("rejects corrupt, wrong-account and unsupported-version files without overwriting them", () => {
    const directory = setup();
    writeFileSync(join(directory, "A.json"), '{"version":99}');
    const store = new RemoteSnapshotStore(directory);
    expect(() => store.get("A", "login")).toThrow();
    expect(() => store.get("../outside", "login")).toThrow();
    expect(store.get("B", "login").accountId).toBe("B");
  });
});
