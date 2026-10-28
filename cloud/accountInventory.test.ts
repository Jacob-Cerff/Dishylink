import { describe, expect, it } from "vitest";
import { readAccountInventory } from "./accountInventory";

describe("complete portal inventory", () => {
  it("reads beyond page zero and keeps every account, service, and replacement terminal", async () => {
    const pages: number[] = [];
    let active = 0;
    let peak = 0;
    const inventory = await readAccountInventory(
      async (path) => {
        if (path.includes("service-lines?")) {
          const page = Number(new URL(path, "https://example.invalid").searchParams.get("page"));
          pages.push(page);
          return {
            content: {
              totalCount: 101,
              results: Array.from({ length: page === 0 ? 100 : 1 }, (_, i) => ({
                serviceLineNumber: `SL-${page * 100 + i}`,
                accountReferenceId: i % 2 ? "ACC-B" : "ACC-A",
              })),
            },
          };
        }
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        const serviceLineNumber = path.split("/").pop()!;
        return {
          content: {
            serviceLineNumber,
            nickname: "Site",
            userTerminals: [
              { userTerminalId: `old-${serviceLineNumber}`, routers: [{ routerId: "r-1" }] },
              { userTerminalId: `new-${serviceLineNumber}` },
            ],
          },
        };
      },
      { name: "Test user", accountId: "ACC-EMPTY" },
    );
    expect(pages).toEqual([0, 1]);
    expect(inventory.accounts.map((a) => a.accountId)).toEqual(["ACC-EMPTY", "ACC-A", "ACC-B"]);
    expect(inventory.services).toHaveLength(101);
    expect(inventory.services[100].terminals).toEqual([
      { terminalId: "old-SL-100", routerIds: ["r-1"] },
      { terminalId: "new-SL-100", routerIds: [] },
    ]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("accepts an identity with no services without inventing a primary service", async () => {
    expect(
      await readAccountInventory(async () => ({ content: { results: [] } }), {
        accountId: "ACC-1",
      }),
    ).toEqual({
      accounts: [{ accountId: "ACC-1" }],
      services: [],
    });
  });

  it("does not treat an unreadable inventory as an empty account", async () => {
    await expect(
      readAccountInventory(async () => ({ error: "unavailable" }), {}),
    ).rejects.toThrow();
  });

  it("rejects a detail response belonging to another account", async () => {
    await expect(
      readAccountInventory(
        async (path) =>
          path.includes("service-lines?")
            ? { content: { results: [{ serviceLineNumber: "SL-1", accountReferenceId: "ACC-A" }] } }
            : { content: { serviceLineNumber: "SL-1", accountReferenceId: "ACC-B" } },
        {},
      ),
    ).rejects.toThrow();
  });

  it.each([undefined, 200])(
    "stops repeated pages even when totalCount is %s",
    async (totalCount) => {
      await expect(
        readAccountInventory(
          async (path) =>
            path.includes("service-lines?")
              ? {
                  content: {
                    totalCount,
                    results: Array.from({ length: 100 }, (_, i) => ({
                      serviceLineNumber: `SL-${i}`,
                      accountReferenceId: "ACC-A",
                    })),
                  },
                }
              : { content: {} },
          {},
        ),
      ).rejects.toThrow(/pagination/i);
    },
  );

  it("fails on an invalid upstream identifier before interpolating it into another URL", async () => {
    let calls = 0;
    await expect(
      readAccountInventory(async () => {
        calls++;
        return {
          content: { results: [{ serviceLineNumber: "../escape", accountReferenceId: "ACC-A" }] },
        };
      }, {}),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
