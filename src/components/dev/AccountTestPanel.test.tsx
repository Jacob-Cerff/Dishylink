import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { AccountTestPanel, type AccountTestRequest } from "./AccountTestPanel";

const session = (key: string) => ({
  credentialId: `login-${key}`,
  label: `Account ${key.toUpperCase()}`,
  state: "connected",
  tracking: true,
  inventory: {
    accounts: [{ accountId: `ACC-${key}` }],
    services: [
      {
        accountId: `ACC-${key}`,
        serviceLineNumber: `SL-${key}`,
        terminals: [{ terminalId: `dish-${key}`, routerIds: [] }],
      },
    ],
  },
});

describe("development read-only account test", () => {
  it("reads persisted snapshots without an upstream read and refreshes only the named account", async () => {
    const request = vi.fn(async (input: AccountTestRequest) =>
      input.kind === "list"
        ? { status: 200, body: { sessions: [session("a"), session("b")] } }
        : { status: 200, body: { snapshot: { status: "offline" }, refresh: { nextDueAt: 12345 } } },
    );
    render(<AccountTestPanel request={request} />);
    await page
      .getByRole("button", { name: "Read cached snapshot for dish-b (Account B)", exact: true })
      .click();
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: "remote-cache",
      context: {
        credentialId: "login-b",
        accountId: "ACC-b",
        serviceLineNumber: "SL-b",
        terminalId: "dish-b",
      },
    });
    await expect
      .element(page.getByLabelText("Telemetry result"))
      .toHaveTextContent('"nextDueAt": 12345');
    await page
      .getByRole("button", { name: "Refresh snapshots for ACC-b (Account B)", exact: true })
      .click();
    expect(
      request.mock.calls.some(
        ([r]) =>
          r.kind === "remote-refresh" && r.credentialId === "login-b" && r.accountId === "ACC-b",
      ),
    ).toBe(true);
    expect(request.mock.calls.filter(([r]) => r.kind === "read")).toHaveLength(0);
  });
  it("shows the manual refresh cooldown without silently falling back to a raw live read", async () => {
    const request = vi.fn(async (input: AccountTestRequest) =>
      input.kind === "list"
        ? { status: 200, body: { sessions: [session("a")] } }
        : { status: 429, body: { error: "refresh_cooldown", retryAfterMs: 300000 } },
    );
    render(<AccountTestPanel request={request} />);
    await page
      .getByRole("button", { name: "Refresh snapshots for ACC-a (Account A)", exact: true })
      .click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("refresh_cooldown");
    expect(request.mock.calls.filter(([r]) => r.kind === "read")).toHaveLength(0);
  });
  it("opens separate native sign-ins and refreshes the saved connection list after each", async () => {
    const sessions: ReturnType<typeof session>[] = [];
    const request = vi.fn(async (input: AccountTestRequest) => {
      if (input.kind === "sign-in") sessions.push(session(input.label === "Account A" ? "a" : "b"));
      return input.kind === "list"
        ? { status: 200, body: { sessions: [...sessions] } }
        : { status: 200, body: {} };
    });
    render(<AccountTestPanel request={request} />);
    await page.getByRole("button", { name: "Sign in Account A", exact: true }).click();
    await expect
      .element(page.getByRole("heading", { name: "Account A", exact: true }))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Sign in Account B", exact: true }).click();
    await expect
      .element(page.getByRole("heading", { name: "Account B", exact: true }))
      .toBeInTheDocument();
    expect(
      request.mock.calls.filter(([input]) => input.kind === "sign-in").map(([input]) => input),
    ).toEqual([
      { kind: "sign-in", label: "Account A" },
      { kind: "sign-in", label: "Account B" },
    ]);
  });

  it("reads the chosen dish using its own credential and service context", async () => {
    const request = vi.fn(async (input: AccountTestRequest) =>
      input.kind === "list"
        ? { status: 200, body: { sessions: [session("a"), session("b")] } }
        : {
            status: 200,
            body: {
              deviceTelemetry: { "utdish-b": { kind: "dish", uptimeS: 123, activeAlerts: [777] } },
            },
          },
    );
    render(<AccountTestPanel request={request} />);
    await page
      .getByRole("button", { name: "Read telemetry for dish-b (Account B)", exact: true })
      .click();
    await expect
      .element(page.getByLabelText("Telemetry result"))
      .toHaveTextContent('"uptimeS": 123');
    await expect
      .element(page.getByLabelText("Telemetry result"))
      .toHaveTextContent('"activeAlerts"');
    await expect.element(page.getByLabelText("Telemetry result")).toHaveTextContent("777");
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: "read",
      credentialId: "login-b",
      route: "/cloud/telemetry",
      context: {
        credentialId: "login-b",
        accountId: "ACC-b",
        serviceLineNumber: "SL-b",
        terminalId: "dish-b",
      },
    });
  });

  it("shows a failed sign-in without pretending an account connected or exposing exception details", async () => {
    const request = vi.fn(async (input: AccountTestRequest) => {
      if (input.kind === "sign-in") throw new Error("private-cookie-do-not-display");
      return { status: 200, body: { sessions: [] } };
    });
    render(<AccountTestPanel request={request} />);
    await page.getByRole("button", { name: "Sign in Account A", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("could not complete");
    expect(document.body.textContent).not.toContain("private-cookie");
    await expect
      .element(page.getByText("No saved sign-ins yet.", { exact: true }))
      .toBeInTheDocument();
  });
});
