import { validAccountId } from "../core/accountContext";
import type { RemoteRefresh } from "../cloud/remoteRefresh";
import type { CloudResult } from "../cloud/starlinkCloudHandler";

interface Lifecycle {
  every(listener: () => void): () => void;
  onResume(listener: () => void): () => void;
  onSuspend(listener: () => void): () => void;
  isOnline(): boolean;
}
/** Lifecycle is injected so sleep/network/tray-independent work is testable headlessly. */
export function runRemoteMonitoring(
  engine: RemoteRefresh,
  subscribe: (listener: () => void) => () => void,
  lifecycle: Lifecycle,
): () => void {
  let stopped = false;
  let suspended = false;
  let online = lifecycle.isOnline();
  const pulse = () => {
    if (stopped || suspended) return;
    const next = lifecycle.isOnline();
    if (next) {
      if (!online) engine.wake();
      else engine.tick();
    }
    online = next;
  };
  const cleanup = [
    lifecycle.every(pulse),
    subscribe(pulse),
    lifecycle.onSuspend(() => {
      suspended = true;
    }),
    lifecycle.onResume(() => {
      if (stopped) return;
      suspended = false;
      online = lifecycle.isOnline();
      if (online) engine.wake();
    }),
  ];
  pulse();
  return () => {
    if (stopped) return;
    stopped = true;
    for (const stop of cleanup) stop();
    engine.close();
  };
}

export function restrictLiveAccountRead(value: unknown, packaged: boolean): boolean {
  const request = value as { kind?: unknown } | null;
  return packaged && Boolean(request && ["read", "refresh"].includes(String(request.kind)));
}

export async function handleRemoteRequest(
  value: unknown,
  engine: RemoteRefresh,
): Promise<CloudResult> {
  const bad = (): CloudResult => ({ status: 400, body: { error: "invalid_remote_request" } });
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const request = value as Record<string, unknown>;
  try {
    if (request.kind === "remote-cache") return engine.cached(request.context);
    if (request.kind === "remote-expectation") {
      if (
        typeof request.enabled !== "boolean" ||
        (request.reason !== undefined && typeof request.reason !== "string")
      )
        return bad();
      return engine.expectOffline(
        request.context,
        request.enabled,
        request.reason as string | undefined,
      );
    }
    if (!validAccountId(request.credentialId) || !validAccountId(request.accountId)) return bad();
    if (request.kind === "remote-refresh")
      return await engine.manual(request.credentialId, request.accountId);
    if (request.kind === "remote-settings" && typeof request.intervalHours === "number")
      return engine.configure(request.credentialId, request.accountId, request.intervalHours);
    return bad();
  } catch {
    return { status: 500, body: { error: "remote_operation_failed" } };
  }
}
