import { describe, expect, it } from "vitest";
import {
  migrateLegacyAccount,
  LEGACY_CREDENTIAL_ID,
  InvalidLegacySession,
} from "./legacyAccountMigration";
import { AccountRegistry, type SavedCredential } from "../cloud/accountRegistry";
function fixture() {
  const records = new Map<string, SavedCredential>();
  let complete = false;
  let reads = 0;
  let verify = true;
  let status = 200;
  const registry = new AccountRegistry({
    store: {
      load: () => [...records.values()],
      save: (r) => {
        records.set(r.credentialId, structuredClone(r));
      },
    },
    fetch: (async (input) =>
      status !== 200
        ? new Response(null, { status })
        : String(input).includes("auth-rp")
          ? Response.json({ accountId: "ACC-A" })
          : Response.json({ content: { results: [] } })) as typeof fetch,
  });
  const options = {
    registry,
    readLegacy: () => {
      reads++;
      return "Starlink.Com.Sso=fake";
    },
    completed: () => complete,
    verified: () => verify,
    markComplete: () => {
      complete = true;
    },
  };
  return {
    options,
    records,
    complete: () => complete,
    reads: () => reads,
    verification: (value: boolean) => {
      verify = value;
    },
    status: (value: number) => {
      status = value;
    },
  };
}
describe("legacy encrypted session migration", () => {
  it("surfaces corrupt ciphertext as reconnect-required while retaining the source", async () => {
    const f = fixture();
    f.options.readLegacy = () => {
      throw new InvalidLegacySession();
    };
    expect(await migrateLegacyAccount(f.options)).toBe("reconnect-required");
    expect(f.records.get(LEGACY_CREDENTIAL_ID)).toMatchObject({
      state: "reconnect-required",
      cookie: null,
    });
    expect(f.complete()).toBe(false);
  });
  it("retries temporarily unavailable encryption without creating a false expired account", async () => {
    const f = fixture();
    f.options.readLegacy = () => {
      throw new Error("Encryption unavailable");
    };
    expect(await migrateLegacyAccount(f.options)).toBe("retry");
    expect(f.records.size).toBe(0);
    expect(f.complete()).toBe(false);
  });
  it("validates and saves once before marking completion, retaining the original source", async () => {
    const f = fixture();
    expect(await migrateLegacyAccount(f.options)).toBe("complete");
    expect(f.records.get(LEGACY_CREDENTIAL_ID)?.state).toBe("connected");
    expect(f.complete()).toBe(true);
    await migrateLegacyAccount(f.options);
    expect(f.reads()).toBe(1);
  });
  it("retries an interrupted verified write without overwriting a newer connected login", async () => {
    const f = fixture();
    f.verification(false);
    expect(await migrateLegacyAccount(f.options)).toBe("retry");
    expect(f.complete()).toBe(false);
    const cookie = f.records.get(LEGACY_CREDENTIAL_ID)?.cookie;
    f.verification(true);
    expect(await migrateLegacyAccount(f.options)).toBe("complete");
    expect(f.reads()).toBe(1);
    expect(f.records.get(LEGACY_CREDENTIAL_ID)?.cookie).toBe(cookie);
  });
  it("keeps an invalid legacy session as reconnect-required without marking migration complete", async () => {
    const f = fixture();
    f.status(401);
    expect(await migrateLegacyAccount(f.options)).toBe("reconnect-required");
    expect(f.complete()).toBe(false);
    expect(f.records.get(LEGACY_CREDENTIAL_ID)).toMatchObject({
      state: "reconnect-required",
      cookie: null,
    });
    await migrateLegacyAccount(f.options);
    expect(f.reads()).toBe(1);
  });
  it("does not restore an explicitly disconnected migrated account", async () => {
    const f = fixture();
    await migrateLegacyAccount(f.options);
    f.options.registry.disconnect(LEGACY_CREDENTIAL_ID);
    await migrateLegacyAccount(f.options);
    expect(f.records.get(LEGACY_CREDENTIAL_ID)?.state).toBe("disconnected");
    expect(f.reads()).toBe(1);
  });
});
