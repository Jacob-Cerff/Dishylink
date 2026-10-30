import type { AccountRegistry } from "../cloud/accountRegistry";
export const LEGACY_CREDENTIAL_ID = "legacy-desktop-session";
export class InvalidLegacySession extends Error {}
export async function migrateLegacyAccount(options: {
  registry: AccountRegistry;
  readLegacy: () => string | null;
  completed: () => boolean;
  verified: () => boolean;
  markComplete: () => void;
}): Promise<"complete" | "absent" | "retry" | "reconnect-required"> {
  try {
    if (options.completed()) return "complete";
    const existing = options.registry
      .list()
      .sessions.find((s) => s.credentialId === LEGACY_CREDENTIAL_ID);
    if (existing) {
      if (existing.state !== "connected") return "reconnect-required";
      const refreshed = await options.registry.refreshInventory(LEGACY_CREDENTIAL_ID);
      if (refreshed.status !== 200)
        return refreshed.status === 428 ? "reconnect-required" : "retry";
    } else {
      let cookie: string | null;
      try {
        cookie = options.readLegacy();
      } catch (error) {
        if (!(error instanceof InvalidLegacySession)) throw error;
        options.registry.migrationPlaceholder(LEGACY_CREDENTIAL_ID, "Migrated desktop connection");
        return "reconnect-required";
      }
      if (!cookie) return "absent";
      const reply = await options.registry.importSession({
        credentialId: LEGACY_CREDENTIAL_ID,
        label: "Migrated desktop connection",
        cookie,
      });
      if (reply.status !== 200) {
        if (reply.status === 428 || reply.status === 400) {
          options.registry.migrationPlaceholder(
            LEGACY_CREDENTIAL_ID,
            "Migrated desktop connection",
          );
          return "reconnect-required";
        }
        return "retry";
      }
    }
    if (!options.verified()) return "retry";
    options.markComplete();
    return "complete";
  } catch {
    return "retry";
  }
}
