import { assertDishContext, validAccountId, type DishContext } from "../core/accountContext";
import {
  accountSnapshots,
  HOUR_MS,
  MANUAL_COOLDOWN_MS,
  REFRESH_HOURS,
  type AccountTelemetry,
  type RefreshError,
} from "../core/remoteTelemetry";
import type { RemoteStore } from "../electron/remoteSnapshotStore";
import type { CredentialSummary } from "./accountRegistry";
import type { CloudResult } from "./starlinkCloudHandler";

export interface RemoteRegistry {
  list(): { sessions: CredentialSummary[] };
  sessionToken(id: string): object | undefined;
  sessionIdentity?(id: string): object | undefined;
  refreshInventory(id: string): Promise<CloudResult>;
  collectAccount(id: string, accountId: string): Promise<CloudResult>;
}
interface Target {
  credentialId: string;
  accountId: string;
  token: object;
}
interface Job extends Target {
  started: boolean;
  membership?: string;
  promise: Promise<CloudResult>;
  resolve: (reply: CloudResult) => void;
}
const reply = (status: number, error: string, retryAfterMs?: number): CloudResult => ({
  status,
  body: { error, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
});

/** Clock-driven host service: no renderer, LAN, hidden windows or extra polling source. */
export class RemoteRefresh {
  private registry: RemoteRegistry;
  private store: RemoteStore;
  private now: () => number;
  private random: () => number;
  private seen = new Map<string, object>();
  private identities = new Map<string, object>();
  private credentialIds = new Map<string, string>();
  private inventoryAt = new Map<string, { token: object; at: number }>();
  private jobs = new Map<string, Job>();
  private busy = new Set<string>();
  private active = 0;
  private stopped = false;
  private lastPrune = -Infinity;
  private faults = new Map<string, number>();
  private credentialDeadlines = new Map<string, number>();

  constructor(options: {
    registry: RemoteRegistry;
    store: RemoteStore;
    now?: () => number;
    random?: () => number;
  }) {
    this.registry = options.registry;
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }
  private jitter(): number {
    return Math.floor(this.random() * 30_000);
  }
  private credentialDeadline(id: string): number {
    return Math.max(this.credentialDeadlines.get(id) ?? 0, this.store.credentialBackoff(id));
  }
  private session(id: string) {
    return this.registry.list().sessions.find((s) => s.credentialId === id);
  }
  private member(id: string, account: string): boolean {
    return (
      validAccountId(id) &&
      validAccountId(account) &&
      Boolean(this.session(id)?.inventory.accounts.some((a) => a.accountId === account))
    );
  }
  private targets(): Target[] {
    const sessions = this.registry
      .list()
      .sessions.filter((s) => s.state === "connected" && s.tracking);
    const accounts = new Map<string, Target>();
    for (const session of sessions)
      for (const account of session.inventory.accounts) {
        const token = this.registry.sessionToken(session.credentialId);
        if (!token) continue;
        try {
          const preferred = this.store.get(account.accountId, session.credentialId).state
            .credentialId;
          if (!accounts.has(account.accountId) || preferred === session.credentialId)
            accounts.set(account.accountId, {
              accountId: account.accountId,
              credentialId: session.credentialId,
              token,
            });
        } catch {
          this.faults.set(account.accountId, this.now() + MANUAL_COOLDOWN_MS);
        }
      }
    return [...accounts.values()];
  }
  private reconcile(): Target[] {
    const targets = this.targets();
    for (const target of targets) {
      try {
        const record = this.store.get(target.accountId, target.credentialId);
        const previous = this.seen.get(target.accountId);
        const identity = this.registry.sessionIdentity?.(target.credentialId) ?? target.token;
        if (previous !== target.token) {
          const changed =
            (previous !== undefined &&
              this.credentialIds.get(target.accountId) === target.credentialId &&
              this.identities.get(target.accountId) !== identity) ||
            record.state.error === "auth";
          record.state.credentialId = target.credentialId;
          if (changed || record.state.nextDueAt === 0) {
            record.state.nextDueAt = this.now() + this.jitter();
            record.state.retryCount = 0;
            if (record.state.error === "auth") {
              delete record.state.backoffUntil;
              delete record.state.error;
            }
          } else if (record.state.nextDueAt <= this.now())
            record.state.nextDueAt = this.now() + this.jitter();
          this.store.save(record);
          this.seen.set(target.accountId, target.token);
          this.identities.set(target.accountId, identity);
          this.credentialIds.set(target.accountId, target.credentialId);
        }
      } catch {
        this.faults.set(target.accountId, this.now() + MANUAL_COOLDOWN_MS);
      }
    }
    return targets;
  }
  tick(): void {
    if (this.stopped) return;
    const now = this.now();
    if (now - this.lastPrune >= 24 * HOUR_MS) {
      try {
        this.store.prune();
      } catch {
        /* Isolated from other accounts. */
      }
      this.lastPrune = now;
    }
    for (const target of this.reconcile()) {
      if (this.jobs.has(target.accountId) || (this.faults.get(target.accountId) ?? 0) > now)
        continue;
      try {
        const state = this.store.get(target.accountId, target.credentialId).state;
        if (
          now >=
          Math.max(
            state.nextDueAt,
            state.backoffUntil ?? 0,
            this.credentialDeadline(target.credentialId),
          )
        )
          this.enqueue(target);
      } catch {
        this.faults.set(target.accountId, now + MANUAL_COOLDOWN_MS);
      }
    }
    this.drain();
  }
  wake(): void {
    if (this.stopped) return;
    for (const target of this.reconcile()) {
      if (this.jobs.has(target.accountId)) continue;
      try {
        const record = this.store.get(target.accountId, target.credentialId);
        if (record.state.nextDueAt <= this.now()) {
          record.state.nextDueAt = this.now() + this.jitter();
          this.store.save(record);
        }
      } catch {
        this.faults.set(target.accountId, this.now() + MANUAL_COOLDOWN_MS);
      }
    }
    this.tick();
  }
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.all([...this.jobs.values()].map((job) => job.promise));
  }
  close(): void {
    this.stopped = true;
    for (const job of this.jobs.values())
      if (!job.started) {
        this.jobs.delete(job.accountId);
        job.resolve(reply(409, "monitoring_stopped"));
      }
  }
  private enqueue(target: Target): Job {
    let resolve!: Job["resolve"];
    const promise = new Promise<CloudResult>((r) => {
      resolve = r;
    });
    const job: Job = { ...target, started: false, promise, resolve };
    this.jobs.set(target.accountId, job);
    return job;
  }
  private membership(job: Target): string {
    return JSON.stringify(
      this.session(job.credentialId)
        ?.inventory.services.filter((s) => s.accountId === job.accountId)
        .map((s) => [s.serviceLineNumber, s.terminals]),
    );
  }
  private valid(job: Job, allowAuthFailure = false): boolean {
    const session = this.session(job.credentialId);
    return (
      !this.stopped &&
      this.registry.sessionToken(job.credentialId) === job.token &&
      Boolean(session?.tracking) &&
      (allowAuthFailure || session?.state === "connected") &&
      this.member(job.credentialId, job.accountId) &&
      (job.membership === undefined || job.membership === this.membership(job)) &&
      this.store.get(job.accountId, job.credentialId).state.credentialId === job.credentialId
    );
  }
  private drain(): void {
    for (const job of this.jobs.values()) {
      if (this.active >= 2 || this.stopped) break;
      if (job.started || this.busy.has(job.credentialId)) continue;
      let valid = false;
      try {
        valid = this.valid(job);
      } catch {
        /* A corrupt store is not an empty cache. */
      }
      if (!valid) {
        this.jobs.delete(job.accountId);
        job.resolve(reply(409, "session_changed"));
        continue;
      }
      try {
        const until = this.credentialDeadline(job.credentialId);
        if (until > this.now()) {
          const record = this.store.get(job.accountId, job.credentialId);
          record.state.backoffUntil = Math.max(record.state.backoffUntil ?? 0, until);
          record.state.nextDueAt = Math.max(record.state.nextDueAt, until);
          record.state.error = "rate-limited";
          this.store.save(record);
          this.jobs.delete(job.accountId);
          job.resolve(reply(429, "credential_backoff", until - this.now()));
          continue;
        }
      } catch {
        this.jobs.delete(job.accountId);
        job.resolve(reply(500, "remote_store_failed"));
        continue;
      }
      job.started = true;
      this.active++;
      this.busy.add(job.credentialId);
      void this.run(job)
        .catch(() => {
          this.faults.set(job.accountId, this.now() + MANUAL_COOLDOWN_MS);
          return reply(500, "remote_store_failed");
        })
        .then((result) => {
          this.jobs.delete(job.accountId);
          this.active--;
          this.busy.delete(job.credentialId);
          job.resolve(result);
          this.drain();
        });
    }
  }
  private async run(job: Job): Promise<CloudResult> {
    const before = this.store.get(job.accountId, job.credentialId);
    before.state.lastAttemptAt = this.now();
    this.store.save(before);
    const inventory = this.inventoryAt.get(job.credentialId);
    let result: CloudResult = { status: 200, body: {} };
    let credentialFailure = false;
    if (
      !inventory ||
      inventory.token !== job.token ||
      this.now() - inventory.at >= MANUAL_COOLDOWN_MS
    ) {
      result = await this.registry.refreshInventory(job.credentialId);
      credentialFailure = result.status !== 200;
      if (result.status === 200)
        this.inventoryAt.set(job.credentialId, { token: job.token, at: this.now() });
    }
    if (!this.valid(job, result.status === 428)) return reply(409, "session_changed");
    job.membership = this.membership(job);
    if (result.status === 200)
      result = await this.registry.collectAccount(job.credentialId, job.accountId);
    if (!this.valid(job, result.status === 428) || result.status === 409)
      return reply(409, "session_changed");
    const record = this.store.get(job.accountId, job.credentialId);
    const now = this.now();
    const state = record.state;
    if (result.status === 200) {
      const telemetry = result.body as AccountTelemetry;
      if (!telemetry?.devices || typeof telemetry.incomplete !== "boolean")
        result = reply(502, "invalid_telemetry");
      else {
        const snapshots = accountSnapshots(
          job.credentialId,
          job.accountId,
          this.session(job.credentialId)!.inventory,
          telemetry,
          now,
        );
        record.snapshots.push(...snapshots);
        state.lastSuccessAt = now;
        const times = snapshots.flatMap((s) => (s.observedAt === null ? [] : [s.observedAt]));
        state.lastObservedAt = times.length ? Math.max(...times) : null;
        state.nextDueAt = now + state.intervalHours * HOUR_MS + this.jitter();
        state.retryCount = 0;
        delete state.backoffUntil;
        delete state.error;
        record.attempts.push({ at: now, outcome: "success" });
        this.store.save(record);
        this.faults.delete(job.accountId);
        return { status: 200, body: { refreshed: true } };
      }
    }
    const body = result.body as {
      retryAfterMs?: unknown;
      error?: string;
      credentialScoped?: boolean;
    } | null;
    const error: RefreshError =
      result.status === 428
        ? "auth"
        : result.status === 429
          ? "rate-limited"
          : body?.error === "invalid_telemetry"
            ? "invalid-data"
            : "network";
    state.error = error;
    const attempt = state.retryCount + 1;
    const retryAfter =
      typeof body?.retryAfterMs === "number" &&
      Number.isFinite(body.retryAfterMs) &&
      body.retryAfterMs >= 0
        ? body.retryAfterMs
        : 0;
    const retryDelay = Math.min(30 * 60_000, 30_000 * 2 ** (attempt - 1)) + this.jitter();
    state.backoffUntil = now + Math.max(retryAfter, retryDelay);
    state.nextDueAt = Math.max(
      state.backoffUntil,
      now + (error === "auth" || attempt >= 3 ? state.intervalHours * HOUR_MS : retryDelay),
    );
    if (
      (credentialFailure || body?.credentialScoped) &&
      (error === "rate-limited" || retryAfter > 0)
    ) {
      this.credentialDeadlines.set(
        job.credentialId,
        Math.max(this.credentialDeadline(job.credentialId), state.backoffUntil),
      );
      this.store.saveCredentialBackoff(job.credentialId, state.backoffUntil);
    }
    state.retryCount = attempt >= 3 || error === "auth" ? 0 : attempt;
    record.attempts.push({ at: now, outcome: error });
    this.store.save(record);
    return result;
  }
  manual(credentialId: string, accountId: string): Promise<CloudResult> {
    if (this.stopped) return Promise.resolve(reply(503, "monitoring_stopped"));
    if (!this.member(credentialId, accountId))
      return Promise.resolve(reply(403, "invalid_account_target"));
    const session = this.session(credentialId)!;
    if (session.state !== "connected") return Promise.resolve(reply(428, "reconnect_required"));
    if (!session.tracking) return Promise.resolve(reply(409, "tracking_stopped"));
    try {
      const target = this.reconcile().find(
        (t) => t.accountId === accountId && t.credentialId === credentialId,
      );
      if (!target) return Promise.resolve(reply(409, "preferred_session_required"));
      const record = this.store.get(accountId, credentialId);
      const state = record.state;
      const until = Math.max(
        this.credentialDeadline(credentialId),
        state.backoffUntil ?? 0,
        state.lastManualAt === undefined ? 0 : state.lastManualAt + MANUAL_COOLDOWN_MS,
        this.faults.get(accountId) ?? 0,
      );
      const existing = this.jobs.get(accountId);
      if (existing && existing.credentialId === credentialId && existing.token === target.token) {
        if (
          state.lastManualAt === undefined ||
          this.now() >= state.lastManualAt + MANUAL_COOLDOWN_MS
        ) {
          state.lastManualAt = this.now();
          this.store.save(record);
        }
        return existing.promise;
      }
      if (this.now() < until)
        return Promise.resolve(reply(429, "refresh_cooldown", until - this.now()));
      state.lastManualAt = this.now();
      this.store.save(record);
      const job = this.enqueue(target);
      this.drain();
      return job.promise;
    } catch {
      return Promise.resolve(reply(500, "remote_store_failed"));
    }
  }
  configure(credentialId: string, accountId: string, intervalHours: number): CloudResult {
    if (!this.member(credentialId, accountId)) return reply(403, "invalid_account_target");
    if (!(REFRESH_HOURS as readonly number[]).includes(intervalHours))
      return reply(400, "invalid_refresh_interval");
    try {
      const record = this.store.get(accountId, credentialId);
      if (
        record.state.credentialId === credentialId &&
        record.state.intervalHours === intervalHours
      )
        return { status: 200, body: { refresh: record.state } };
      record.state.credentialId = credentialId;
      record.state.intervalHours = intervalHours;
      record.state.nextDueAt =
        record.state.lastAttemptAt === undefined
          ? 0
          : record.state.lastAttemptAt + intervalHours * HOUR_MS;
      record.state.nextDueAt = Math.max(
        record.state.nextDueAt,
        record.state.backoffUntil ?? 0,
        this.credentialDeadline(credentialId),
      );
      this.store.save(record);
      return { status: 200, body: { refresh: record.state } };
    } catch {
      return reply(500, "remote_store_failed");
    }
  }
  private context(value: unknown): DishContext | undefined {
    const context = value as DishContext | null;
    const session = context && this.session(context.credentialId);
    if (!session) return undefined;
    try {
      assertDishContext(context, session.credentialId, session.inventory);
      return context!;
    } catch {
      return undefined;
    }
  }
  cached(value: unknown): CloudResult {
    const context = this.context(value);
    if (!context) return reply(403, "invalid_account_target");
    try {
      const record = this.store.get(context.accountId, context.credentialId);
      const deadline = this.credentialDeadline(record.state.credentialId);
      if (deadline > this.now()) {
        record.state.backoffUntil = Math.max(record.state.backoffUntil ?? 0, deadline);
        record.state.nextDueAt = Math.max(record.state.nextDueAt, deadline);
      }
      const snapshot =
        record.snapshots
          .filter(
            (s) =>
              s.serviceLineNumber === context.serviceLineNumber &&
              s.terminalId === context.terminalId,
          )
          .at(-1) ?? null;
      return {
        status: 200,
        body: {
          snapshot,
          refresh: record.state,
          overdue: this.now() > record.state.nextDueAt + 15 * 60_000,
          expectation: record.expectations[context.terminalId] ?? { enabled: false },
          ...(this.faults.has(context.accountId) ? { storageError: true } : {}),
        },
      };
    } catch {
      return reply(500, "remote_store_failed");
    }
  }
  expectOffline(value: unknown, enabled: boolean, reason?: string): CloudResult {
    const context = this.context(value);
    if (!context) return reply(403, "invalid_account_target");
    if (
      typeof enabled !== "boolean" ||
      (reason !== undefined &&
        (typeof reason !== "string" || reason.length > 200 || /[\r\n\0]/.test(reason)))
    )
      return reply(400, "invalid_offline_expectation");
    try {
      const record = this.store.get(context.accountId, context.credentialId);
      const key = context.terminalId;
      if (enabled)
        record.expectations[key] = {
          enabled,
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        };
      else delete record.expectations[key];
      this.store.save(record);
      return { status: 200, body: { ok: true } };
    } catch {
      return reply(500, "remote_store_failed");
    }
  }
}
