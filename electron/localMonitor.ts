import { randomUUID } from "node:crypto";
import type { DishContext } from "../core/accountContext";
import { sameTerminal, terminalKey, type LocalState, type LocalReply } from "../core/localSource";
export interface Recorder {
  request(path: string, method: string): Promise<LocalReply>;
  configure(options: {
    controls: boolean;
    routerAddress?: string | null;
    context?: DishContext;
    routerId?: string;
  }): void;
  close(): Promise<void>;
}
interface Options {
  probe(signal: AbortSignal): Promise<string>;
  open(
    terminalId: string,
    generation: number,
    observe: (terminalId: string | null, routerId: string | null) => void,
  ): Promise<Recorder>;
  member(context: DishContext, terminalId: string): boolean;
  identity(context: DishContext): object | undefined;
  binding(context: DishContext, terminalId: string, routerId: string | null): boolean;
  changed?: (state: LocalState) => void;
}
const refused = (status = 409): LocalReply => ({
  status,
  body: { error: status === 403 ? "local_binding_required" : "local_source_changed" },
});
export class LocalMonitor {
  private snapshot: LocalState = {
    version: 1,
    status: "idle",
    terminalId: null,
    routerId: null,
    generation: 0,
    recording: false,
    controls: false,
    viewActive: false,
  };
  private recorder?: Recorder;
  private abort?: AbortController;
  private closing: Promise<void> = Promise.resolve();
  private view?: { lease: string; context?: DishContext; identity?: object; generation: number };
  private automation?: { context: DishContext; identity: object };
  constructor(private options: Options) {}
  state(): LocalState {
    return { ...this.snapshot };
  }
  private publish() {
    this.snapshot.viewActive = Boolean(this.view);
    this.snapshot.controls = Boolean(this.view?.context && this.current(this.view.lease, true));
    if (this.snapshot.controls && this.view?.context)
      this.automation = {
        context: structuredClone(this.view.context),
        identity: this.view.identity!,
      };
    this.recorder?.configure({
      controls: Boolean(this.automationContext()),
      context: this.automationContext(),
      routerId: this.snapshot.routerId ?? undefined,
    });
    this.options.changed?.(this.state());
  }
  private bound(context: DishContext) {
    return (
      this.snapshot.status === "ready" &&
      this.snapshot.terminalId !== null &&
      this.options.binding(context, this.snapshot.terminalId, this.snapshot.routerId)
    );
  }
  invalidate(status: LocalState["status"] = "changed") {
    this.abort?.abort();
    this.abort = undefined;
    this.snapshot = {
      ...this.snapshot,
      status,
      terminalId: null,
      routerId: null,
      generation: this.snapshot.generation + 1,
      recording: false,
      controls: false,
    };
    this.view = undefined;
    this.automation = undefined;
    const previous = this.recorder;
    this.recorder = undefined;
    if (previous) this.closing = this.closing.then(() => previous.close()).catch(() => {});
    this.publish();
  }
  disconnect() {
    this.invalidate("idle");
  }
  async connect(): Promise<LocalState> {
    this.invalidate("probing");
    const generation = this.snapshot.generation;
    const abort = new AbortController();
    this.abort = abort;
    await this.closing;
    try {
      if (abort.signal.aborted) return this.state();
      const raw = await this.options.probe(
        AbortSignal.any([abort.signal, AbortSignal.timeout(6000)]),
      );
      if (abort.signal.aborted || generation !== this.snapshot.generation) return this.state();
      const terminalId = raw.startsWith("ut") ? terminalKey(raw) : null;
      if (!terminalId) throw new Error("No dish identity");
      this.snapshot = { ...this.snapshot, status: "ready", terminalId };
      const recorder = await this.options.open(terminalId, generation, (dish, router) => {
        if (generation !== this.snapshot.generation) return;
        if (dish && !sameTerminal(dish, terminalId)) {
          this.invalidate();
          return;
        }
        if (router !== null) this.snapshot.routerId = router;
        this.publish();
      });
      if (abort.signal.aborted || generation !== this.snapshot.generation) {
        await recorder.close();
        return this.state();
      }
      this.recorder = recorder;
      this.snapshot.recording = true;
      this.publish();
    } catch {
      if (generation === this.snapshot.generation) {
        this.snapshot.status = "unreachable";
        this.snapshot.terminalId = null;
        this.publish();
      }
    }
    return this.state();
  }
  reconcile() {
    if (
      this.automation &&
      (!this.bound(this.automation.context) ||
        this.automation.identity !== this.options.identity(this.automation.context))
    )
      this.automation = undefined;
    if (
      this.view?.context &&
      (!this.snapshot.terminalId ||
        !this.options.member(this.view.context, this.snapshot.terminalId) ||
        this.view.identity !== this.options.identity(this.view.context))
    ) {
      this.view = undefined;
      this.snapshot.authorizationGeneration = (this.snapshot.authorizationGeneration ?? 0) + 1;
    }
    this.publish();
  }
  select(context?: DishContext): string | null {
    if (
      this.snapshot.status !== "ready" ||
      !this.recorder ||
      (context &&
        (!sameTerminal(context.terminalId, this.snapshot.terminalId) ||
          !this.snapshot.terminalId ||
          !this.options.member(context, this.snapshot.terminalId) ||
          !this.options.identity(context)))
    )
      return null;
    const lease = randomUUID();
    this.view = {
      lease,
      context: context ? structuredClone(context) : undefined,
      identity: context ? this.options.identity(context) : undefined,
      generation: this.snapshot.generation,
    };
    this.publish();
    return lease;
  }
  leave(lease: string) {
    if (this.view?.lease === lease) {
      this.view = undefined;
      this.publish();
    }
  }
  observe(dish: string | null, router: string | null) {
    if (this.snapshot.status !== "ready") return;
    if (
      (dish && !sameTerminal(dish, this.snapshot.terminalId)) ||
      (this.snapshot.routerId && router && this.snapshot.routerId !== router)
    ) {
      this.invalidate();
      return;
    }
    if (router && router !== this.snapshot.routerId) {
      this.snapshot.routerId = router;
      this.publish();
    }
  }
  leaveAll() {
    this.view = undefined;
    this.publish();
  }
  current(lease: string, write = false): boolean {
    return Boolean(
      this.view?.lease === lease &&
      this.view.generation === this.snapshot.generation &&
      this.snapshot.status === "ready" &&
      (!this.view.context ||
        (this.view.identity === this.options.identity(this.view.context) &&
          this.snapshot.terminalId &&
          this.options.member(this.view.context, this.snapshot.terminalId))) &&
      (!write || (this.view.context && this.bound(this.view.context))),
    );
  }
  context(lease: string): DishContext | undefined {
    return this.current(lease, true) ? this.view?.context : undefined;
  }
  automationContext(): DishContext | undefined {
    return this.automation &&
      this.bound(this.automation.context) &&
      this.automation.identity === this.options.identity(this.automation.context)
      ? structuredClone(this.automation.context)
      : undefined;
  }
  async guarded(
    lease: string,
    write: boolean,
    run: () => Promise<LocalReply>,
  ): Promise<LocalReply> {
    if (!this.current(lease)) return refused();
    if (write && !this.current(lease, true)) return refused(403);
    try {
      const result = await run();
      return this.current(lease, write) ? result : refused();
    } catch {
      return { status: 503, body: { error: "local_request_failed" } };
    }
  }
  async api(lease: string, path: string, method = "GET"): Promise<LocalReply> {
    if (
      typeof path !== "string" ||
      !/^\/api\/[A-Za-z0-9/_-]+(?:\?[^#\r\n]*)?$/.test(path) ||
      !["GET", "POST", "DELETE"].includes(method)
    )
      return { status: 400, body: { error: "invalid_local_request" } };
    return this.guarded(lease, method !== "GET", async () => {
      const reply = await this.recorder!.request(path, method);
      return {
        ...reply,
        body:
          reply.body && typeof reply.body === "object" && !Array.isArray(reply.body)
            ? {
                ...(reply.body as Record<string, unknown>),
                recordingSource: { kind: "lan", terminalId: this.snapshot.terminalId },
              }
            : reply.body,
      };
    });
  }
}
