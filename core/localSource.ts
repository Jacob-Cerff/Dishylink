import { assertDishContext, validAccountId, type DishContext } from "./accountContext";
import type { CredentialSummary } from "../cloud/accountRegistry";
export function terminalKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.startsWith("ut") ? value.slice(2) : value;
  return validAccountId(key) ? key : null;
}
export function routerKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.startsWith("Router-") ? value.slice(7) : value;
  return validAccountId(key) ? key : null;
}
export function sameTerminal(left: unknown, right: unknown): boolean {
  const key = terminalKey(left);
  return key !== null && key === terminalKey(right);
}
export function localMember(
  sessions: CredentialSummary[],
  context: DishContext,
  terminalId: string | null,
): boolean {
  const session = sessions.find((s) => s.credentialId === context.credentialId);
  if (!session || !sameTerminal(terminalId, context.terminalId)) return false;
  try {
    assertDishContext(context, session.credentialId, session.inventory);
    return true;
  } catch {
    return false;
  }
}
export function localBinding(
  sessions: CredentialSummary[],
  context: DishContext,
  terminalId: string | null,
  routerId: string | null,
): boolean {
  const session = sessions.find(
    (s) => s.credentialId === context.credentialId && s.state === "connected",
  );
  if (!session || !sameTerminal(terminalId, context.terminalId) || !routerKey(routerId))
    return false;
  try {
    return assertDishContext(context, session.credentialId, session.inventory).routerIds.some(
      (id) => routerKey(id) === routerKey(routerId),
    );
  } catch {
    return false;
  }
}
export interface LocalState {
  version: 1;
  status: "idle" | "probing" | "ready" | "unreachable" | "changed" | "error";
  terminalId: string | null;
  routerId: string | null;
  generation: number;
  authorizationGeneration?: number;
  recording: boolean;
  controls: boolean;
  viewActive: boolean;
}
export interface LocalReply {
  status: number;
  body: unknown;
}
export type LocalRequest =
  | { kind: "state" | "connect" | "disconnect" | "legacy" }
  | { kind: "select"; context?: DishContext }
  | { kind: "leave"; lease: string }
  | { kind: "api"; lease: string; path: string; method?: string }
  | { kind: "lan"; lease: string; target: "dish" | "router"; bytes: number[] }
  | { kind: "cloud"; lease: string; path: string; method?: string; body?: unknown };
export interface LocalHost {
  request: (request: LocalRequest) => Promise<LocalReply>;
  subscribe?: (listener: (state: LocalState) => void) => () => void;
}
