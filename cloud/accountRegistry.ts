import { randomUUID } from "node:crypto";
import {
  assertDishContext,
  mergeAccountAccess,
  validAccountId,
  type AccountInventory,
  type DishContext,
} from "../core/accountContext";
import {
  createCloudHandler,
  SessionExpiredError,
  cloudReadFailure,
  type CloudResult,
} from "./starlinkCloudHandler";

export type CredentialState = "connected" | "disconnected" | "reconnect-required";
export interface SavedCredential {
  credentialId: string;
  label: string;
  cookie: string | null;
  inventory: AccountInventory;
  state: CredentialState;
  tracking: boolean;
}
export interface AccountStore {
  load(): SavedCredential[];
  save(record: SavedCredential): void;
}
export type CredentialSummary = Omit<SavedCredential, "cookie">;
export interface ImportSession {
  credentialId?: string;
  label: string;
  cookie: string;
}
type Entry = SavedCredential & {
  token: object;
  identity: object;
  handler: ReturnType<typeof createCloudHandler>;
  abort: AbortController;
};
const result = (status: number, error: string): CloudResult => ({ status, body: { error } });

/** Host-only registry. Never hand an Entry/SavedCredential to the renderer. */
export class AccountRegistry {
  private entries = new Map<string, Entry>();
  private generations = new Map<string, number>();
  private candidates = new Map<string, Entry>();
  private inventoryRefreshes = new Map<Entry, Promise<CloudResult>>();
  private fetch: typeof fetch;
  private store: AccountStore;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Isolate subscribers. */
      }
    }
  }
  sessionToken(id: string): object | undefined {
    return this.entries.get(id)?.token;
  }
  sessionIdentity(id: string): object | undefined {
    return this.entries.get(id)?.identity;
  }
  isCurrentSession(id: string, token: object | undefined): boolean {
    const entry = this.entries.get(id);
    return Boolean(entry && entry.token === token && entry.tracking && entry.state === "connected");
  }

  constructor(options: { store: AccountStore; fetch?: typeof fetch }) {
    this.store = options.store;
    const transport = options.fetch ?? fetch;
    this.fetch = (input, init) =>
      transport(input, {
        ...init,
        signal: AbortSignal.any([
          AbortSignal.timeout(12_000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      });
    for (const record of this.store.load()) {
      if (!validAccountId(record.credentialId) || this.entries.has(record.credentialId))
        throw new Error("Invalid saved session index");
      this.entries.set(record.credentialId, this.entry(structuredClone(record)));
    }
  }

  private entry(record: SavedCredential): Entry {
    const entry = { ...record } as Entry;
    entry.token = {};
    entry.identity = {};
    entry.abort = new AbortController();
    entry.handler = createCloudHandler({
      fetch: (input, init) =>
        this.fetch(input, {
          ...init,
          signal: AbortSignal.any([entry.abort.signal, ...(init?.signal ? [init.signal] : [])]),
        }),
      readCookie: () => entry.cookie,
      retryDelayMs: 0,
    });
    return entry;
  }
  private generation(id: string): number {
    return this.generations.get(id) ?? 0;
  }
  private advance(id: string): number {
    const generation = this.generation(id) + 1;
    this.generations.set(id, generation);
    return generation;
  }
  private saved(entry: SavedCredential): SavedCredential {
    return {
      credentialId: entry.credentialId,
      label: entry.label,
      cookie: entry.cookie,
      inventory: entry.inventory,
      state: entry.state,
      tracking: entry.tracking,
    };
  }
  has(id: string): boolean {
    return this.entries.has(id);
  }
  cancelPending(id: string): void {
    this.advance(id);
    const entry = this.entries.get(id);
    if (entry) entry.token = {};
    this.candidates.get(id)?.abort.abort();
    this.candidates.delete(id);
  }

  list(): { sessions: CredentialSummary[]; accounts: ReturnType<typeof mergeAccountAccess> } {
    const sessions = [...this.entries.values()].map((entry) => ({
      credentialId: entry.credentialId,
      label: entry.label,
      inventory: entry.inventory,
      state: entry.state,
      tracking: entry.tracking,
    }));
    return structuredClone({ sessions, accounts: mergeAccountAccess(sessions) });
  }

  async importSession(input: ImportSession): Promise<CloudResult> {
    const id = input?.credentialId ?? randomUUID();
    if (
      !validAccountId(id) ||
      typeof input?.label !== "string" ||
      !input.label.trim() ||
      input.label.length > 100 ||
      typeof input?.cookie !== "string" ||
      input.cookie.length > 65_536 ||
      /[\r\n\0]/.test(input.cookie) ||
      !/(?:^|;\s*)Starlink\.Com\.Sso=[^;\s]+/.test(input.cookie)
    )
      return result(400, "invalid_session_import");
    this.cancelPending(id);
    const generation = this.generation(id);
    const candidate = this.entry({
      credentialId: id,
      label: input.label.trim(),
      cookie: input.cookie.trim(),
      inventory: { accounts: [], services: [] },
      state: "connected",
      tracking: this.entries.get(id)?.tracking ?? true,
    });
    this.candidates.set(id, candidate);
    try {
      candidate.inventory = await candidate.handler.inventory();
      if (generation !== this.generation(id)) return result(409, "session_changed");
      // One atomic encrypted record is committed only after successful validation.
      candidate.tracking = this.entries.get(id)?.tracking ?? candidate.tracking;
      try {
        this.store.save(this.saved(candidate));
      } catch {
        return result(500, "session_store_failed");
      }
      const previous = this.entries.get(id);
      if (previous) {
        previous.cookie = null;
        previous.abort.abort();
      }
      this.entries.set(id, candidate);
      this.changed();
      return { status: 200, body: { credentialId: id } };
    } catch (error) {
      if (generation !== this.generation(id)) return result(409, "session_changed");
      return result(
        error instanceof SessionExpiredError ? 428 : 502,
        error instanceof SessionExpiredError ? "reconnect_required" : "session_validation_failed",
      );
    } finally {
      if (this.candidates.get(id) === candidate) this.candidates.delete(id);
      if (this.entries.get(id) !== candidate) candidate.abort.abort();
    }
  }

  disconnect(id: string): CloudResult {
    const entry = this.entries.get(id);
    if (!entry) return result(404, "unknown_session");
    this.cancelPending(id);
    try {
      this.store.save({ ...this.saved(entry), cookie: null, state: "disconnected" });
      entry.cookie = null;
      entry.state = "disconnected";
      entry.abort.abort();
      this.changed();
      return { status: 200, body: { ok: true } };
    } catch {
      return result(500, "session_store_failed");
    }
  }

  rename(id: string, label: unknown): CloudResult {
    const entry = this.entries.get(id);
    if (!entry) return result(404, "unknown_session");
    if (
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 100 ||
      Array.from(label).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      return result(400, "invalid_label");
    const name = label.trim();
    if (entry.label === name) return { status: 200, body: { ok: true } };
    try {
      this.store.save({ ...this.saved(entry), label: name });
      entry.label = name;
      this.changed();
      return { status: 200, body: { ok: true } };
    } catch {
      return result(500, "session_store_failed");
    }
  }

  setTracking(id: string, tracking: boolean): CloudResult {
    const entry = this.entries.get(id);
    if (!entry) return result(404, "unknown_session");
    if (typeof tracking !== "boolean") return result(400, "invalid_tracking_state");
    if (entry.tracking === tracking) return { status: 200, body: { ok: true } };
    try {
      this.store.save({ ...this.saved(entry), tracking });
      entry.tracking = tracking;
      entry.token = {};
      this.changed();
      return { status: 200, body: { ok: true } };
    } catch {
      return result(500, "session_store_failed");
    }
  }

  refreshInventory(id: string): Promise<CloudResult> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve(result(404, "unknown_session"));
    const existing = this.inventoryRefreshes.get(entry);
    if (existing) return existing;
    const promise = this.performInventoryRefresh(id, entry).finally(() => {
      if (this.inventoryRefreshes.get(entry) === promise) this.inventoryRefreshes.delete(entry);
    });
    this.inventoryRefreshes.set(entry, promise);
    return promise;
  }

  private async performInventoryRefresh(id: string, entry: Entry): Promise<CloudResult> {
    if (!entry.cookie || entry.state !== "connected") return result(428, "reconnect_required");
    const generation = this.generation(id);
    try {
      const inventory = await entry.handler.inventory();
      if (generation !== this.generation(id) || this.entries.get(id) !== entry)
        return result(409, "session_changed");
      this.store.save({ ...this.saved(entry), inventory });
      entry.inventory = inventory;
      this.changed();
      return { status: 200, body: { inventory: structuredClone(inventory) } };
    } catch (error) {
      if (generation !== this.generation(id) || this.entries.get(id) !== entry)
        return result(409, "session_changed");
      if (error instanceof SessionExpiredError) return this.expired(entry);
      return cloudReadFailure(error);
    }
  }

  private expired(entry: Entry): CloudResult {
    try {
      this.store.save({ ...this.saved(entry), state: "reconnect-required" });
    } catch {
      return result(500, "session_store_failed");
    }
    entry.state = "reconnect-required";
    this.changed();
    return result(428, "reconnect_required");
  }

  async read(id: string, route: string, context: unknown): Promise<CloudResult> {
    if (!["/cloud/account", "/cloud/telemetry", "/cloud/usage"].includes(route))
      return result(400, "unsupported_account_read");
    const entry = this.entries.get(id);
    if (!entry) return result(404, "unknown_session");
    try {
      assertDishContext(context, id, entry.inventory);
    } catch {
      return result(403, "invalid_account_target");
    }
    if (!entry.cookie || entry.state !== "connected") return result(428, "reconnect_required");
    const generation = this.generation(id);
    const reply = await entry.handler.readScoped(route, context as DishContext, entry.inventory);
    if (generation !== this.generation(id) || this.entries.get(id) !== entry)
      return result(409, "session_changed");
    try {
      assertDishContext(context, id, entry.inventory);
    } catch {
      return result(409, "inventory_changed");
    }
    if (reply.status === 428) return this.expired(entry);
    return reply;
  }

  /** Trusted host batch read: one account payload, never one fetch per terminal. */
  async collectAccount(id: string, accountId: string): Promise<CloudResult> {
    const entry = this.entries.get(id);
    if (!entry) return result(404, "unknown_session");
    if (!entry.inventory.accounts.some((account) => account.accountId === accountId))
      return result(403, "invalid_account_target");
    if (!entry.cookie || entry.state !== "connected") return result(428, "reconnect_required");
    const token = entry.token;
    const inventory = entry.inventory;
    const reply = await entry.handler.accountTelemetry(accountId);
    if (this.entries.get(id) !== entry || entry.token !== token || entry.inventory !== inventory)
      return result(409, "session_changed");
    if (reply.status === 428) return this.expired(entry);
    return reply;
  }
}
