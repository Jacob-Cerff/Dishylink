import type { CloudResult } from "../cloud/starlinkCloudHandler";

export interface LoginHost {
  readCookie(): Promise<string | null>;
  onCookieChanged(listener: () => void): () => void;
  createWindow(): {
    onReady(listener: () => void): void;
    onClosed(listener: () => void): void;
    load(): void;
    destroy(): void;
  };
}
const cancelled = (): CloudResult => ({ status: 499, body: { error: "sign_in_cancelled" } });

/** Owns one native login lifecycle. The caller invalidates pending imports on cancellation. */
export async function runAccountLogin(
  host: LoginHost,
  adopt: (cookie: string) => Promise<CloudResult>,
  signal: AbortSignal,
  retryDelayMs = 700,
): Promise<CloudResult> {
  if (signal.aborted) return cancelled();
  try {
    const cookie = await host.readCookie();
    if (signal.aborted) return cancelled();
    if (cookie) {
      const reply = await adopt(cookie);
      if (signal.aborted) return cancelled();
      if (reply.status === 200) return reply;
    }
  } catch {
    return { status: 502, body: { error: "sign_in_unavailable" } };
  }

  return new Promise((resolve) => {
    const window = host.createWindow();
    let finished = false;
    let adopting = false;
    let changedWhileBusy = false;
    let unsubscribe = () => {};
    const abort = () => finish(cancelled());
    function finish(reply: CloudResult) {
      if (finished) return;
      finished = true;
      unsubscribe();
      signal.removeEventListener("abort", abort);
      window.destroy();
      resolve(reply);
    }
    async function tryAdopt() {
      if (finished) return;
      if (adopting) {
        changedWhileBusy = true;
        return;
      }
      adopting = true;
      try {
        for (let attempt = 0; attempt < 4 && !finished; attempt++) {
          if (attempt > 0 && retryDelayMs)
            await new Promise((wait) => setTimeout(wait, retryDelayMs));
          if (finished) return;
          const cookie = await host.readCookie();
          if (finished || !cookie) return;
          const reply = await adopt(cookie);
          if (finished) return;
          if (
            reply.status === 200 ||
            (reply.status >= 400 && reply.status < 500 && reply.status !== 428)
          ) {
            finish(reply);
            return;
          }
          if (reply.status >= 500) return; // Let a later cookie/load event retry a network failure.
          if (attempt === 3) finish(reply);
        }
      } catch {
        // A network failure must not become an unhandled rejection or reveal cookie data.
      } finally {
        adopting = false;
        if (changedWhileBusy && !finished) {
          changedWhileBusy = false;
          void tryAdopt();
        }
      }
    }
    window.onClosed(() => finish(cancelled()));
    window.onReady(() => {
      void tryAdopt();
    });
    unsubscribe = host.onCookieChanged(() => {
      void tryAdopt();
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    window.load();
  });
}
