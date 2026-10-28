import { useEffect, useState } from "react";
import type { AccountRequest } from "@core/accountBridge";
import { isAccountInventory, validAccountId } from "@core/accountContext";
import type { CredentialSummary } from "../../../cloud/accountRegistry";
import { Button } from "../ui/button";

/** This test surface can only sign in or read; it cannot dispatch device settings. */
export type AccountTestRequest = Extract<
  AccountRequest,
  { kind: "list" | "sign-in" | "refresh" | "read" | "remote-cache" | "remote-refresh" }
>;
type Reply = { status: number; body: unknown };
type Transport = (request: AccountTestRequest) => Promise<Reply>;

class DisplayError extends Error {}
function check(reply: Reply, operation: string): void {
  if (reply.status === 200) return;
  if (reply.status === 499)
    throw new DisplayError("Sign-in cancelled. Saved connections are unchanged.");
  const code = (reply.body as { error?: unknown } | null)?.error;
  const suffix = typeof code === "string" && /^[a-z_]{1,80}$/.test(code) ? `: ${code}` : "";
  throw new DisplayError(`${operation} did not complete (HTTP ${reply.status}${suffix}).`);
}
function sessionList(body: unknown): CredentialSummary[] {
  const value = (body as { sessions?: unknown } | null)?.sessions;
  if (
    !Array.isArray(value) ||
    !value.every(
      (session) =>
        session &&
        validAccountId(session.credentialId) &&
        typeof session.label === "string" &&
        ["connected", "disconnected", "reconnect-required"].includes(session.state) &&
        typeof session.tracking === "boolean" &&
        isAccountInventory(session.inventory),
    )
  )
    throw new Error("Invalid session list");
  return value as CredentialSummary[];
}

export function AccountTestPanel({ request }: { request: Transport }) {
  const [sessions, setSessions] = useState<CredentialSummary[]>([]);
  const [busy, setBusy] = useState<string | null>("Loading saved sign-ins…");
  const [message, setMessage] = useState("Ready for two separate Starlink logins.");
  const [error, setError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<{ title: string; body: unknown } | null>(null);

  useEffect(() => {
    let active = true;
    request({ kind: "list" })
      .then((reply) => {
        check(reply, "Loading saved connections");
        const next = sessionList(reply.body);
        if (active) setSessions(next);
      })
      .catch(() => {
        if (active)
          setError("The app could not load saved connections. Try Reload saved connections.");
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [request]);

  async function loadSaved() {
    const reply = await request({ kind: "list" });
    check(reply, "Loading saved connections");
    setSessions(sessionList(reply.body));
  }
  async function run(label: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(
        failure instanceof DisplayError
          ? failure.message
          : "The app could not complete this request. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  function signIn(label: string) {
    const existing = sessions.find((session) => session.label === label);
    void run(`Waiting for ${label} sign-in…`, async () => {
      const reply = await request({
        kind: "sign-in",
        label,
        ...(existing ? { credentialId: existing.credentialId } : {}),
      });
      check(reply, `${label} sign-in`);
      await loadSaved();
      setMessage(`${label} connected. You can sign in the other account or read a dish below.`);
    });
  }

  return (
    <main className='h-screen overflow-y-auto bg-background p-6 text-foreground sm:p-10'>
      <div className='mx-auto flex max-w-5xl flex-col gap-6'>
        <header className='flex flex-col gap-3 border-b border-border pb-6'>
          <p className='text-xs font-semibold uppercase tracking-widest text-muted-foreground'>
            Dishylink · Development only
          </p>
          <h1 className='text-3xl font-semibold'>Read-only account test</h1>
          <p className='max-w-3xl text-sm leading-relaxed text-muted-foreground'>
            Sign in with two separate Starlink logins. Credentials go directly into Starlink’s own
            windows. This panel reads account inventory and telemetry on demand. A local dish is not
            required.
          </p>
          <div className='flex flex-wrap gap-3'>
            {["Account A", "Account B"].map((label) => (
              <Button key={label} disabled={Boolean(busy)} onClick={() => signIn(label)}>
                {sessions.some((session) => session.label === label) ? "Reconnect" : "Sign in"}{" "}
                {label}
              </Button>
            ))}
            <Button
              variant='outline'
              disabled={Boolean(busy)}
              onClick={() => {
                void run("Loading saved connections…", async () => {
                  await loadSaved();
                  setMessage("Saved connections reloaded.");
                });
              }}
            >
              Reload saved connections
            </Button>
          </div>
          <p role='status' aria-live='polite' className='text-sm'>
            {busy ?? message}
          </p>
          {error && (
            <p
              role='alert'
              className='rounded-lg border border-red-500/40 p-3 text-sm text-red-400'
            >
              {error}
            </p>
          )}
        </header>

        {sessions.length === 0 && !busy && (
          <p className='text-muted-foreground'>No saved sign-ins yet.</p>
        )}
        {sessions.map((session) => (
          <section
            key={session.credentialId}
            className='flex flex-col gap-4 rounded-xl border border-border bg-card p-5'
          >
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h2 className='text-xl font-semibold'>{session.label}</h2>
                <p className='text-sm text-muted-foreground'>
                  {session.state} · {session.inventory.accounts.length} account(s) ·{" "}
                  {session.inventory.services.length} service(s)
                </p>
              </div>
              <Button
                variant='outline'
                disabled={Boolean(busy) || session.state !== "connected"}
                onClick={() => {
                  void run(`Refreshing ${session.label} inventory…`, async () => {
                    check(
                      await request({ kind: "refresh", credentialId: session.credentialId }),
                      "Inventory refresh",
                    );
                    await loadSaved();
                    setMessage(`${session.label} inventory refreshed.`);
                  });
                }}
              >
                Refresh inventory
              </Button>
            </div>
            {session.inventory.accounts.map((account) => (
              <Button
                key={account.accountId}
                variant='outline'
                aria-label={`Refresh snapshots for ${account.accountId} (${session.label})`}
                disabled={Boolean(busy) || session.state !== "connected"}
                onClick={() => {
                  void run(`Refreshing ${session.label} snapshots…`, async () => {
                    check(
                      await request({
                        kind: "remote-refresh",
                        credentialId: session.credentialId,
                        accountId: account.accountId,
                      }),
                      "Snapshot refresh",
                    );
                    setMessage(
                      "Snapshot refresh complete. Read a cached snapshot below to see the result and next refresh time.",
                    );
                  });
                }}
              >
                Refresh snapshots · {account.accountId}
              </Button>
            ))}
            {session.inventory.services.length === 0 && (
              <p className='text-sm text-muted-foreground'>
                No services were returned for this sign-in.
              </p>
            )}
            {session.inventory.services.map((service) => (
              <div
                key={`${service.accountId}/${service.serviceLineNumber}`}
                className='flex flex-col gap-3 border-t border-border pt-4'
              >
                <p className='text-sm'>
                  {service.nickname ?? service.serviceLineNumber} · {service.accountId}
                </p>
                {service.terminals.length === 0 && (
                  <p className='text-sm text-muted-foreground'>
                    No dishes were returned for this service.
                  </p>
                )}
                {service.terminals.map((terminal) => (
                  <div
                    key={terminal.terminalId}
                    className='flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3'
                  >
                    <span className='break-all font-mono text-xs'>{terminal.terminalId}</span>
                    <Button
                      variant='outline'
                      aria-label={`Read cached snapshot for ${terminal.terminalId} (${session.label})`}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        void run(`Loading ${session.label} cached snapshot…`, async () => {
                          const reply = await request({
                            kind: "remote-cache",
                            context: {
                              credentialId: session.credentialId,
                              accountId: service.accountId,
                              serviceLineNumber: service.serviceLineNumber,
                              terminalId: terminal.terminalId,
                            },
                          });
                          check(reply, "Cached snapshot");
                          setTelemetry({
                            title: `${session.label} · Cached snapshot · ${terminal.terminalId}`,
                            body: reply.body,
                          });
                          setMessage(
                            "Cached snapshot loaded without a network read. Times are Unix milliseconds; refresh cooldown is enforced by the host.",
                          );
                        });
                      }}
                    >
                      Read cached snapshot
                    </Button>
                    <Button
                      variant='secondary'
                      aria-label={`Read telemetry for ${terminal.terminalId} (${session.label})`}
                      disabled={Boolean(busy) || session.state !== "connected"}
                      onClick={() => {
                        setTelemetry(null);
                        void run(`Reading ${session.label} telemetry…`, async () => {
                          const reply = await request({
                            kind: "read",
                            credentialId: session.credentialId,
                            route: "/cloud/telemetry",
                            context: {
                              credentialId: session.credentialId,
                              accountId: service.accountId,
                              serviceLineNumber: service.serviceLineNumber,
                              terminalId: terminal.terminalId,
                            },
                          });
                          check(reply, "Telemetry read");
                          setTelemetry({
                            title: `${session.label} · ${terminal.terminalId}`,
                            body: reply.body,
                          });
                          setMessage(
                            "Telemetry read complete. Values are a remote snapshot, not a live LAN feed.",
                          );
                        });
                      }}
                    >
                      Read telemetry
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))}

        {telemetry && (
          <section className='rounded-xl border border-border bg-card p-5'>
            <h2 className='mb-3 text-lg font-semibold'>{telemetry.title}</h2>
            {Boolean(
              telemetry.body &&
              typeof telemetry.body === "object" &&
              "deviceTelemetry" in telemetry.body,
            ) && (
              <p className='mb-3 text-sm text-muted-foreground'>
                activeAlerts contains raw Starlink alert codes. Meanings and severity are not yet
                assigned. An empty array is a reported empty list; an absent field means
                unavailable.
              </p>
            )}
            <pre
              aria-label='Telemetry result'
              className='max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs leading-relaxed'
            >
              {JSON.stringify(telemetry.body, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}
