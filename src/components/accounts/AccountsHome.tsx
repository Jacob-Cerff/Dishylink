import { useTranslation } from "react-i18next";
import type { CredentialSummary } from "../../../cloud/accountRegistry";
import { mergeAccountAccess } from "@core/accountContext";
import type { AccountClient } from "../../lib/accountClient";
import type { DishContext } from "@core/accountContext";
import { useAccountQuery } from "../../hooks/useAccountInventory";
import { Button } from "../ui/button";
export function AccountsHome({
  sessions,
  client,
  onAccount,
  onConnect,
  onEdit,
  onDisconnect,
  onTracking,
  busy,
}: {
  sessions: CredentialSummary[];
  client: AccountClient;
  onAccount: (id: string) => void;
  onConnect: (session?: CredentialSummary) => void;
  onEdit: (session: CredentialSummary) => void;
  onDisconnect: (session: CredentialSummary) => void;
  onTracking: (session: CredentialSummary) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const accounts = mergeAccountAccess(sessions);
  return (
    <>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <h1 className='text-3xl font-semibold'>{t("accounts.title")}</h1>
          <p className='mt-2 text-sm text-muted-foreground'>{t("accounts.intro")}</p>
        </div>
        <Button disabled={busy} onClick={() => onConnect()}>
          {t("accounts.add")}
        </Button>
      </div>
      {accounts.length === 0 && (
        <p className='rounded-xl border border-border p-6 text-muted-foreground'>
          {t("accounts.empty")}
        </p>
      )}
      <div className='grid gap-4 md:grid-cols-2'>
        {accounts.map((account) => {
          const access = sessions.filter((s) => account.credentialIds.includes(s.credentialId));
          const services = new Set(
            access.flatMap((s) =>
              s.inventory.services
                .filter((v) => v.accountId === account.accountId)
                .map((v) => v.serviceLineNumber),
            ),
          );
          const preferred =
            access.find((s) => s.state === "connected" && s.tracking) ??
            access.find((s) => s.state === "connected") ??
            access[0];
          const firstService = preferred?.inventory.services.find(
            (s) => s.accountId === account.accountId && s.terminals.length,
          );
          const context = firstService
            ? {
                credentialId: preferred.credentialId,
                accountId: account.accountId,
                serviceLineNumber: firstService.serviceLineNumber,
                terminalId: firstService.terminals[0].terminalId,
              }
            : undefined;
          return (
            <button
              key={account.accountId}
              aria-label={t("accounts.open", { name: account.name ?? account.accountId })}
              onClick={() => onAccount(account.accountId)}
              className='group flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5 text-start transition-colors hover:border-foreground/30 hover:bg-fill-raised focus-visible:bg-fill-raised focus-visible:outline-2 focus-visible:outline-ring'
            >
              <span className='text-lg font-semibold decoration-2 underline-offset-4 group-hover:underline group-focus-visible:underline'>
                {account.name ?? account.accountId}
              </span>
              <span className='break-all font-mono text-xs text-muted-foreground'>
                {account.accountId}
              </span>
              <span className='text-sm'>
                {t("accounts.serviceCount", { count: services.size })}
              </span>
              <span className='text-sm text-muted-foreground'>
                {access.map((s) => `${s.label} · ${t(`accounts.${s.state}`)}`).join(" / ")}
              </span>
              {context ? (
                <AccountFreshness client={client} context={context} />
              ) : (
                <span className='text-xs text-muted-foreground'>{t("accounts.noCollection")}</span>
              )}
              <span className='text-xs text-muted-foreground'>{t("accounts.cacheHelp")}</span>
            </button>
          );
        })}
      </div>
      <section className='flex flex-col gap-4'>
        <h2 className='text-lg font-semibold'>{t("accounts.connections")}</h2>
        {sessions.map((session) => (
          <div
            key={session.credentialId}
            className='flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4'
          >
            <div>
              <h3 className='font-semibold'>{session.label}</h3>
              <p className='text-sm text-muted-foreground'>
                {t(`accounts.${session.state}`)} ·{" "}
                {t(session.tracking ? "accounts.tracking" : "accounts.notTracking")}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                disabled={busy}
                aria-label={t("accounts.editNameFor", { name: session.label })}
                onClick={() => onEdit(session)}
              >
                {t("accounts.editName")}
              </Button>
              <Button variant='outline' disabled={busy} onClick={() => onConnect(session)}>
                {t("accounts.reconnect")}
              </Button>
              <Button
                variant='outline'
                disabled={busy || session.state !== "connected"}
                onClick={() => onTracking(session)}
              >
                {t(session.tracking ? "accounts.stopTracking" : "accounts.startTracking")}
              </Button>
              <Button
                variant='outline'
                disabled={busy || session.state === "disconnected"}
                onClick={() => onDisconnect(session)}
              >
                {t("accounts.disconnect")}
              </Button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function AccountFreshness({ client, context }: { client: AccountClient; context: DishContext }) {
  const { t, i18n } = useTranslation();
  const { data, error } = useAccountQuery(client.remote(context));
  return (
    <span className='text-xs text-muted-foreground'>
      {error
        ? t("accounts.cacheFailed")
        : data?.refresh.lastSuccessAt
          ? t("accounts.lastCollection", {
              time: new Date(data.refresh.lastSuccessAt).toLocaleString(i18n.language),
            })
          : t("accounts.noCollection")}
    </span>
  );
}
