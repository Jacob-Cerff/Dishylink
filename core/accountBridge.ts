import type { DishContext, ScopedCloudRoute } from "./accountContext";

/** Explicit desktop operations; no raw IPC, arbitrary URL, or stored-secret read. */
export type AccountRequest =
  | { kind: "list" }
  | { kind: "sign-in"; credentialId?: string; label?: string }
  | { kind: "import"; credentialId?: string; label: string; cookie: string }
  | { kind: "rename"; credentialId: string; label: string }
  | { kind: "disconnect"; credentialId: string }
  | { kind: "tracking"; credentialId: string; enabled: boolean }
  | { kind: "refresh"; credentialId: string }
  | { kind: "remote-refresh"; credentialId: string; accountId: string }
  | { kind: "remote-settings"; credentialId: string; accountId: string; intervalHours: number }
  | { kind: "remote-cache"; context: DishContext }
  | { kind: "remote-expectation"; context: DishContext; enabled: boolean; reason?: string }
  | { kind: "read"; credentialId: string; route: ScopedCloudRoute; context: DishContext };

/** Payload-free session changes; snapshots carry public account identity only. */
export type AccountChange = { kind: "sessions" } | { kind: "snapshots"; accountId: string };
