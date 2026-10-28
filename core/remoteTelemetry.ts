import type { AccountInventory } from "./accountContext";

export interface RemoteDevice {
  deviceId: string;
  kind: "dish" | "router";
  observedAt: number | null;
  uptimeS?: number;
  softwareVersion?: string;
  hardwareVersion?: string;
  obstructionFraction?: number;
  signalQuality?: number;
  clients?: number;
  hops?: number;
  isRepeater?: boolean;
  isBypassed?: boolean;
}
export interface AccountTelemetry {
  devices: Record<string, RemoteDevice>;
  incomplete: boolean;
}
export interface RemoteSnapshot {
  credentialId: string;
  accountId: string;
  serviceLineNumber: string;
  terminalId: string;
  source: "cloud";
  status: "online" | "offline" | "unknown";
  observedAt: number | null;
  fetchedAt: number;
  dish?: RemoteDevice;
  routers: RemoteDevice[];
}
export const REFRESH_HOURS = [2, 4, 6, 12, 24] as const;
export const HOUR_MS = 3_600_000;
export const MANUAL_COOLDOWN_MS = 300_000;
export const RETENTION_MS = 90 * 24 * HOUR_MS;
export type RefreshError = "auth" | "rate-limited" | "network" | "invalid-data" | "storage";
export interface RefreshState {
  accountId: string;
  credentialId: string;
  intervalHours: number;
  nextDueAt: number;
  lastAttemptAt?: number;
  lastManualAt?: number;
  lastSuccessAt?: number;
  lastObservedAt?: number | null;
  backoffUntil?: number;
  retryCount: number;
  error?: RefreshError;
}
export interface RefreshAttempt {
  at: number;
  outcome: "success" | RefreshError;
}
export interface OfflineExpectation {
  enabled: boolean;
  reason?: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Strict schema check precedes empty/absent-device status classification. */
export function decodeRemoteTelemetry(value: unknown): AccountTelemetry {
  const data = object(object(value)?.data);
  const legends = object(data?.columnNamesByDeviceType);
  if (
    !legends ||
    !Array.isArray(data?.values) ||
    !Array.isArray(legends.u) ||
    !legends.u.includes("DeviceId") ||
    !legends.u.every((name) => typeof name === "string")
  )
    throw new Error("Invalid telemetry schema");
  for (const kind of ["u", "r"]) {
    const legend = legends[kind];
    if (legend === undefined && kind === "r") continue;
    if (
      !Array.isArray(legend) ||
      !legend.includes("DeviceId") ||
      !legend.every((name) => typeof name === "string") ||
      new Set(legend).size !== legend.length
    )
      throw new Error("Invalid telemetry legend");
  }
  const devices: Record<string, RemoteDevice> = {};
  let incomplete = false;
  for (const row of data.values) {
    if (!Array.isArray(row)) {
      incomplete = true;
      continue;
    }
    const kind = row[0];
    if (typeof kind !== "string" || !kind) {
      incomplete = true;
      continue;
    }
    if (kind !== "u" && kind !== "r") continue;
    const legend = legends[kind];
    if (
      !Array.isArray(legend) ||
      !legend.every((name) => typeof name === "string") ||
      new Set(legend).size !== legend.length ||
      row.length < legend.length
    ) {
      incomplete = true;
      continue;
    }
    const get = (name: string): unknown => row[legend.indexOf(name)];
    const id = get("DeviceId");
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || devices[id]) {
      incomplete = true;
      continue;
    }
    const time = get("UtcTimestampNs");
    const device: RemoteDevice = {
      deviceId: id,
      kind: kind === "u" ? "dish" : "router",
      observedAt: finite(time) && time > 0 ? time / 1e6 : null,
    };
    const numbers =
      kind === "u"
        ? {
            Uptime: "uptimeS",
            ObstructionPercentTime: "obstructionFraction",
            SignalQuality: "signalQuality",
          }
        : { WifiUptimeS: "uptimeS", Clients: "clients", WifiHopsFromController: "hops" };
    for (const [column, key] of Object.entries(numbers)) {
      const number = get(column);
      if (finite(number) && number >= 0 && (key !== "obstructionFraction" || number <= 1))
        Object.assign(device, { [key]: number });
    }
    for (const [column, key] of Object.entries(
      kind === "u"
        ? { RunningSoftwareVersion: "softwareVersion" }
        : { WifiSoftwareVersion: "softwareVersion", WifiHardwareVersion: "hardwareVersion" },
    )) {
      const text = get(column);
      if (typeof text === "string" && text.length <= 256) Object.assign(device, { [key]: text });
    }
    if (kind === "r")
      for (const [column, key] of [
        ["WifiIsRepeater", "isRepeater"],
        ["WifiIsBypassed", "isBypassed"],
      ]) {
        const flag = get(column);
        if (typeof flag === "boolean") Object.assign(device, { [key]: flag });
      }
    devices[id] = device;
  }
  return { devices, incomplete };
}

export function accountSnapshots(
  credentialId: string,
  accountId: string,
  inventory: AccountInventory,
  telemetry: AccountTelemetry,
  fetchedAt: number,
): RemoteSnapshot[] {
  return inventory.services
    .filter((service) => service.accountId === accountId)
    .flatMap((service) =>
      service.terminals.map((terminal) => {
        const dishId = terminal.terminalId.startsWith("ut")
          ? terminal.terminalId
          : `ut${terminal.terminalId}`;
        const reported = telemetry.devices[dishId];
        const dish = reported?.kind === "dish" ? reported : undefined;
        const routers = terminal.routerIds
          .map((id) => telemetry.devices[id.startsWith("Router-") ? id : `Router-${id}`])
          .filter((device): device is RemoteDevice => device?.kind === "router");
        return {
          credentialId,
          accountId,
          serviceLineNumber: service.serviceLineNumber,
          terminalId: terminal.terminalId,
          source: "cloud",
          status: dish ? "online" : telemetry.incomplete || routers.length ? "unknown" : "offline",
          observedAt: dish?.observedAt ?? null,
          fetchedAt,
          ...(dish ? { dish } : {}),
          routers,
        };
      }),
    );
}
