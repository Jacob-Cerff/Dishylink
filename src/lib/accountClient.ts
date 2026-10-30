import type { AccountRequest, AccountChange } from "@core/accountBridge";
import type { DishContext } from "@core/accountContext";
import { isAccountInventory, validAccountId } from "@core/accountContext";
import type { CredentialSummary } from "../../cloud/accountRegistry";
import type { RemoteSnapshot, RefreshState, OfflineExpectation } from "@core/remoteTelemetry";
export type AccountTransport = (
  request: AccountRequest,
) => Promise<{ status: number; body: unknown }>;
export type { AccountChange } from "@core/accountBridge";
export interface CachedRemote {
  snapshot: RemoteSnapshot | null;
  refresh: RefreshState;
  overdue: boolean;
  expectation: OfflineExpectation;
  storageError?: boolean;
}
export interface QueryState<T> {
  data?: T;
  loading: boolean;
  error?: string;
}
export class AccountQuery<T> {
  private state: QueryState<T> = { loading: false };
  private listeners = new Set<() => void>();
  private pending?: Promise<void>;
  private generation = 0;
  private recheck = false;
  constructor(private read: () => Promise<T>) {}
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: QueryState<T>) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  clear() {
    this.generation++;
    this.recheck = false;
    this.pending = undefined;
    this.publish({ loading: false });
  }
  get observed() {
    return this.listeners.size > 0;
  }
  load(force = false): Promise<void> {
    if (this.pending) {
      if (force) this.recheck = true;
      return this.pending;
    }
    if (!force && this.state.data !== undefined) return Promise.resolve();
    const generation = this.generation;
    this.publish({ ...this.state, loading: true, error: undefined });
    this.pending = this.read()
      .then(
        (data) => {
          if (generation === this.generation) this.publish({ data, loading: false });
        },
        () => {
          if (generation === this.generation)
            this.publish({ ...this.state, loading: false, error: "unavailable" });
        },
      )
      .finally(() => {
        if (generation === this.generation) {
          this.pending = undefined;
          if (this.recheck) {
            this.recheck = false;
            return this.load(true);
          }
        }
      });
    return this.pending;
  }
}
function sessions(body: unknown): CredentialSummary[] {
  const value = (body as { sessions?: unknown } | null)?.sessions;
  if (
    !Array.isArray(value) ||
    !value.every(
      (s) =>
        s &&
        validAccountId(s.credentialId) &&
        typeof s.label === "string" &&
        ["connected", "disconnected", "reconnect-required"].includes(s.state) &&
        typeof s.tracking === "boolean" &&
        isAccountInventory(s.inventory),
    )
  )
    throw new Error("Invalid connections");
  return value;
}
function cachedRemote(body: unknown, context: DishContext): CachedRemote {
  const value = body as CachedRemote | null;
  const number = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const snapshot = value?.snapshot;
  const refresh = value?.refresh;
  if (
    !value ||
    !refresh ||
    refresh.accountId !== context.accountId ||
    !validAccountId(refresh.credentialId) ||
    !number(refresh.nextDueAt) ||
    ![2, 4, 6, 12, 24].includes(refresh.intervalHours) ||
    typeof value.overdue !== "boolean" ||
    typeof value.expectation?.enabled !== "boolean" ||
    (value.expectation.reason !== undefined && typeof value.expectation.reason !== "string") ||
    snapshot === undefined
  )
    throw new Error("Invalid cache");
  if (
    snapshot !== null &&
    (snapshot.accountId !== context.accountId ||
      snapshot.serviceLineNumber !== context.serviceLineNumber ||
      snapshot.terminalId !== context.terminalId ||
      !validAccountId(snapshot.credentialId) ||
      snapshot.source !== "cloud" ||
      !["online", "offline", "unknown"].includes(snapshot.status) ||
      !number(snapshot.fetchedAt) ||
      (snapshot.observedAt !== null && !number(snapshot.observedAt)) ||
      !Array.isArray(snapshot.routers))
  )
    throw new Error("Invalid snapshot target");
  return value;
}
export class AccountClient {
  readonly inventory: AccountQuery<CredentialSummary[]>;
  private remotes = new Map<string, { context: DishContext; query: AccountQuery<CachedRemote> }>();
  constructor(readonly request: AccountTransport) {
    this.inventory = new AccountQuery(async () => sessions(await this.read({ kind: "list" })));
  }
  private async read(input: AccountRequest) {
    const reply = await this.request(input);
    if (reply.status !== 200) throw new Error("Unavailable");
    return reply.body;
  }
  remote(context: DishContext): AccountQuery<CachedRemote> {
    const key = JSON.stringify([
      context.credentialId,
      context.accountId,
      context.serviceLineNumber,
      context.terminalId,
    ]);
    let entry = this.remotes.get(key);
    if (!entry) {
      entry = {
        context: { ...context },
        query: new AccountQuery(async () =>
          cachedRemote(await this.read({ kind: "remote-cache", context }), context),
        ),
      };
      this.remotes.set(key, entry);
    }
    return entry.query;
  }
  invalidate(event: AccountChange) {
    if (event.kind === "sessions") {
      this.inventory.clear();
      for (const { query } of this.remotes.values()) query.clear();
      if (this.inventory.observed) void this.inventory.load();
    } else
      for (const { context, query } of this.remotes.values())
        if (context.accountId === event.accountId && query.observed) void query.load(true);
  }
  async mutate(input: AccountRequest) {
    const reply = await this.request(input);
    if (["sign-in", "import", "rename", "disconnect", "tracking"].includes(input.kind))
      this.invalidate({ kind: "sessions" });
    else if ("accountId" in input)
      this.invalidate({ kind: "snapshots", accountId: input.accountId });
    else if ("context" in input)
      this.invalidate({ kind: "snapshots", accountId: input.context.accountId });
    return reply;
  }
  /** Reads host cache only. This never calls a cloud read or manual refresh. */
  refreshObserved() {
    if (this.inventory.observed) void this.inventory.load(true);
    for (const { query } of this.remotes.values()) if (query.observed) void query.load(true);
  }
}
