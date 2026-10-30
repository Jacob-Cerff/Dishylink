import { setDishHost } from "@core/dishClient";
import { setApiHost } from "./apiHost";
import { setCloudHost, noteCloudSessionChanged } from "./cloudHost";
import { resetRouterStatus } from "./routerStatusFeed";
import type { LocalHost } from "@core/localSource";
/** Bind before the local dashboard mounts; every transport captures its source lease. */
export function bindLocalDashboard(host: LocalHost, lease: string): () => void {
  const restoreApi = setApiHost({
    transport: async (path, init) => {
      const result = await host.request({
        kind: "api",
        lease,
        path,
        method: init?.method ?? "GET",
      });
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const restoreCloud = setCloudHost({
    transport: async (request) => {
      const result = await host.request({
        kind: "cloud",
        lease,
        path: request.path,
        method: request.method ?? "GET",
        body: request.body,
      });
      if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return result;
    },
    signIn: async () => ({ ok: false, message: "local.manageAccounts" }),
  });
  const restoreDish = setDishHost({
    fetch: async (input, init) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const url = String(input);
      const target = url.startsWith("/router/") ? "router" : "dish";
      const body = init?.body;
      const bytes =
        body instanceof Uint8Array
          ? body
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : null;
      if (!bytes) throw new Error("Invalid local frame");
      const result = await host.request({ kind: "lan", lease, target, bytes: Array.from(bytes) });
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (result.status !== 200) return new Response(null, { status: result.status });
      const reply = result.body as {
        status: number;
        headers: Record<string, string>;
        bytes: number[];
      };
      return new Response(new Uint8Array(reply.bytes), {
        status: reply.status,
        headers: reply.headers,
      });
    },
  });
  resetRouterStatus();
  noteCloudSessionChanged();
  return () => {
    restoreDish();
    restoreApi();
    restoreCloud();
    resetRouterStatus();
    noteCloudSessionChanged();
  };
}
