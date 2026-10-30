import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DishContext } from "@core/accountContext";
import { sameTerminal, type LocalHost, type LocalState } from "@core/localSource";
import { useLocalSource } from "../../hooks/useSelectedDishTelemetry";
import { bindLocalDashboard } from "../../lib/localDashboardHost";
import { LocalControlContext } from "../../lib/localControls";
import { Button } from "../ui/button";
import { SectionCard } from "../ui/section-card";
export function LocalDashboard({
  host,
  context,
  renderLocal,
}: {
  host: LocalHost;
  context?: DishContext;
  renderLocal: (lease: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const state = useLocalSource(host);
  const [grant, setGrant] = useState<{
    lease: string;
    generation: number;
    authorizationGeneration: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [legacy, setLegacy] = useState<{
    categories: { kind: string; records: number | null; updatedAt: number | null }[];
    pausedRules: number;
  }>();
  const contextKey = context ? JSON.stringify(context) : "";
  useEffect(() => {
    if (
      state.status !== "ready" ||
      !state.recording ||
      (context && !sameTerminal(context.terminalId, state.terminalId))
    )
      return;
    let active = true;
    let lease: string | undefined;
    let restore: (() => void) | undefined;
    void host.request({ kind: "select", ...(context ? { context } : {}) }).then(
      (reply) => {
        if (reply.status !== 200) {
          if (active) setError(true);
          return;
        }
        const data = reply.body as { lease: string; state: LocalState };
        lease = data.lease;
        if (!active) {
          void host.request({ kind: "leave", lease });
          return;
        }
        restore = bindLocalDashboard(host, lease);
        setGrant({
          lease,
          generation: state.generation,
          authorizationGeneration: state.authorizationGeneration ?? 0,
        });
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
      restore?.();
      if (lease) void host.request({ kind: "leave", lease });
    };
    // The serialized context is the identity boundary; plain object recreation is not a source change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    host,
    state.status,
    state.recording,
    state.generation,
    state.authorizationGeneration,
    contextKey,
  ]);
  async function connect() {
    setBusy(true);
    setError(false);
    try {
      const reply = await host.request({ kind: "connect" });
      if (reply.status !== 200 || (reply.body as LocalState).status !== "ready") setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const active =
    state.status === "ready" &&
    grant?.generation === state.generation &&
    grant.authorizationGeneration === (state.authorizationGeneration ?? 0) &&
    (!context || sameTerminal(context.terminalId, state.terminalId));
  return (
    <section className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4'>
        <div>
          <p className='font-semibold'>
            {t(state.status === "ready" ? "local.source" : "local.title", {
              terminal: state.terminalId ?? t("local.unassigned"),
            })}
          </p>
          <p className='mt-1 text-xs text-muted-foreground'>
            {t(context && state.controls ? "local.controlsVerified" : "local.controlsBlocked")}
          </p>
        </div>
        {state.status === "ready" ? (
          <Button variant='outline' onClick={() => void host.request({ kind: "disconnect" })}>
            {t("local.disconnect")}
          </Button>
        ) : (
          <Button disabled={busy || state.status === "probing"} onClick={() => void connect()}>
            {t(busy || state.status === "probing" ? "local.connecting" : "local.connect")}
          </Button>
        )}
        <Button
          variant='outline'
          onClick={() =>
            void host.request({ kind: "legacy" }).then(
              (reply) => {
                if (reply.status === 200) setLegacy(reply.body as typeof legacy);
                else setError(true);
              },
              () => setError(true),
            )
          }
        >
          {t("local.legacy")}
        </Button>
      </div>
      {error && (
        <p role='alert' className='text-sm text-amber-400'>
          {t("local.failed")}
        </p>
      )}
      {legacy && (
        <SectionCard title={t("local.legacy")}>
          <p className='mb-3 text-sm text-muted-foreground'>{t("local.legacyHelp")}</p>
          {legacy.categories.length ? (
            legacy.categories.map((category) => (
              <p className='text-sm' key={category.kind}>
                {t(`local.history-${category.kind}` as "local.history-energy")} ·{" "}
                {t("local.records", { count: category.records ?? 0 })}
              </p>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>{t("local.noLegacy")}</p>
          )}
          {legacy.pausedRules > 0 && (
            <p className='mt-3 text-sm text-amber-400'>
              {t("local.legacyRules", { count: legacy.pausedRules })}
            </p>
          )}
        </SectionCard>
      )}
      {active ? (
        <LocalControlContext.Provider
          value={{
            writes: Boolean(context && state.controls),
            terminalId: state.terminalId ?? undefined,
          }}
        >
          {renderLocal(grant!.lease)}
        </LocalControlContext.Provider>
      ) : (
        <p className='text-sm text-muted-foreground'>{t("local.connectHelp")}</p>
      )}
    </section>
  );
}
