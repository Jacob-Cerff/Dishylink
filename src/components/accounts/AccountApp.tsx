import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CredentialSummary } from "../../../cloud/accountRegistry";
import type { AccountClient, AccountChange } from "../../lib/accountClient";
import { useAccountQuery } from "../../hooks/useAccountInventory";
import { useAccountRoute } from "../../hooks/useAccountRoute";
import { useTheme } from "../../hooks/useTheme";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { AccountsHome } from "./AccountsHome";
import { AccountDishesView } from "./AccountDishesView";
import { AccountConnectionDialog } from "./AccountConnectionDialog";
import { RemoteDishView } from "./RemoteDishView";
interface Props {
  client: AccountClient;
  localView: ReactNode;
  subscribe?: (listener: (event: AccountChange) => void) => () => void;
  onOpenAccounts?: (listener: () => void) => () => void;
}
export function AccountApp({ client, localView, subscribe, onOpenAccounts }: Props) {
  const { t } = useTranslation();
  const { cycleTheme } = useTheme();
  const inventory = useAccountQuery(client.inventory);
  const sessions = inventory.data ?? [];
  const { route, navigate } = useAccountRoute();
  const [local, setLocal] = useState(route.kind === "local");
  const [connection, setConnection] = useState<CredentialSummary | "new">();
  const [disconnect, setDisconnect] = useState<CredentialSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const [access, setAccess] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const cache = setInterval(() => client.refreshObserved(), 30000);
    return () => {
      clearInterval(timer);
      clearInterval(cache);
    };
  }, [client]);
  useEffect(() => subscribe?.((event) => client.invalidate(event)), [client, subscribe]);
  useEffect(
    () =>
      onOpenAccounts?.(() => {
        setLocal(false);
        navigate({ kind: "accounts" });
      }),
    [onOpenAccounts, navigate],
  );
  async function changeTracking(session: CredentialSummary) {
    setBusy(true);
    setError(undefined);
    try {
      const reply = await client.mutate({
        kind: "tracking",
        credentialId: session.credentialId,
        enabled: !session.tracking,
      });
      if (reply.status !== 200) setError(t("accounts.operationFailed"));
    } catch {
      setError(t("accounts.operationFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function confirmDisconnect() {
    if (!disconnect) return;
    setBusy(true);
    setError(undefined);
    try {
      const reply = await client.mutate({
        kind: "disconnect",
        credentialId: disconnect.credentialId,
      });
      if (reply.status !== 200) setError(t("accounts.operationFailed"));
      else setDisconnect(undefined);
    } catch {
      setError(t("accounts.operationFailed"));
    } finally {
      setBusy(false);
    }
  }
  const accountId =
    route.kind === "account" || route.kind === "service" ? route.accountId : undefined;
  const candidates = sessions.filter((s) =>
    s.inventory.accounts.some((a) => a.accountId === accountId),
  );
  const selected =
    candidates.find((s) => s.credentialId === access[accountId ?? ""]) ??
    candidates.find((s) => s.state === "connected" && s.tracking) ??
    candidates.find((s) => s.state === "connected") ??
    candidates[0];
  const services = selected?.inventory.services.filter((s) => s.accountId === accountId) ?? [];
  const service =
    route.kind === "service"
      ? services.find((s) => s.serviceLineNumber === route.serviceLineNumber)
      : undefined;
  const terminal =
    route.kind === "service"
      ? route.terminalId
        ? service?.terminals.find((d) => d.terminalId === route.terminalId)
        : service?.terminals.length === 1
          ? service.terminals[0]
          : undefined
      : undefined;
  if (local)
    return (
      <>
        <div className='relative z-50 bg-card p-3'>
          <Button
            variant='outline'
            onClick={() => {
              setLocal(false);
              navigate({ kind: "accounts" });
            }}
          >
            {t("accounts.title")}
          </Button>
          <span className='ml-3 text-xs text-muted-foreground'>{t("accounts.localLabel")}</span>
        </div>
        {localView}
      </>
    );
  return (
    <main className='h-screen overflow-y-auto bg-background text-foreground'>
      <header className='sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background px-6 py-4'>
        <span className='font-semibold tracking-wide'>DISHYLINK</span>
        <div className='flex flex-wrap gap-2'>
          <Button variant='ghost' onClick={cycleTheme}>
            {t("accounts.theme")}
          </Button>
          <Button
            variant='outline'
            onClick={() => {
              setLocal(true);
              navigate({ kind: "local" });
            }}
          >
            {t("accounts.local")}
          </Button>
        </div>
      </header>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:px-10'>
        <nav
          aria-label={t("accounts.breadcrumbs")}
          className='flex flex-wrap items-center gap-3 text-sm'
        >
          <button onClick={() => navigate({ kind: "accounts" })} className='hover:underline'>
            {t("accounts.title")}
          </button>
          {accountId && (
            <>
              <span aria-hidden>/</span>
              <button
                className='break-all hover:underline'
                onClick={() => navigate({ kind: "account", accountId })}
              >
                {selected?.inventory.accounts.find((a) => a.accountId === accountId)?.name ??
                  accountId}
              </button>
            </>
          )}
          {service && (
            <>
              <span aria-hidden>/</span>
              <span aria-current='page'>{service.nickname ?? service.serviceLineNumber}</span>
            </>
          )}
        </nav>
        {inventory.error && (
          <div role='alert' className='rounded-xl border border-border p-4'>
            {t("accounts.loadFailed")}{" "}
            <Button variant='outline' onClick={() => void client.inventory.load(true)}>
              {t("common.tryAgain")}
            </Button>
          </div>
        )}
        {error && <p role='alert'>{error}</p>}
        {!inventory.data && inventory.loading ? (
          <p role='status'>{t("accounts.loading")}</p>
        ) : !inventory.data && inventory.error ? null : route.kind === "accounts" ? (
          <AccountsHome
            client={client}
            sessions={sessions}
            busy={busy}
            onAccount={(accountId) => navigate({ kind: "account", accountId })}
            onConnect={(session) => setConnection(session ?? "new")}
            onDisconnect={setDisconnect}
            onTracking={(s) => void changeTracking(s)}
          />
        ) : route.kind === "invalid" ||
          !selected ||
          (route.kind === "service" && (!service || (route.terminalId && !terminal))) ? (
          <p role='alert'>{t("accounts.invalidTarget")}</p>
        ) : (
          <>
            {candidates.length > 1 && (
              <label className='flex flex-wrap items-center gap-3 text-sm'>
                {t("accounts.connection")}
                <select
                  className='rounded-lg border border-border bg-background p-2'
                  value={selected.credentialId}
                  onChange={(e) => setAccess({ ...access, [accountId!]: e.target.value })}
                >
                  {candidates.map((s) => (
                    <option key={s.credentialId} value={s.credentialId}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selected.state !== "connected" && (
              <p role='alert'>
                {t("accounts.reconnectHelp")}{" "}
                <Button variant='outline' onClick={() => setConnection(selected)}>
                  {t("accounts.reconnect")}
                </Button>
              </p>
            )}
            {!selected.tracking && (
              <p className='text-sm text-muted-foreground'>{t("accounts.trackingHelp")}</p>
            )}
            {route.kind === "account" ? (
              <AccountDishesView
                key={`${selected.credentialId}/${accountId}`}
                services={services}
                credentialId={selected.credentialId}
                client={client}
                now={now}
                onService={(serviceLineNumber) =>
                  navigate({ kind: "service", accountId: accountId!, serviceLineNumber })
                }
              />
            ) : (
              service && (
                <>
                  <div>
                    <h1 className='text-3xl font-semibold'>
                      {service.nickname ?? service.serviceLineNumber}
                    </h1>
                    <p className='mt-2 break-all text-sm text-muted-foreground'>
                      {service.address ?? service.serviceLineNumber}
                    </p>
                    <p className='mt-2 text-xs text-muted-foreground'>
                      {t("accounts.subscriptionUnknown")}
                    </p>
                  </div>
                  {service.terminals.length > 1 && (
                    <label className='flex flex-col gap-2 text-sm'>
                      {t("accounts.dish")}
                      <select
                        className='rounded-lg border border-border bg-background p-3'
                        value={terminal?.terminalId ?? ""}
                        onChange={(e) =>
                          navigate({
                            kind: "service",
                            accountId: accountId!,
                            serviceLineNumber: service.serviceLineNumber,
                            ...(e.target.value ? { terminalId: e.target.value } : {}),
                          })
                        }
                      >
                        <option value=''>{t("accounts.chooseDish")}</option>
                        {service.terminals.map((d) => (
                          <option key={d.terminalId} value={d.terminalId}>
                            {d.serialNumber ?? d.terminalId}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {terminal ? (
                    <RemoteDishView
                      key={`${selected.credentialId}/${accountId}/${service.serviceLineNumber}/${terminal.terminalId}`}
                      client={client}
                      now={now}
                      connected={selected.state === "connected" && selected.tracking}
                      context={{
                        credentialId: selected.credentialId,
                        accountId: accountId!,
                        serviceLineNumber: service.serviceLineNumber,
                        terminalId: terminal.terminalId,
                      }}
                    />
                  ) : (
                    <p className='text-sm text-muted-foreground'>
                      {t(
                        service.terminals.length ? "accounts.chooseDishHelp" : "accounts.noDishes",
                      )}
                    </p>
                  )}
                </>
              )
            )}
          </>
        )}
        <footer className='border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground'>
          {t("accounts.backgroundHelp")}
        </footer>
      </div>
      {connection && (
        <AccountConnectionDialog
          client={client}
          session={connection === "new" ? undefined : connection}
          onClose={() => setConnection(undefined)}
        />
      )}{" "}
      {disconnect && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDisconnect(undefined);
          }}
        >
          <DialogContent>
            <DialogTitle>{t("accounts.disconnect")}</DialogTitle>
            <DialogDescription>
              {t("accounts.disconnectHelp", { name: disconnect.label })}
            </DialogDescription>
            <Button disabled={busy} onClick={() => void confirmDisconnect()}>
              {t("accounts.confirmDisconnect")}
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
