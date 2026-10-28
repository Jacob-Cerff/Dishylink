/** Public identities only. A saved login and a Starlink billing account are different things. */
export interface AccountRef {
  accountId: string;
  name?: string;
}

export interface TerminalRef {
  terminalId: string;
  serialNumber?: string;
  routerIds: string[];
}

export interface ServiceRef {
  accountId: string;
  serviceLineNumber: string;
  nickname?: string;
  address?: string;
  terminals: TerminalRef[];
}

export interface AccountInventory {
  accounts: AccountRef[];
  services: ServiceRef[];
}

export interface DishContext {
  credentialId: string;
  accountId: string;
  serviceLineNumber: string;
  terminalId: string;
}

export type ScopedCloudRoute = "/cloud/account" | "/cloud/telemetry" | "/cloud/usage";

/** IDs are data, never URLs, paths, or user-provided labels. */
export function validAccountId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
}

export function isAccountInventory(value: unknown): value is AccountInventory {
  const inventory = value as AccountInventory | null;
  return Boolean(
    inventory &&
    Array.isArray(inventory.accounts) &&
    Array.isArray(inventory.services) &&
    inventory.accounts.every(
      (account) =>
        account &&
        validAccountId(account.accountId) &&
        (account.name === undefined || typeof account.name === "string"),
    ) &&
    inventory.services.every(
      (service) =>
        service &&
        validAccountId(service.accountId) &&
        validAccountId(service.serviceLineNumber) &&
        inventory.accounts.some((account) => account.accountId === service.accountId) &&
        (service.nickname === undefined || typeof service.nickname === "string") &&
        (service.address === undefined || typeof service.address === "string") &&
        Array.isArray(service.terminals) &&
        service.terminals.every(
          (terminal) =>
            terminal &&
            validAccountId(terminal.terminalId) &&
            (terminal.serialNumber === undefined || typeof terminal.serialNumber === "string") &&
            Array.isArray(terminal.routerIds) &&
            terminal.routerIds.every(validAccountId),
        ),
    ),
  );
}

export function assertDishContext(
  value: unknown,
  credentialId: string,
  inventory: AccountInventory,
): TerminalRef {
  const context = value as Partial<DishContext> | null;
  if (
    !context ||
    context.credentialId !== credentialId ||
    ![context.credentialId, context.accountId, context.serviceLineNumber, context.terminalId].every(
      validAccountId,
    )
  )
    throw new Error("Invalid dish context");
  const service = inventory.services.find(
    (item) =>
      item.accountId === context.accountId && item.serviceLineNumber === context.serviceLineNumber,
  );
  const terminal = service?.terminals.find((item) => item.terminalId === context.terminalId);
  if (!inventory.accounts.some((item) => item.accountId === context.accountId) || !terminal)
    throw new Error("Dish is not in this account and service");
  return terminal;
}

export function mergeAccountAccess(
  sessions: { credentialId: string; inventory: AccountInventory }[],
): (AccountRef & { credentialIds: string[] })[] {
  const accounts = new Map<string, AccountRef & { credentialIds: string[] }>();
  for (const session of sessions) {
    for (const account of session.inventory.accounts) {
      const existing = accounts.get(account.accountId);
      if (existing) {
        if (!existing.credentialIds.includes(session.credentialId))
          existing.credentialIds.push(session.credentialId);
      } else accounts.set(account.accountId, { ...account, credentialIds: [session.credentialId] });
    }
  }
  return [...accounts.values()];
}
