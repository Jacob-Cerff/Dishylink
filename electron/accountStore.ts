import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isAccountInventory, validAccountId } from "../core/accountContext";
import type { AccountStore, SavedCredential } from "../cloud/accountRegistry";

/** Inject Electron safeStorage in production; keep the persistence tests headless. */
export interface AccountEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function validRecord(value: unknown, id: string): value is SavedCredential {
  const record = value as SavedCredential | null;
  return Boolean(
    record &&
    record.credentialId === id &&
    validAccountId(id) &&
    typeof record.label === "string" &&
    record.label.length > 0 &&
    record.label.length <= 100 &&
    (record.cookie === null ||
      (typeof record.cookie === "string" &&
        record.cookie.length <= 65_536 &&
        !/[\r\n\0]/.test(record.cookie))) &&
    (record.state !== "connected" || Boolean(record.cookie)) &&
    ["connected", "disconnected", "reconnect-required"].includes(record.state) &&
    typeof record.tracking === "boolean" &&
    isAccountInventory(record.inventory),
  );
}

/** One encrypted, atomically replaced record per credential, outside the repository. */
export class EncryptedAccountStore implements AccountStore {
  constructor(
    private directory: string,
    private encryption: AccountEncryption,
  ) {}

  load(): SavedCredential[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory)
      .sort()
      .filter((name) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}\.bin$/.test(name))
      .map((name) => {
        const credentialId = name.slice(0, -4);
        try {
          if (!this.encryption.isEncryptionAvailable()) throw new Error("Encryption unavailable");
          const envelope = JSON.parse(
            this.encryption.decryptString(readFileSync(join(this.directory, name))),
          ) as { version?: unknown; credential?: unknown };
          if (envelope.version !== 1 || !validRecord(envelope.credential, credentialId))
            throw new Error("Invalid stored credential");
          return envelope.credential;
        } catch {
          // Keep the original file intact for recovery; never interpret it as plaintext.
          return {
            credentialId,
            label: "Saved sign-in",
            cookie: null,
            state: "reconnect-required",
            tracking: true,
            inventory: { accounts: [], services: [] },
          };
        }
      });
  }

  save(record: SavedCredential): void {
    if (!this.encryption.isEncryptionAvailable())
      throw new Error("OS encryption unavailable; session was not saved");
    if (!validRecord(record, record.credentialId)) throw new Error("Invalid credential record");
    const encrypted = this.encryption.encryptString(
      JSON.stringify({ version: 1, credential: record }),
    );
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, `${record.credentialId}.bin`);
    const temporary = join(this.directory, `.${record.credentialId}-${randomUUID()}.tmp`);
    writeFileSync(temporary, encrypted, { flag: "wx", mode: 0o600 });
    renameSync(temporary, target);
  }
}
