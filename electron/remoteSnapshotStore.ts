import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validAccountId } from "../core/accountContext";
import {
  RETENTION_MS,
  REFRESH_HOURS,
  type RefreshState,
  type RefreshAttempt,
  type RemoteSnapshot,
  type OfflineExpectation,
} from "../core/remoteTelemetry";

export interface RemoteAccountRecord {
  version: 1;
  accountId: string;
  state: RefreshState;
  snapshots: RemoteSnapshot[];
  attempts: RefreshAttempt[];
  expectations: Record<string, OfflineExpectation>;
}
export interface RemoteStore {
  get(accountId: string, credentialId: string): RemoteAccountRecord;
  save(record: RemoteAccountRecord): void;
  prune(): void;
  credentialBackoff(credentialId: string): number;
  saveCredentialBackoff(credentialId: string, until: number): void;
}

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const errors = ["success", "auth", "rate-limited", "network", "invalid-data", "storage"];
function valid(value: unknown, id: string): value is RemoteAccountRecord {
  const record = value as RemoteAccountRecord | null;
  return Boolean(
    record &&
    record.version === 1 &&
    record.accountId === id &&
    validAccountId(id) &&
    record.state &&
    record.state.accountId === id &&
    validAccountId(record.state.credentialId) &&
    (REFRESH_HOURS as readonly number[]).includes(record.state.intervalHours) &&
    isNumber(record.state.nextDueAt) &&
    Number.isSafeInteger(record.state.retryCount) &&
    record.state.retryCount >= 0 &&
    [
      record.state.lastAttemptAt,
      record.state.lastManualAt,
      record.state.lastSuccessAt,
      record.state.backoffUntil,
    ].every((v) => v === undefined || isNumber(v)) &&
    (record.state.lastObservedAt == null || isNumber(record.state.lastObservedAt)) &&
    (record.state.error === undefined || errors.includes(record.state.error)) &&
    Array.isArray(record.snapshots) &&
    record.snapshots.every(
      (s) =>
        s &&
        s.accountId === id &&
        validAccountId(s.credentialId) &&
        validAccountId(s.serviceLineNumber) &&
        validAccountId(s.terminalId) &&
        s.source === "cloud" &&
        ["online", "offline", "unknown"].includes(s.status) &&
        isNumber(s.fetchedAt) &&
        (s.observedAt === null || isNumber(s.observedAt)) &&
        Array.isArray(s.routers) &&
        [...s.routers, ...(s.dish ? [s.dish] : [])].every(
          (d) =>
            d &&
            typeof d.deviceId === "string" &&
            ["dish", "router"].includes(d.kind) &&
            (d.observedAt === null || isNumber(d.observedAt)) &&
            Object.keys(d).every((key) =>
              [
                "deviceId",
                "kind",
                "observedAt",
                "uptimeS",
                "softwareVersion",
                "hardwareVersion",
                "obstructionFraction",
                "signalQuality",
                "clients",
                "hops",
                "isRepeater",
                "isBypassed",
              ].includes(key),
            ),
        ),
    ) &&
    Array.isArray(record.attempts) &&
    record.attempts.every((a) => a && isNumber(a.at) && errors.includes(a.outcome)) &&
    record.expectations &&
    typeof record.expectations === "object" &&
    !Array.isArray(record.expectations) &&
    Object.values(record.expectations).every(
      (e) =>
        e &&
        typeof e.enabled === "boolean" &&
        (e.reason === undefined || (typeof e.reason === "string" && e.reason.length <= 200)),
    ),
  );
}
function atomicWrite(target: string, contents: string): void {
  const temporary = `${target}-${randomUUID()}.tmp`;
  writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
  renameSync(temporary, target);
}
function observationKey(snapshot: RemoteSnapshot): string {
  const { fetchedAt: _time, credentialId: _credential, ...observation } = snapshot;
  return JSON.stringify(observation);
}

/** Independent of LAN recordings. Each account's cache/attempts/state commit together. */
export class RemoteSnapshotStore implements RemoteStore {
  private records = new Map<string, RemoteAccountRecord>();
  private unreadable = new Set<string>();
  private credentialDeadlines = new Map<string, number>();
  private unreadableCredentials = new Set<string>();
  constructor(
    private directory: string,
    private now: () => number = Date.now,
    private write = atomicWrite,
  ) {
    if (!existsSync(directory)) return;
    for (const filename of readdirSync(directory)) {
      const credentialFile = filename.match(
        /^credential-([A-Za-z0-9][A-Za-z0-9_-]{0,159})\.backoff\.json$/,
      );
      if (credentialFile) {
        const id = credentialFile[1];
        try {
          const value = JSON.parse(readFileSync(join(directory, filename), "utf8")) as {
            version?: unknown;
            credentialId?: unknown;
            until?: unknown;
          };
          if (value.version !== 1 || value.credentialId !== id || !isNumber(value.until))
            throw new Error("Invalid credential deadline");
          this.credentialDeadlines.set(id, value.until);
        } catch {
          this.unreadableCredentials.add(id);
        }
        continue;
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}\.json$/.test(filename)) continue;
      const id = filename.slice(0, -5);
      try {
        const record: unknown = JSON.parse(readFileSync(join(directory, filename), "utf8"));
        if (!valid(record, id)) throw new Error("Invalid remote cache");
        this.records.set(id, record);
      } catch {
        this.unreadable.add(id);
      }
    }
  }
  credentialBackoff(credentialId: string): number {
    if (!validAccountId(credentialId) || this.unreadableCredentials.has(credentialId))
      throw new Error("Credential deadline unavailable");
    return this.credentialDeadlines.get(credentialId) ?? 0;
  }
  saveCredentialBackoff(credentialId: string, until: number): void {
    if (!isNumber(until)) throw new Error("Invalid credential deadline");
    const deadline = Math.max(this.credentialBackoff(credentialId), until);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.write(
      join(this.directory, `credential-${credentialId}.backoff.json`),
      JSON.stringify({ version: 1, credentialId, until: deadline }),
    );
    this.credentialDeadlines.set(credentialId, deadline);
  }
  get(accountId: string, credentialId: string): RemoteAccountRecord {
    if (
      !validAccountId(accountId) ||
      !validAccountId(credentialId) ||
      this.unreadable.has(accountId)
    )
      throw new Error("Remote cache unavailable");
    return structuredClone(
      this.records.get(accountId) ?? {
        version: 1,
        accountId,
        snapshots: [],
        attempts: [],
        expectations: {},
        state: { accountId, credentialId, intervalHours: 2, nextDueAt: 0, retryCount: 0 },
      },
    );
  }
  save(input: RemoteAccountRecord): void {
    if (!valid(input, input.accountId) || this.unreadable.has(input.accountId))
      throw new Error("Invalid remote cache");
    const record = structuredClone(input);
    const cutoff = this.now() - RETENTION_MS;
    const observations = new Map<string, RemoteSnapshot>();
    for (const snapshot of record.snapshots) {
      if (snapshot.fetchedAt < cutoff) continue;
      const key = observationKey(snapshot);
      if (!observations.has(key) || observations.get(key)!.fetchedAt < snapshot.fetchedAt)
        observations.set(key, snapshot);
    }
    record.snapshots = [...observations.values()].sort((a, b) => a.fetchedAt - b.fetchedAt);
    record.attempts = record.attempts.filter((a) => a.at >= cutoff);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.write(join(this.directory, `${record.accountId}.json`), JSON.stringify(record));
    this.records.set(record.accountId, record);
  }
  prune(): void {
    const cutoff = this.now() - RETENTION_MS;
    for (const record of this.records.values())
      if (
        record.snapshots.some((s) => s.fetchedAt < cutoff) ||
        record.attempts.some((a) => a.at < cutoff)
      )
        this.save(record);
  }
}
