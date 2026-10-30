import { sameTerminal, terminalKey, routerKey } from "./localSource";
export interface RecordingCall {
  target: "dish" | "router";
  startedAt: number;
  receivedAt: number;
}
export class RecordingProofUnavailable extends Error {}
export class RecordingIdentity {
  blocked = false;
  private routerId: string | null = null;
  private proofs = { dish: -Infinity, router: -Infinity };
  private pending = new Set<{
    target: "dish" | "router";
    after: number;
    resolve: () => void;
    reject: () => void;
  }>();
  constructor(private terminalId: string) {}
  async verify(value: Record<string, unknown>, call: RecordingCall): Promise<void> {
    try {
      this.observe(value, call.target);
    } catch (error) {
      for (const pending of this.pending) pending.reject();
      throw error;
    }
    const record = call.target === "dish" ? value.dishGetStatus : value.wifiGetStatus;
    const info = (record ?? value.getDeviceInfo) as { deviceInfo?: { id?: unknown } } | undefined;
    if (info?.deviceInfo?.id !== undefined) {
      this.proofs[call.target] = Math.max(this.proofs[call.target], call.startedAt);
      for (const pending of this.pending) {
        if (
          this.proofs.dish >= pending.after &&
          (pending.target === "dish" || this.proofs.router >= pending.after)
        )
          pending.resolve();
      }
      return;
    }
    // A previously started status reply cannot authorize a newer, identity-free sample.
    // Wait for the already scheduled status reads; do not discover or poll another router.
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.pending.delete(pending);
        if (error) reject(error);
        else resolve();
      };
      const pending = {
        target: call.target,
        after: call.receivedAt,
        resolve: () => finish(),
        reject: () => finish(new Error("Recording identity changed")),
      };
      const timer = setTimeout(
        () => finish(new RecordingProofUnavailable("Local identity proof unavailable")),
        12000,
      );
      this.pending.add(pending);
    });
  }
  observe(
    value: Record<string, unknown>,
    target: "dish" | "router" = "dish",
  ): { terminalId: string; routerId: string | null } {
    if (this.blocked) throw new Error("Recording identity changed");
    const info = (record: unknown) =>
      typeof record === "object" && record !== null
        ? (record as { deviceInfo?: { id?: unknown } }).deviceInfo?.id
        : undefined;
    const dish =
      info(value.dishGetStatus) ?? (target === "dish" ? info(value.getDeviceInfo) : undefined);
    const router =
      info(value.wifiGetStatus) ?? (target === "router" ? info(value.getDeviceInfo) : undefined);
    if (dish !== undefined && !sameTerminal(dish, this.terminalId)) {
      this.blocked = true;
      throw new Error("Recording identity changed");
    }
    if (router !== undefined) {
      const key = routerKey(router);
      if (!key || (this.routerId && this.routerId !== key)) {
        this.blocked = true;
        throw new Error("Recording router changed");
      }
      this.routerId = key;
    }
    if (!terminalKey(this.terminalId)) {
      this.blocked = true;
      throw new Error("Invalid recording identity");
    }
    return { terminalId: this.terminalId, routerId: this.routerId };
  }
}
