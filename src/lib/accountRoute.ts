import { validAccountId } from "@core/accountContext";
export type AccountRoute =
  | { kind: "accounts" }
  | { kind: "local" }
  | { kind: "account"; accountId: string }
  | { kind: "service"; accountId: string; serviceLineNumber: string; terminalId?: string }
  | { kind: "invalid" };
export function parseAccountRoute(hash: string): AccountRoute {
  if (!hash || hash === "#" || hash === "#/accounts") return { kind: "accounts" };
  if (hash === "#/local" || hash === "#satellite") return { kind: "local" };
  const parts = hash.split("/");
  if (parts[0] !== "#" || parts[1] !== "accounts" || !validAccountId(parts[2]))
    return { kind: "invalid" };
  if (parts.length === 3) return { kind: "account", accountId: parts[2] };
  if (parts[3] !== "services" || !validAccountId(parts[4])) return { kind: "invalid" };
  if (parts.length === 5)
    return { kind: "service", accountId: parts[2], serviceLineNumber: parts[4] };
  if (parts.length === 7 && parts[5] === "terminals" && validAccountId(parts[6]))
    return {
      kind: "service",
      accountId: parts[2],
      serviceLineNumber: parts[4],
      terminalId: parts[6],
    };
  return { kind: "invalid" };
}
export function accountHash(route: AccountRoute): string {
  if (route.kind === "account") return `#/accounts/${route.accountId}`;
  if (route.kind === "service")
    return `#/accounts/${route.accountId}/services/${route.serviceLineNumber}${route.terminalId ? `/terminals/${route.terminalId}` : ""}`;
  return route.kind === "local" ? "#/local" : "#/accounts";
}
