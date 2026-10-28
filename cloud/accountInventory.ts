import {
  validAccountId,
  type AccountInventory,
  type AccountRef,
  type ServiceRef,
} from "../core/accountContext";

type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid portal response");
  return value as JsonObject;
}
function id(value: unknown): string {
  if (!validAccountId(value)) throw new Error("Invalid portal identifier");
  return value;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Uses only the service-list/detail endpoints already used by this project.
 * Discovery covers account references returned by that list and the auth identity;
 * additional empty accounts cannot be inferred from an undocumented endpoint.
 */
export async function readAccountInventory(
  get: (path: string) => Promise<unknown>,
  identity: unknown,
): Promise<AccountInventory> {
  const accounts = new Map<string, AccountRef>();
  const profile = object(identity);
  if (validAccountId(profile.accountId)) {
    accounts.set(profile.accountId, {
      accountId: profile.accountId,
      ...(text(profile.name) ? { name: text(profile.name) } : {}),
    });
  }
  const services = new Map<string, ServiceRef>();
  let rowsRead = 0;
  for (let page = 0; ; page++) {
    if (page >= 1000) throw new Error("Inventory pagination limit exceeded");
    const reply = object(
      await get(
        `/webagg/v2/accounts/service-lines?limit=100&page=${page}&isConverting=false&serviceAddressId=&onlyActive=false&searchString=&onlyNoUts=false`,
      ),
    );
    const content = object(reply.content);
    if (!Array.isArray(content.results)) throw new Error("Missing service inventory");
    const before = services.size;
    for (const value of content.results) {
      const row = object(value);
      const accountId = id(row.accountReferenceId);
      const serviceLineNumber = id(row.serviceLineNumber);
      if (!accounts.has(accountId)) accounts.set(accountId, { accountId });
      services.set(`${accountId}/${serviceLineNumber}`, {
        accountId,
        serviceLineNumber,
        terminals: [],
      });
    }
    rowsRead += content.results.length;
    if (services.size !== rowsRead) throw new Error("Inventory pagination duplicated services");
    const total = content.totalCount;
    if (
      total !== undefined &&
      (typeof total !== "number" || !Number.isSafeInteger(total) || total < services.size)
    )
      throw new Error("Invalid inventory total");
    if (typeof total === "number" ? rowsRead >= total : content.results.length < 100) break;
    if (services.size === before || content.results.length === 0)
      throw new Error("Inventory pagination made no progress");
  }

  const all = [...services.values()];
  for (let offset = 0; offset < all.length; offset += 2) {
    await Promise.all(
      all.slice(offset, offset + 2).map(async (service) => {
        const detail = object(
          object(await get(`/webagg/v2/accounts/service-line/${service.serviceLineNumber}`))
            .content,
        );
        if (
          (detail.serviceLineNumber !== undefined &&
            detail.serviceLineNumber !== service.serviceLineNumber) ||
          (detail.accountReferenceId !== undefined &&
            detail.accountReferenceId !== service.accountId)
        )
          throw new Error("Service detail did not match the selected account");
        service.nickname = text(detail.nickname);
        if (detail.serviceAddress)
          service.address = text(object(detail.serviceAddress).formattedAddress);
        if (detail.userTerminals !== undefined && !Array.isArray(detail.userTerminals))
          throw new Error("Invalid terminals");
        const terminals = new Map<string, ServiceRef["terminals"][number]>();
        for (const value of (detail.userTerminals ?? []) as unknown[]) {
          const terminal = object(value);
          const terminalId = id(terminal.userTerminalId);
          if (terminal.routers !== undefined && !Array.isArray(terminal.routers))
            throw new Error("Invalid routers");
          terminals.set(terminalId, {
            terminalId,
            ...(text(terminal.serialNumber) ? { serialNumber: text(terminal.serialNumber) } : {}),
            routerIds: [
              ...new Set(
                ((terminal.routers ?? []) as unknown[]).map((router) =>
                  id(object(router).routerId),
                ),
              ),
            ],
          });
        }
        service.terminals = [...terminals.values()];
      }),
    );
  }
  return { accounts: [...accounts.values()], services: all };
}
