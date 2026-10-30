import { describe, expect, it } from "vitest";
import { localBinding, sameTerminal } from "./localSource";
import type { CredentialSummary } from "../cloud/accountRegistry";
const context = {
  credentialId: "login-a",
  accountId: "ACC-A",
  serviceLineNumber: "SL-A",
  terminalId: "dish-a",
};
const session: CredentialSummary = {
  credentialId: "login-a",
  label: "A",
  state: "connected",
  tracking: true,
  inventory: {
    accounts: [{ accountId: "ACC-A" }],
    services: [
      {
        accountId: "ACC-A",
        serviceLineNumber: "SL-A",
        terminals: [{ terminalId: "dish-a", routerIds: ["router-a"] }],
      },
    ],
  },
};
describe("local source ownership", () => {
  it("matches only the selected terminal, allowing the upstream ut prefix", () => {
    expect(sameTerminal("utdish-a", "dish-a")).toBe(true);
    expect(sameTerminal("utdish-a", "dish-b")).toBe(false);
    expect(sameTerminal(null, "dish-a")).toBe(false);
  });
  it("permits controls only with a connected exact credential/account/service/dish/router association", () => {
    expect(localBinding([session], context, "utdish-a", "Router-router-a")).toBe(true);
    for (const changed of [
      { ...context, accountId: "ACC-B" },
      { ...context, credentialId: "login-b" },
      { ...context, serviceLineNumber: "SL-B" },
      { ...context, terminalId: "dish-b" },
    ])
      expect(localBinding([session], changed, "utdish-a", "Router-router-a")).toBe(false);
    expect(localBinding([session], context, "utdish-a", null)).toBe(false);
    expect(localBinding([session], context, "utdish-a", "Router-other")).toBe(false);
    expect(
      localBinding(
        [{ ...session, state: "reconnect-required" }],
        context,
        "utdish-a",
        "Router-router-a",
      ),
    ).toBe(false);
  });
});
