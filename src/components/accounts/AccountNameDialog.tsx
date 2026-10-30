import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CredentialSummary } from "../../../cloud/accountRegistry";
import type { AccountClient } from "../../lib/accountClient";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";

export function AccountNameDialog({
  client,
  session,
  onClose,
}: {
  client: AccountClient;
  session: CredentialSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(session.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    if (busy || !label.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const reply = await client.mutate({
        kind: "rename",
        credentialId: session.credentialId,
        label: label.trim(),
      });
      if (reply.status === 200) onClose();
      else setError(t("accounts.renameFailed"));
    } catch {
      setError(t("accounts.renameFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogTitle>{t("accounts.editConnection")}</DialogTitle>
        <DialogDescription>{t("accounts.editConnectionHelp")}</DialogDescription>
        <form
          className='flex flex-col gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className='flex flex-col gap-2 text-sm'>
            {t("accounts.connectionName")}
            <input
              className='rounded-lg border border-border bg-background p-3'
              value={label}
              maxLength={100}
              required
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          {error && (
            <p role='alert' className='text-sm text-red-400'>
              {error}
            </p>
          )}
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type='submit' disabled={busy || !label.trim()}>
              {t(busy ? "common.saving" : "common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
