import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EncryptedAccountStore } from "./accountStore";
import type { SavedCredential } from "../cloud/accountRegistry";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const path = mkdtempSync(join(tmpdir(), "dishylink-accounts-"));
  directories.push(path);
  return path;
}
function encryption() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(value: Buffer) {
      const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
}
const record: SavedCredential = {
  credentialId: "login-a",
  label: "Office",
  cookie: "Starlink.Com.Sso=secret-a",
  inventory: { accounts: [], services: [] },
  tracking: true,
  state: "connected",
};

describe("encrypted per-login storage", () => {
  it("reloads both sessions and never puts the cookie in plaintext on disk", () => {
    const path = directory();
    const crypto = encryption();
    let store = new EncryptedAccountStore(path, crypto);
    store.save(record);
    store.save({ ...record, credentialId: "login-b", cookie: "Starlink.Com.Sso=secret-b" });
    for (const file of readdirSync(path))
      expect(readFileSync(join(path, file)).includes(Buffer.from("Starlink.Com.Sso="))).toBe(false);
    store = new EncryptedAccountStore(path, crypto);
    expect(store.load().map((r) => r.cookie)).toEqual([
      "Starlink.Com.Sso=secret-a",
      "Starlink.Com.Sso=secret-b",
    ]);
    store.save({ ...record, cookie: null, state: "disconnected" });
    expect(store.load().find((r) => r.credentialId === "login-b")?.cookie).toBe(
      "Starlink.Com.Sso=secret-b",
    );
  });
  it("refuses plaintext fallback and preserves existing records if encryption fails", () => {
    const path = directory();
    const crypto = encryption();
    const store = new EncryptedAccountStore(path, crypto);
    store.save(record);
    const before = readFileSync(join(path, "login-a.bin"));
    crypto.isEncryptionAvailable = () => false;
    expect(() => store.save({ ...record, cookie: "replacement" })).toThrow(/encryption/i);
    expect(readFileSync(join(path, "login-a.bin"))).toEqual(before);
    expect(store.load()[0].state).toBe("reconnect-required");
  });
  it("retains corrupt/foreign-key records as reconnect-required instead of discarding them", () => {
    const path = directory();
    const store = new EncryptedAccountStore(path, encryption());
    writeFileSync(join(path, "login-a.bin"), "corrupt");
    writeFileSync(join(path, ".interrupted.tmp"), "unfinished");
    expect(store.load()).toEqual([
      { ...record, label: "Saved sign-in", cookie: null, state: "reconnect-required" },
    ]);
  });
  it("rejects path traversal and schema-mismatched stored identities", () => {
    const path = directory();
    const crypto = encryption();
    const store = new EncryptedAccountStore(path, crypto);
    expect(() => store.save({ ...record, credentialId: "../escape" })).toThrow();
    writeFileSync(
      join(path, "login-a.bin"),
      crypto.encryptString(
        JSON.stringify({ version: 1, credential: { ...record, credentialId: "login-b" } }),
      ),
    );
    expect(store.load()[0]).toMatchObject({
      credentialId: "login-a",
      state: "reconnect-required",
      cookie: null,
    });
  });
});
