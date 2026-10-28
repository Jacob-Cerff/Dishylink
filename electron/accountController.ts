import { randomUUID } from "node:crypto";
import { validAccountId } from "../core/accountContext";
import type { AccountRegistry } from "../cloud/accountRegistry";
import type { CloudResult } from "../cloud/starlinkCloudHandler";

export type AccountLogin = (
  partition: string,
  adopt: (cookie: string) => Promise<CloudResult>,
  signal: AbortSignal,
) => Promise<CloudResult>;

const refusal = (status: number, error: string): CloudResult => ({ status, body: { error } });

export function trustedAccountFrame(
  url: string,
  expectedUrl: string,
  mainWindow: boolean,
  mainFrame: boolean,
): boolean {
  if (!mainWindow || !mainFrame) return false;
  try {
    const actual = new URL(url);
    const expected = new URL(expectedUrl);
    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      (expected.protocol === "app:" || actual.origin === expected.origin)
    );
  } catch {
    return false;
  }
}

/** Shared by the native sign-in and IPC entry points; all inputs are runtime checked. */
export class AccountController {
  private pending = new Map<string, { abort: AbortController; promise: Promise<CloudResult> }>();
  constructor(
    private options: {
      registry: AccountRegistry;
      login: AccountLogin;
      clearPartition: (partition: string) => Promise<void>;
    },
  ) {}

  async handle(input: unknown): Promise<CloudResult> {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return refusal(400, "invalid_account_request");
    const request = input as Record<string, unknown>;
    const { registry } = this.options;
    if (request.credentialId !== undefined && !validAccountId(request.credentialId))
      return refusal(400, "invalid_session_id");
    const id = request.credentialId as string | undefined;
    try {
      if (request.kind === "list") return { status: 200, body: registry.list() };
      if (request.kind === "import") {
        if (typeof request.label !== "string" || typeof request.cookie !== "string")
          return refusal(400, "invalid_session_import");
        if (id && !registry.has(id)) return refusal(404, "unknown_session");
        if (id) await this.cancelSignIn(id);
        return registry.importSession({
          credentialId: id,
          label: request.label,
          cookie: request.cookie,
        });
      }
      if (request.kind === "sign-in") {
        if (
          request.label !== undefined &&
          (typeof request.label !== "string" || !request.label.trim() || request.label.length > 100)
        )
          return refusal(400, "invalid_label");
        if (id && !registry.has(id)) return refusal(404, "unknown_session");
        const label =
          (request.label as string | undefined) ??
          registry.list().sessions.find((s) => s.credentialId === id)?.label ??
          "Starlink sign-in";
        return this.signIn(id ?? randomUUID(), label);
      }
      if (!["disconnect", "tracking", "refresh", "read"].includes(String(request.kind)) || !id)
        return refusal(400, "invalid_account_request");
      if (request.kind === "disconnect") {
        await this.cancelSignIn(id);
        const reply = registry.disconnect(id);
        if (reply.status === 200) await this.options.clearPartition(`persist:starlink-login-${id}`);
        return reply;
      }
      if (request.kind === "tracking") {
        if (typeof request.enabled !== "boolean") return refusal(400, "invalid_tracking_state");
        return registry.setTracking(id, request.enabled);
      }
      if (request.kind === "refresh") return registry.refreshInventory(id);
      if (typeof request.route !== "string") return refusal(400, "invalid_account_read");
      return registry.read(id, request.route, request.context);
    } catch {
      return refusal(500, "account_operation_failed");
    }
  }

  private async cancelSignIn(id: string): Promise<void> {
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.abort.abort();
    // Its cleanup invalidates pending imports. Finish that cleanup before a replacement starts.
    await pending.promise;
  }

  private signIn(id: string, label: string): Promise<CloudResult> {
    const existing = this.pending.get(id);
    if (existing) return existing.promise;
    const abort = new AbortController();
    let connected = false;
    // An explicit reconnect starts a fresh native login. A previous cookie import
    // may represent another user than the browser jar; never silently adopt that jar.
    const promise = this.options
      .clearPartition(`persist:starlink-login-${id}`)
      .then(() => {
        if (abort.signal.aborted) return { status: 499, body: { error: "sign_in_cancelled" } };
        return this.options.login(
          `persist:starlink-login-${id}`,
          (cookie) => {
            if (abort.signal.aborted) return Promise.resolve(refusal(409, "session_changed"));
            return this.options.registry.importSession({ credentialId: id, label, cookie });
          },
          abort.signal,
        );
      })
      .then(
        (reply) => {
          connected = reply.status === 200;
          return reply;
        },
        () => refusal(502, "sign_in_failed"),
      )
      .finally(() => {
        if (!connected) this.options.registry.cancelPending(id);
        if (this.pending.get(id)?.abort === abort) this.pending.delete(id);
      });
    this.pending.set(id, { abort, promise });
    return promise;
  }
}
