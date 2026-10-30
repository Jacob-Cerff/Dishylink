import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DishContext } from "@core/accountContext";
import type { LocalHost } from "@core/localSource";
import type { AccountClient } from "../../lib/accountClient";
import { useLocalSource, selectedDishSource } from "../../hooks/useSelectedDishTelemetry";
import { LocalDashboard } from "../local/LocalDashboard";
import { RemoteDishView } from "./RemoteDishView";
import { Button } from "../ui/button";
export function SelectedDishView({
  client,
  context,
  now,
  connected,
  localHost,
  renderLocal,
  draft,
  onDraftChange,
}: {
  client: AccountClient;
  context: DishContext;
  now: number;
  connected: boolean;
  localHost?: LocalHost;
  renderLocal?: (lease: string) => ReactNode;
  draft?: { enabled: boolean; reason: string };
  onDraftChange: (draft: { enabled: boolean; reason: string }) => void;
}) {
  const { t } = useTranslation();
  const state = useLocalSource(localHost);
  const [remote, setRemote] = useState(false);
  const available = Boolean(
    localHost && renderLocal && selectedDishSource(state, context.terminalId) === "lan",
  );
  return (
    <div className='flex flex-col gap-4'>
      {available && (
        <div>
          <Button variant='outline' onClick={() => setRemote(!remote)}>
            {t(remote ? "local.useLan" : "local.useCloud")}
          </Button>
        </div>
      )}
      {available && !remote ? (
        <LocalDashboard host={localHost!} context={context} renderLocal={renderLocal!} />
      ) : (
        <RemoteDishView
          client={client}
          context={context}
          now={now}
          connected={connected}
          draft={draft}
          onDraftChange={onDraftChange}
        />
      )}
    </div>
  );
}
