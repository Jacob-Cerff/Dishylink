import { app, BrowserWindow, safeStorage, session, powerMonitor, net } from "electron";
import { join } from "node:path";
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { auditCloudReads } from "../cloud/capabilityAudit";
import { AccountRegistry } from "../cloud/accountRegistry";
import { resilientFetch } from "../cloud/resilientFetch";
import type { CloudResult } from "../cloud/starlinkCloudHandler";
import { AccountController } from "./accountController";
import { EncryptedAccountStore } from "./accountStore";
import { runAccountLogin } from "./accountLogin";
import {
  migrateLegacyAccount,
  LEGACY_CREDENTIAL_ID,
  InvalidLegacySession,
} from "./legacyAccountMigration";
import { RemoteRefresh } from "../cloud/remoteRefresh";
import { ACCOUNT_CHANGED_CHANNEL } from "./ipc";
import type { AccountChange } from "../core/accountBridge";
import { RemoteSnapshotStore } from "./remoteSnapshotStore";
import {
  runRemoteMonitoring,
  handleRemoteRequest,
  restrictLiveAccountRead,
} from "./remoteMonitoring";

let accountRegistry: AccountRegistry | null = null;
export function getAccountRegistry(): AccountRegistry | null {
  return accountRegistry;
}
let controller: AccountController | null = null;
let monitor: RemoteRefresh | null = null;
let stopRegistry: (() => void) | null = null;
let stopMonitoring: (() => void) | null = null;

export function stopAccounts(): void {
  stopRegistry?.();
  stopRegistry = null;
  stopMonitoring?.();
  stopMonitoring = null;
  monitor = null;
}

/** Windows-first host. Does not read, replace, or retarget the legacy single-account session. */
export function startAccounts(parent: () => BrowserWindow | undefined): void {
  stopAccounts();
  try {
    const accountStore = new EncryptedAccountStore(
      join(app.getPath("userData"), "accounts-v1"),
      safeStorage,
    );
    const registry = new AccountRegistry({
      store: accountStore,
      fetch:
        !app.isPackaged && process.env.DISHYLINK_CAPABILITY_AUDIT_FILE
          ? auditCloudReads(resilientFetch, (report) => {
              appendFileSync(
                process.env.DISHYLINK_CAPABILITY_AUDIT_FILE!,
                `${JSON.stringify(report)}\n`,
              );
            })
          : resilientFetch,
    });
    accountRegistry = registry;
    const legacyFile = join(app.getPath("userData"), "starlink-session.bin");
    const migrationFile = join(app.getPath("userData"), "legacy-account-migration-v1.json");
    void migrateLegacyAccount({
      registry,
      readLegacy: () => {
        if (!existsSync(legacyFile)) return null;
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Encryption unavailable");
        const encrypted = readFileSync(legacyFile);
        try {
          return safeStorage.decryptString(encrypted);
        } catch {
          throw new InvalidLegacySession("Legacy session requires reconnection");
        }
      },
      completed: () => {
        if (!existsSync(migrationFile)) return false;
        const marker = JSON.parse(readFileSync(migrationFile, "utf8"));
        if (marker.version !== 1 || marker.credentialId !== LEGACY_CREDENTIAL_ID)
          throw new Error("Invalid migration marker");
        return marker.complete === true;
      },
      verified: () =>
        accountStore
          .load()
          .some(
            (record) =>
              record.credentialId === LEGACY_CREDENTIAL_ID &&
              record.state === "connected" &&
              Boolean(record.cookie) &&
              record.inventory.accounts.length > 0,
          ),
      markComplete: () => {
        writeFileSync(
          migrationFile + ".tmp",
          JSON.stringify({ version: 1, credentialId: LEGACY_CREDENTIAL_ID, complete: true }),
        );
        renameSync(migrationFile + ".tmp", migrationFile);
      },
    });
    const publish = (change: AccountChange) => {
      const window = parent();
      if (window && !window.isDestroyed()) window.webContents.send(ACCOUNT_CHANGED_CHANNEL, change);
    };
    stopRegistry = registry.subscribe(() => publish({ kind: "sessions" }));
    try {
      const store = new RemoteSnapshotStore(join(app.getPath("userData"), "remote-v1"));
      monitor = new RemoteRefresh({
        registry,
        store: {
          get: (accountId, credentialId) => store.get(accountId, credentialId),
          save: (record) => {
            store.save(record);
            publish({ kind: "snapshots", accountId: record.accountId });
          },
          prune: () => store.prune(),
          credentialBackoff: (id) => store.credentialBackoff(id),
          saveCredentialBackoff: (id, until) => store.saveCredentialBackoff(id, until),
        },
      });
      stopMonitoring = runRemoteMonitoring(monitor, (listener) => registry.subscribe(listener), {
        every: (listener) => {
          const timer = setInterval(listener, 5000);
          timer.unref();
          return () => clearInterval(timer);
        },
        onResume: (listener) => {
          powerMonitor.on("resume", listener);
          return () => {
            powerMonitor.removeListener("resume", listener);
          };
        },
        onSuspend: (listener) => {
          powerMonitor.on("suspend", listener);
          return () => {
            powerMonitor.removeListener("suspend", listener);
          };
        },
        isOnline: () => net.isOnline(),
      });
    } catch {
      stopAccounts();
    }
    controller = new AccountController({
      registry,
      clearPartition: async (partition) => {
        await session.fromPartition(partition).clearStorageData();
      },
      login: (partition, adopt, signal) => {
        const cookies = session.fromPartition(partition).cookies;
        return runAccountLogin(
          {
            readCookie: async () => {
              const values = await cookies.get({ domain: "starlink.com" });
              if (!values.some((cookie) => cookie.name === "Starlink.Com.Sso" && cookie.value))
                return null;
              return values.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
            },
            onCookieChanged: (listener) => {
              const changed = (
                _event: unknown,
                cookie: { name: string; domain?: string },
                _cause: string,
                removed: boolean,
              ) => {
                if (
                  !removed &&
                  /^Starlink\.Com\.(Sso|Access\.V1)$/.test(cookie.name) &&
                  /(^|\.)starlink\.com$/.test(cookie.domain ?? "")
                )
                  listener();
              };
              cookies.on("changed", changed);
              return () => {
                cookies.removeListener("changed", changed);
              };
            },
            createWindow: () => {
              const owner = parent();
              const window = new BrowserWindow({
                width: 1124,
                height: 800,
                parent: owner,
                modal: Boolean(owner),
                title: "Sign in to Starlink",
                autoHideMenuBar: true,
                webPreferences: {
                  partition,
                  nodeIntegration: false,
                  contextIsolation: true,
                  sandbox: true,
                },
              });
              window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
              window.webContents.on("before-input-event", (_event, input) => {
                if (input.type === "keyDown" && input.key === "Escape") window.close();
              });
              return {
                onReady: (listener) => {
                  window.webContents.on("did-finish-load", listener);
                },
                onClosed: (listener) => {
                  window.on("closed", listener);
                },
                load: () => {
                  void window.loadURL("https://www.starlink.com/account").catch(() => {});
                },
                destroy: () => {
                  if (!window.isDestroyed()) window.destroy();
                },
              };
            },
          },
          adopt,
          signal,
        );
      },
    });
  } catch {
    // A locked/unreadable credential store must not prevent local-only monitoring.
    controller = null;
    accountRegistry = null;
  }
}

export function handleAccountRequest(request: unknown): Promise<CloudResult> {
  if (
    request &&
    typeof request === "object" &&
    String((request as { kind?: unknown }).kind).startsWith("remote-")
  ) {
    return monitor
      ? handleRemoteRequest(request, monitor)
      : Promise.resolve({ status: 503, body: { error: "remote_monitor_unavailable" } });
  }
  if (restrictLiveAccountRead(request, app.isPackaged))
    return Promise.resolve({ status: 400, body: { error: "use_remote_cache_or_refresh" } });
  return controller
    ? controller.handle(request)
    : Promise.resolve({ status: 503, body: { error: "account_store_unavailable" } });
}
