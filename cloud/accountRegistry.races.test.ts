import { describe, expect, it } from "vitest";
import { AccountRegistry, type SavedCredential } from "./accountRegistry";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function store() {
  const records = new Map<string, SavedCredential>();
  return {
    records,
    load: () => structuredClone([...records.values()]),
    save: (record: SavedCredential) => {
      records.set(record.credentialId, structuredClone(record));
    },
  };
}

describe("session and inventory response ordering", () => {
  it("rejects an old-session read that began during replacement validation", async () => {
    const replacing = gate();
    const replacementStarted = gate();
    const reading = gate();
    const readStarted = gate();
    const registry = new AccountRegistry({
      store: store(),
      fetch: (async (input, init) => {
        const path = String(input);
        const key = new Headers(init?.headers).get("cookie")?.includes("Sso=b") ? "b" : "a";
        if (path.includes("auth-rp")) {
          if (key === "b") {
            replacementStarted.release();
            await replacing.promise;
          }
          return Response.json({ accountId: `ACC-${key}` });
        }
        if (path.includes("service-lines?"))
          return Response.json({
            content: {
              results: [{ accountReferenceId: `ACC-${key}`, serviceLineNumber: `SL-${key}` }],
            },
          });
        if (path.includes("/webagg/"))
          return Response.json({ content: { userTerminals: [{ userTerminalId: `dish-${key}` }] } });
        readStarted.release();
        await reading.promise;
        return Response.json({ from: key }); // Simulate a response winning the transport-abort race.
      }) as typeof fetch,
    });
    await registry.importSession({
      credentialId: "login",
      label: "A",
      cookie: "Starlink.Com.Sso=a",
    });
    const replacement = registry.importSession({
      credentialId: "login",
      label: "B",
      cookie: "Starlink.Com.Sso=b",
    });
    await replacementStarted.promise;
    const oldRead = registry.read("login", "/cloud/usage", {
      credentialId: "login",
      accountId: "ACC-a",
      serviceLineNumber: "SL-a",
      terminalId: "dish-a",
    });
    await readStarted.promise;
    replacing.release();
    expect((await replacement).status).toBe(200);
    reading.release();
    expect((await oldRead).status).toBe(409);
  });

  it("coalesces concurrent inventory refreshes so an earlier response cannot restore removed dishes", async () => {
    const pending = gate();
    const started = gate();
    const persistence = store();
    let hold = false;
    let listCalls = 0;
    let terminalId = "old";
    const registry = new AccountRegistry({
      store: persistence,
      fetch: (async (input) => {
        const path = String(input);
        if (path.includes("auth-rp")) return Response.json({ accountId: "ACC-A" });
        if (path.includes("service-lines?")) {
          listCalls++;
          if (hold) {
            started.release();
            await pending.promise;
          }
          return Response.json({
            content: { results: [{ accountReferenceId: "ACC-A", serviceLineNumber: "SL-1" }] },
          });
        }
        return Response.json({ content: { userTerminals: [{ userTerminalId: terminalId }] } });
      }) as typeof fetch,
    });
    await registry.importSession({
      credentialId: "login",
      label: "A",
      cookie: "Starlink.Com.Sso=a",
    });
    hold = true;
    const first = registry.refreshInventory("login");
    await started.promise;
    const second = registry.refreshInventory("login");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(listCalls).toBe(2); // Initial import plus one shared refresh, never two racing refreshes.
    pending.release();
    await Promise.all([first, second]);
    hold = false;
    terminalId = "new";
    await registry.refreshInventory("login");
    expect(registry.list().sessions[0].inventory.services[0].terminals[0].terminalId).toBe("new");
    expect(persistence.records.get("login")?.inventory.services[0].terminals[0].terminalId).toBe(
      "new",
    );
  });
});
