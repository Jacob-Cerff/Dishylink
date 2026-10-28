import { describe, expect, it } from "vitest";
import { assertDishContext, mergeAccountAccess, type AccountInventory } from "./accountContext";

const inventory: AccountInventory = {
  accounts: [{ accountId: "ACC-A", name: "Office" }],
  services: [
    {
      accountId: "ACC-A",
      serviceLineNumber: "SL-1",
      terminals: [{ terminalId: "dish-1", routerIds: ["router-1"] }],
    },
    { accountId: "ACC-A", serviceLineNumber: "SL-2", terminals: [] },
  ],
};

describe("account target boundaries", () => {
  it("allows a discovered dish under its own service and credential", () => {
    expect(
      assertDishContext(
        {
          credentialId: "login-a",
          accountId: "ACC-A",
          serviceLineNumber: "SL-1",
          terminalId: "dish-1",
        },
        "login-a",
        inventory,
      ).routerIds,
    ).toEqual(["router-1"]);
  });

  it.each([
    { credentialId: "login-b" },
    { accountId: "ACC-B" },
    { serviceLineNumber: "SL-2" },
    { terminalId: "dish-2" },
    { terminalId: "../dish-1" },
    { accountId: "https://other.invalid" },
  ])("rejects a mismatched target %j", (changes) => {
    expect(() =>
      assertDishContext(
        {
          credentialId: "login-a",
          accountId: "ACC-A",
          serviceLineNumber: "SL-1",
          terminalId: "dish-1",
          ...changes,
        },
        "login-a",
        inventory,
      ),
    ).toThrow();
  });

  it("deduplicates a Starlink account shared by two logins while retaining both access paths", () => {
    expect(
      mergeAccountAccess([
        { credentialId: "login-a", inventory },
        { credentialId: "login-b", inventory },
      ]),
    ).toEqual([{ accountId: "ACC-A", name: "Office", credentialIds: ["login-a", "login-b"] }]);
  });

  it("does not authorize a terminal removed from the latest inventory", () => {
    expect(() =>
      assertDishContext(
        {
          credentialId: "login-a",
          accountId: "ACC-A",
          serviceLineNumber: "SL-1",
          terminalId: "dish-1",
        },
        "login-a",
        { ...inventory, services: [] },
      ),
    ).toThrow();
  });
});
