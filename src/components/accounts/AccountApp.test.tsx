import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { AccountApp } from "./AccountApp";
import { AccountClient, type AccountTransport } from "../../lib/accountClient";
import type { AccountRequest } from "@core/accountBridge";
import type { CredentialSummary } from "../../../cloud/accountRegistry";
const now = Date.now();
const session = (key: string, multiple = false): CredentialSummary => ({
  credentialId: `login-${key}`,
  label: `Login ${key}`,
  state: "connected",
  tracking: true,
  inventory: {
    accounts: [{ accountId: `ACC-${key}`, name: `Account ${key}` }],
    services: [
      {
        accountId: `ACC-${key}`,
        serviceLineNumber: `SL-${key}`,
        nickname: `Site ${key}`,
        terminals: [
          { terminalId: `dish-${key}`, routerIds: [] },
          ...(multiple ? [{ terminalId: `dish-${key}-replacement`, routerIds: [] }] : []),
        ],
      },
    ],
  },
});
function cache(
  r: Extract<AccountRequest, { kind: "remote-cache" }>,
  options: { offline?: boolean; stale?: boolean; expected?: boolean } = {},
) {
  return {
    snapshot: {
      ...r.context,
      source: "cloud",
      status: options.offline ? "offline" : "online",
      observedAt: options.stale ? now - 86400000 : now,
      fetchedAt: now,
      dish: options.offline
        ? undefined
        : {
            kind: "dish",
            deviceId: `ut${r.context.terminalId}`,
            observedAt: now,
            obstructionFraction: 0.05,
            uptimeS: 3600,
            softwareVersion: `software-${r.context.accountId}`,
          },
      routers: [],
    },
    refresh: {
      credentialId: r.context.credentialId,
      accountId: r.context.accountId,
      intervalHours: 2,
      nextDueAt: now + 7200000,
      retryCount: 0,
      lastSuccessAt: now,
    },
    overdue: false,
    expectation: {
      enabled: !!options.expected,
      ...(options.expected ? { reason: "Holiday closure" } : {}),
    },
  };
}
const transport =
  (
    sessions: CredentialSummary[],
    other?: (r: AccountRequest) => Promise<{ status: number; body: unknown }>,
  ): AccountTransport =>
  async (r) =>
    r.kind === "list"
      ? { status: 200, body: { sessions } }
      : other
        ? other(r)
        : r.kind === "remote-cache"
          ? { status: 200, body: cache(r) }
          : { status: 200, body: {} };
beforeEach(() => {
  window.location.hash = "";
});
describe("production accounts navigation", () => {
  it("starts at Accounts and opens only the selected account service and remote details", async () => {
    const calls: AccountRequest[] = [];
    const real = transport([session("A"), session("B")]);
    const request: AccountTransport = async (r) => {
      calls.push(r);
      return real(r);
    };
    render(
      <AccountApp client={new AccountClient(request)} localView={<p>Local view sentinel</p>} />,
    );
    await page.getByRole("button", { name: "Open Account B", exact: true }).click();
    await expect
      .element(page.getByRole("heading", { name: "Services", exact: true }))
      .toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Site A");
    await page.getByRole("button", { name: "Open Site B", exact: true }).click();
    await expect.element(page.getByText("5%", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("software-ACC-B", { exact: true })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Local view sentinel");
    expect(
      calls.some((r) => r.kind === "read" || r.kind === "refresh" || r.kind === "remote-refresh"),
    ).toBe(false);
    expect(
      calls.filter((r) => r.kind === "remote-cache" && r.context.accountId === "ACC-B"),
    ).toHaveLength(1);
  });
  it("offers an accessible add/import flow and local-only entry without saved accounts", async () => {
    const request = vi.fn(
      transport([], async (r) =>
        r.kind === "sign-in"
          ? { status: 499, body: {} }
          : { status: 400, body: { error: "invalid_session_import" } },
      ),
    );
    render(
      <AccountApp client={new AccountClient(request)} localView={<p>Local view sentinel</p>} />,
    );
    await expect
      .element(page.getByText("No connected accounts yet.", { exact: true }))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Add account", exact: true }).click();
    await page.getByLabelText("Connection name").fill("Office");
    await page.getByRole("button", { name: "Sign in to Starlink", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Sign-in cancelled");
    await page.getByRole("button", { name: "Import active session cookie", exact: true }).click();
    await page
      .getByLabelText("Active session cookie")
      .fill("Starlink.Com.Sso=fake-sensitive-cookie");
    await page.getByRole("button", { name: "Import session", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("could not connect");
    await expect.element(page.getByLabelText("Active session cookie")).toHaveValue("");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Local monitoring", exact: true }).click();
    await expect.element(page.getByText("Local view sentinel")).toBeInTheDocument();
  });
  it("requires explicit choice within a multi-terminal service", async () => {
    window.location.hash = "#/accounts/ACC-A/services/SL-A";
    const request = vi.fn(transport([session("A", true)]));
    render(<AccountApp client={new AccountClient(request)} localView={null} />);
    await expect
      .element(page.getByText("Choose a dish to view its readings.", { exact: true }))
      .toBeInTheDocument();
    expect(request.mock.calls.some(([r]) => r.kind === "remote-cache")).toBe(false);
    await page.getByLabelText("Dish").selectOptions("dish-A-replacement");
    await expect.element(page.getByText("5%", { exact: true })).toBeInTheDocument();
    expect(window.location.hash).toContain("/terminals/dish-A-replacement");
  });
  it("shows reported offline plus expected-offline context, separate from subscription", async () => {
    window.location.hash = "#/accounts/ACC-A";
    render(
      <AccountApp
        client={
          new AccountClient(
            transport([session("A")], async (r) => ({
              status: 200,
              body: r.kind === "remote-cache" ? cache(r, { offline: true, expected: true }) : {},
            })),
          )
        }
        localView={null}
      />,
    );
    await expect.element(page.getByText("Offline", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Holiday closure", { exact: true })).toBeInTheDocument();
    await expect
      .element(page.getByText("Subscription status unavailable", { exact: true }))
      .toBeInTheDocument();
  });
  it("retains online status for old observations and presents cooldown after manual refresh", async () => {
    window.location.hash = "#/accounts/ACC-A/services/SL-A";
    const request = vi.fn(
      transport([session("A")], async (r) =>
        r.kind === "remote-cache"
          ? { status: 200, body: cache(r, { stale: true }) }
          : { status: 429, body: { retryAfterMs: 300000 } },
      ),
    );
    render(<AccountApp client={new AccountClient(request)} localView={null} />);
    await expect.element(page.getByText("Stale observation", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Online", { exact: true })).toBeInTheDocument();
    await page.getByRole("button", { name: "Refresh now", exact: true }).click();
    await expect.element(page.getByRole("button", { name: /Refresh available in/ })).toBeDisabled();
    expect(document.body.textContent).not.toContain("Offline");
  });
  it("rejects a service route belonging to another account before any cache read", async () => {
    window.location.hash = "#/accounts/ACC-A/services/SL-B";
    const request = vi.fn(transport([session("A"), session("B")]));
    render(<AccountApp client={new AccountClient(request)} localView={null} />);
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("not available in this account");
    expect(request.mock.calls.some(([r]) => r.kind === "remote-cache")).toBe(false);
  });
});

describe("account lifecycle and fleet coverage", () => {
  it("lists all nine accounts and every service without a ten-service cap", async () => {
    const fleet = Array.from({ length: 9 }, (_, index) => {
      const s = session(String(index + 1));
      s.inventory.services = Array.from(
        { length: index === 0 ? 12 : index < 3 ? 6 : index < 7 ? 5 : 3 },
        (_, j) => ({
          ...s.inventory.services[0],
          serviceLineNumber: `SL-${index + 1}-${j + 1}`,
          nickname: `Site ${index + 1}-${j + 1}`,
          terminals: [{ terminalId: `dish-${index + 1}-${j + 1}`, routerIds: [] }],
        }),
      );
      return s;
    });
    render(<AccountApp client={new AccountClient(transport(fleet))} localView={null} />);
    await expect
      .element(page.getByRole("button", { name: "Open Account 9", exact: true }))
      .toBeInTheDocument();
    expect(document.querySelectorAll('button[aria-label^="Open Account"]')).toHaveLength(9);
    await page.getByRole("button", { name: "Open Account 1", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Open Site 1-12", exact: true }))
      .toBeInTheDocument();
    expect(document.querySelectorAll('button[aria-label^="Open Site"]')).toHaveLength(12);
  });
  it("drops a delayed A reading when navigating to B, and returns to Accounts on window entry", async () => {
    window.location.hash = "#/accounts/ACC-A/services/SL-A";
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    let entered!: () => void;
    const request = transport([session("A"), session("B")], async (r) => {
      if (r.kind !== "remote-cache") return { status: 200, body: {} };
      if (r.context.accountId === "ACC-A") await gate;
      return { status: 200, body: cache(r) };
    });
    render(
      <AccountApp
        client={new AccountClient(request)}
        localView={null}
        onOpenAccounts={(listener) => {
          entered = listener;
          return () => {};
        }}
      />,
    );
    await expect
      .element(page.getByRole("heading", { name: "Site A", exact: true }))
      .toBeInTheDocument();
    window.location.hash = "#/accounts/ACC-B/services/SL-B";
    await expect.element(page.getByText("software-ACC-B", { exact: true })).toBeInTheDocument();
    resolve();
    await expect.poll(() => document.body.textContent?.includes("software-ACC-A")).toBe(false);
    entered();
    await expect
      .element(page.getByRole("heading", { name: "Accounts", exact: true }))
      .toBeInTheDocument();
  });
  it("clears previous credentials' readings on host invalidation and rejects removed membership", async () => {
    window.location.hash = "#/accounts/ACC-A/services/SL-A";
    let sessions = [session("A")];
    let notify!: (event: import("../../lib/accountClient").AccountChange) => void;
    const client = new AccountClient(async (r) =>
      r.kind === "list"
        ? { status: 200, body: { sessions } }
        : { status: 200, body: r.kind === "remote-cache" ? cache(r) : {} },
    );
    render(
      <AccountApp
        client={client}
        localView={null}
        subscribe={(listener) => {
          notify = listener;
          return () => {};
        }}
      />,
    );
    await expect.element(page.getByText("software-ACC-A", { exact: true })).toBeInTheDocument();
    sessions = [];
    notify({ kind: "sessions" });
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("not available in this account");
    expect(document.body.textContent).not.toContain("software-ACC-A");
  });
  it("keeps unknown coverage, collection failure and old cache separate", async () => {
    window.location.hash = "#/accounts/ACC-A/services/SL-A";
    render(
      <AccountApp
        client={
          new AccountClient(
            transport([session("A")], async (r) => {
              if (r.kind !== "remote-cache") return { status: 200, body: {} };
              const data = cache(r);
              return {
                status: 200,
                body: {
                  ...data,
                  snapshot: {
                    ...data.snapshot,
                    status: "unknown",
                    dish: undefined,
                    observedAt: null,
                  },
                  refresh: { ...data.refresh, error: "network" },
                  overdue: true,
                },
              };
            }),
          )
        }
        localView={null}
      />,
    );
    await expect.element(page.getByText("Unknown", { exact: true })).toBeInTheDocument();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Check the internet connection");
    await expect
      .element(
        page.getByText("Automatic refresh is overdue by more than 15 minutes.", { exact: true }),
      )
      .toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Offline");
    expect(document.body.textContent).not.toContain("5%");
  });
  it("saves a planned holiday note without stopping tracking or altering reported status", async () => {
    window.location.hash = "#/accounts/ACC-A/services/SL-A";
    let expectation = { enabled: false, reason: "" };
    const calls: AccountRequest[] = [];
    const client = new AccountClient(
      transport([session("A")], async (r) => {
        calls.push(r);
        if (r.kind === "remote-expectation")
          expectation = { enabled: r.enabled, reason: r.reason ?? "" };
        return {
          status: 200,
          body: r.kind === "remote-cache" ? { ...cache(r, { offline: true }), expectation } : {},
        };
      }),
    );
    render(<AccountApp client={client} localView={null} />);
    await expect.element(page.getByText("Offline", { exact: true })).toBeInTheDocument();
    await page.getByRole("checkbox", { name: "Expected offline", exact: true }).click();
    await page.getByLabelText("Reason (optional)").fill("Holiday break");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(page.getByText("Holiday break", { exact: true })).toBeInTheDocument();
    expect(calls.some((r) => r.kind === "tracking")).toBe(false);
    await expect.element(page.getByText("Offline", { exact: true })).toBeInTheDocument();
  });
  it("retains a disconnected account and its inventory for cached navigation", async () => {
    const s = session("A");
    const request = vi.fn(
      transport([s], async (r) => {
        if (r.kind === "disconnect") s.state = "disconnected";
        return { status: 200, body: r.kind === "remote-cache" ? cache(r) : {} };
      }),
    );
    render(<AccountApp client={new AccountClient(request)} localView={null} />);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect.element(page.getByRole("dialog")).toHaveTextContent("Cached history is retained");
    await page.getByRole("button", { name: "Disconnect login", exact: true }).click();
    await page.getByRole("button", { name: "Open Account A", exact: true }).click();
    await page.getByRole("button", { name: "Open Site A", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Refresh now", exact: true }))
      .toBeDisabled();
    await expect.element(page.getByText("software-ACC-A", { exact: true })).toBeInTheDocument();
  });
  it("shows collection freshness on the Accounts card without a cloud refresh", async () => {
    const request = vi.fn(transport([session("A")]));
    render(<AccountApp client={new AccountClient(request)} localView={null} />);
    await expect.element(page.getByText(/Last collection:/)).toBeInTheDocument();
    expect(request.mock.calls.some(([r]) => r.kind === "remote-refresh" || r.kind === "read")).toBe(
      false,
    );
  });
  it("shows an inventory failure without describing it as an empty account", async () => {
    render(
      <AccountApp
        client={new AccountClient(async () => ({ status: 503, body: {} }))}
        localView={null}
      />,
    );
    await expect.element(page.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(document.body.textContent).not.toContain("No connected accounts yet");
  });
});

describe("keyboard and layout", () => {
  it("opens an account with the keyboard and keeps remote cards within a narrow window", async () => {
    const { userEvent } = await import("vitest/browser");
    await page.viewport(1100, 850);
    render(
      <AccountApp
        client={new AccountClient(transport([session("A"), session("B")]))}
        localView={null}
      />,
    );
    const button = page.getByRole("button", { name: "Open Account A", exact: true });
    await expect.element(button).toBeInTheDocument();
    (button.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("heading", { name: "Services", exact: true }))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Open Site A", exact: true }).click();
    await expect.element(page.getByText("5%", { exact: true })).toBeInTheDocument();
    await page.screenshot({
      path: ".superpowers/sdd/2026-10-21-multi-account-remote-monitoring/service-desktop.png",
    });
    await page.viewport(450, 850);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(450);
    await page.screenshot({
      path: ".superpowers/sdd/2026-10-21-multi-account-remote-monitoring/service-narrow.png",
    });
    await page.viewport(1100, 850);
  });
});
