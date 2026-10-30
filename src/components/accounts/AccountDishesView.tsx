import { useTranslation } from "react-i18next";
import type { AccountClient } from "../../lib/accountClient";
import type { ServiceRef, DishContext } from "@core/accountContext";
import { useAccountQuery } from "../../hooks/useAccountInventory";
import { ReportedStatus } from "./RemoteDishView";
export function AccountDishesView({
  services,
  credentialId,
  client,
  now,
  onService,
}: {
  services: ServiceRef[];
  credentialId: string;
  client: AccountClient;
  now: number;
  onService: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h1 className='text-3xl font-semibold'>{t("accounts.services")}</h1>
      {services.length === 0 && <p>{t("accounts.noServices")}</p>}
      <div className='flex flex-col gap-4'>
        {services.map((service) => (
          <section
            key={service.serviceLineNumber}
            className='rounded-xl border border-border bg-card p-5'
          >
            <button
              className='text-start text-lg font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring'
              aria-label={t("accounts.open", {
                name: service.nickname ?? service.serviceLineNumber,
              })}
              onClick={() => onService(service.serviceLineNumber)}
            >
              {service.nickname ?? service.serviceLineNumber}
            </button>
            <p className='mt-1 break-all font-mono text-xs text-muted-foreground'>
              {service.serviceLineNumber}
            </p>
            {service.address && (
              <p className='mt-2 text-sm text-muted-foreground'>{service.address}</p>
            )}
            <p className='mt-2 text-xs text-muted-foreground'>
              {t("accounts.subscriptionUnknown")}
            </p>
            <div className='mt-4 flex flex-col gap-3'>
              {service.terminals.map((terminal) => (
                <ServiceDish
                  key={terminal.terminalId}
                  client={client}
                  now={now}
                  context={{
                    credentialId,
                    accountId: service.accountId,
                    serviceLineNumber: service.serviceLineNumber,
                    terminalId: terminal.terminalId,
                  }}
                />
              ))}
              {service.terminals.length === 0 && (
                <p className='text-sm text-muted-foreground'>{t("accounts.noDishes")}</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
function ServiceDish({
  client,
  context,
  now,
}: {
  client: AccountClient;
  context: DishContext;
  now: number;
}) {
  const { t } = useTranslation();
  const state = useAccountQuery(client.remote(context));
  return (
    <div className='flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3'>
      <span className='break-all font-mono text-xs'>{context.terminalId}</span>
      <ReportedStatus data={state.data} now={now} />
      {state.error && (
        <p className='w-full text-sm text-muted-foreground'>{t("accounts.cacheFailed")}</p>
      )}
    </div>
  );
}
