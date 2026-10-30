import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { HOUR_MS, MANUAL_COOLDOWN_MS, REFRESH_HOURS } from "@core/remoteTelemetry";
import type { DishContext } from "@core/accountContext";
import type { AccountClient, CachedRemote } from "../../lib/accountClient";
import { useAccountQuery } from "../../hooks/useAccountInventory";
import { readTimeFormat, subscribeToTimeFormat, timeLocale } from "../../lib/timeFormat";
import { Button } from "../ui/button";
import { SectionCard } from "../ui/section-card";
function useRemoteTime() {
  const { i18n, t } = useTranslation();
  const clock = useSyncExternalStore(subscribeToTimeFormat, readTimeFormat);
  return (time: number | null | undefined) =>
    time
      ? new Date(time).toLocaleString(timeLocale(i18n.language, clock))
      : t("accounts.unavailable");
}
export function ReportedStatus({ data, now }: { data?: CachedRemote; now: number }) {
  const { t } = useTranslation();
  const time = useRemoteTime();
  const snapshot = data?.snapshot;
  const status = snapshot?.status ?? "unknown";
  const observed = snapshot?.observedAt ?? (status === "offline" ? snapshot?.fetchedAt : null);
  const stale = Boolean(
    observed && now - observed > (data?.refresh.intervalHours ?? 2) * HOUR_MS + 15 * 60000,
  );
  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
      <span className='inline-flex items-center gap-2'>
        <span
          aria-hidden
          className={`size-2.5 rounded-full ${status === "online" ? "bg-green-500" : status === "offline" ? "bg-red-500" : "bg-zinc-500"}`}
        />
        <span>{t(`accounts.${status}`)}</span>
      </span>
      <span className='text-xs text-muted-foreground'>
        {t("accounts.asOf", { time: time(observed) })}
      </span>
      {stale && <span className='text-xs text-amber-400'>{t("accounts.stale")}</span>}
      {data?.expectation.enabled && (
        <span className='text-xs text-muted-foreground'>
          {t("accounts.expectedOffline")}
          {data.expectation.reason && (
            <>
              {" "}
              · <span>{data.expectation.reason}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
export function RemoteDishView({
  client,
  context,
  now,
  connected,
  draft,
  onDraftChange,
}: {
  client: AccountClient;
  context: DishContext;
  now: number;
  connected: boolean;
  draft?: { enabled: boolean; reason: string };
  onDraftChange: (draft: { enabled: boolean; reason: string }) => void;
}) {
  const { t } = useTranslation();
  const time = useRemoteTime();
  const query = client.remote(context);
  const state = useAccountQuery(query);
  const data = state.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [blockedUntil, setBlockedUntil] = useState(0);
  const enabled = draft?.enabled ?? data?.expectation.enabled ?? false;
  const reason = draft?.reason ?? data?.expectation.reason ?? "";
  const refresh = data?.refresh;
  const cooldown = Math.max(
    blockedUntil,
    refresh?.backoffUntil ?? 0,
    refresh?.lastManualAt === undefined ? 0 : refresh.lastManualAt + MANUAL_COOLDOWN_MS,
  );
  async function run(kind: "refresh" | "expectation" | "settings", hours?: number) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const reply = await client.mutate(
        kind === "refresh"
          ? {
              kind: "remote-refresh",
              credentialId: refresh?.credentialId ?? context.credentialId,
              accountId: context.accountId,
            }
          : kind === "settings"
            ? {
                kind: "remote-settings",
                credentialId: context.credentialId,
                accountId: context.accountId,
                intervalHours: hours!,
              }
            : { kind: "remote-expectation", context, enabled, reason },
      );
      if (reply.status === 429) {
        const retry = (reply.body as { retryAfterMs?: unknown } | null)?.retryAfterMs;
        setBlockedUntil(
          Date.now() +
            (typeof retry === "number" && Number.isFinite(retry) && retry > 0
              ? retry
              : MANUAL_COOLDOWN_MS),
        );
        setError(t("accounts.cooldownHelp"));
      } else if (reply.status !== 200) setError(t("accounts.operationFailed"));
      await query.load(true);
    } catch {
      setError(t("accounts.operationFailed"));
    } finally {
      setBusy(false);
    }
  }
  const dish = data?.snapshot?.dish;
  return (
    <div className='flex flex-col gap-5'>
      <section className='flex flex-col gap-4 rounded-xl border border-border bg-card p-5'>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <ReportedStatus data={data} now={now} />
          <Button
            disabled={busy || !connected || cooldown > now}
            onClick={() => void run("refresh")}
          >
            {busy
              ? t("accounts.working")
              : cooldown > now
                ? t("accounts.refreshIn", { seconds: Math.ceil((cooldown - now) / 1000) })
                : t("accounts.refreshNow")}
          </Button>
        </div>
        <p className='text-sm text-muted-foreground'>
          {t("accounts.freshness", {
            updated: time(data?.snapshot?.fetchedAt),
            next: time(refresh?.nextDueAt),
          })}
        </p>
        <p className='text-xs text-muted-foreground'>{t("accounts.sampleHelp")}</p>
        {data?.overdue && <p className='text-sm text-amber-400'>{t("accounts.overdue")}</p>}
        {(refresh?.error || data?.storageError || state.error) && (
          <p role='alert' className='text-sm text-amber-400'>
            {t("accounts.collectionFailed")}{" "}
            {refresh?.error && t(`accounts.error-${refresh.error}`)}
          </p>
        )}
        {error && (
          <p role='alert' className='text-sm text-amber-400'>
            {error}
          </p>
        )}
        {state.loading && !data && <p role='status'>{t("accounts.loading")}</p>}
        <label className='flex flex-wrap items-center gap-3 text-sm'>
          {t("accounts.interval")}
          <select
            className='rounded-lg border border-border bg-background p-2'
            value={refresh?.intervalHours ?? 2}
            disabled={busy || !connected || !refresh}
            onChange={(e) => void run("settings", Number(e.target.value))}
          >
            {REFRESH_HOURS.map((hours) => (
              <option key={hours} value={hours}>
                {t("accounts.hours", { count: hours })}
              </option>
            ))}
          </select>
        </label>
      </section>
      <div className='grid gap-5 md:grid-cols-2'>
        <SectionCard title={t("accounts.obstructions")}>
          <p className='text-3xl font-semibold'>
            {dish?.obstructionFraction === undefined
              ? t("accounts.unavailable")
              : new Intl.NumberFormat(undefined, {
                  style: "percent",
                  maximumFractionDigits: 2,
                }).format(dish.obstructionFraction)}
          </p>
          <p className='mt-3 text-xs leading-relaxed text-muted-foreground'>
            {t(
              dish?.obstructionFraction === undefined
                ? "accounts.fieldUnavailable"
                : "accounts.obstructionHelp",
            )}
          </p>
        </SectionCard>
        <SectionCard title={t("accounts.terminal")}>
          <dl className='flex flex-col gap-3 text-sm'>
            <div>
              <dt className='text-muted-foreground'>{t("accounts.dish")}</dt>
              <dd className='break-all font-mono text-xs'>{context.terminalId}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t("accounts.uptime")}</dt>
              <dd>
                {dish?.uptimeS === undefined
                  ? t("accounts.unavailable")
                  : t("accounts.uptimeHours", {
                      hours: Math.floor(dish.uptimeS / 3600),
                      minutes: Math.floor((dish.uptimeS % 3600) / 60),
                    })}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t("accounts.software")}</dt>
              <dd className='break-all'>{dish?.softwareVersion ?? t("accounts.unavailable")}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t("accounts.signal")}</dt>
              <dd>{dish?.signalQuality ?? t("accounts.unavailable")}</dd>
            </div>
          </dl>
        </SectionCard>
      </div>
      <SectionCard title={t("accounts.routers")}>
        {!data?.snapshot?.routers.length ? (
          <p className='text-sm text-muted-foreground'>{t("accounts.fieldUnavailable")}</p>
        ) : (
          <div className='flex flex-col gap-3'>
            {data.snapshot.routers.map((router) => (
              <div key={router.deviceId} className='flex flex-wrap gap-3 text-sm'>
                <span className='break-all font-mono text-xs'>{router.deviceId}</span>
                <span>{router.softwareVersion ?? t("accounts.unavailable")}</span>
                <span>
                  {t("accounts.clients", {
                    count: router.clients ?? 0,
                    value: router.clients ?? t("accounts.unavailable"),
                  })}
                </span>
                <span>{t("accounts.asOf", { time: time(router.observedAt) })}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      <SectionCard title={t("accounts.expectedOffline")}>
        <form
          className='flex flex-col items-start gap-3'
          onSubmit={(e) => {
            e.preventDefault();
            void run("expectation");
          }}
        >
          <p className='text-sm text-muted-foreground'>{t("accounts.expectationHelp")}</p>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={enabled}
              onChange={(e) => onDraftChange({ enabled: e.target.checked, reason })}
            />
            {t("accounts.expectedOffline")}
          </label>
          <label className='flex w-full flex-col gap-2 text-sm'>
            {t("accounts.reason")}
            <input
              className='w-full rounded-lg border border-border bg-background p-3'
              value={reason}
              maxLength={200}
              onChange={(e) => onDraftChange({ enabled, reason: e.target.value })}
            />
          </label>
          <Button variant='outline' disabled={busy || !data} type='submit'>
            {t("common.save")}
          </Button>
        </form>
      </SectionCard>
    </div>
  );
}
