import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CredentialSummary } from "../../../cloud/accountRegistry";
import type { AccountClient } from "../../lib/accountClient";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
export function AccountConnectionDialog({
  client,
  session,
  onClose,
}: {
  client: AccountClient;
  session?: CredentialSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(session?.label ?? "");
  const [cookie, setCookie] = useState("");
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function connect() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const activeCookie = cookie;
    setCookie("");
    try {
      const reply = await client.mutate(
        importing
          ? {
              kind: "import",
              label: label.trim(),
              cookie: activeCookie,
              ...(session ? { credentialId: session.credentialId } : {}),
            }
          : {
              kind: "sign-in",
              label: label.trim(),
              ...(session ? { credentialId: session.credentialId } : {}),
            },
      );
      if (reply.status === 200) onClose();
      else setError(t(reply.status === 499 ? "accounts.cancelled" : "accounts.connectFailed"));
    } catch {
      setError(t("accounts.connectFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          setCookie("");
          onClose();
        }
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogTitle>{t(session ? "accounts.reconnect" : "accounts.add")}</DialogTitle>
        <DialogDescription>{t("accounts.connectionHelp")}</DialogDescription>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
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
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          {importing && (
            <label className='flex flex-col gap-2 text-sm'>
              {t("accounts.cookie")}
              <textarea
                className='rounded-lg border border-border bg-background p-3 font-mono text-xs'
                autoComplete='off'
                spellCheck={false}
                value={cookie}
                maxLength={65536}
                required
                disabled={busy}
                onChange={(e) => setCookie(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p role='alert' className='text-sm text-red-400'>
              {error}
            </p>
          )}
          <Button type='submit' disabled={busy || !label.trim() || (importing && !cookie.trim())}>
            {t(
              busy
                ? "accounts.connecting"
                : importing
                  ? "accounts.importSubmit"
                  : "accounts.signIn",
            )}
          </Button>
          {!importing && (
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => setImporting(true)}
            >
              {t("accounts.import")}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
