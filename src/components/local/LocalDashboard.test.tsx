import { describe, expect, it } from "vitest";

import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { LocalDashboard } from "./LocalDashboard";
import type { LocalHost, LocalState } from "@core/localSource";

const ready: LocalState = {
  version: 1,
  status: "ready",
  terminalId: "dish-a",
  routerId: "router-a",
  generation: 1,
  recording: true,
  controls: false,
  viewActive: false,
};
describe("guarded local dashboard", () => {
  it("reacquires the local view after replacement of the same credential", async () => {
    const listeners = new Set<(state: LocalState) => void>();
    let state: LocalState = { ...ready, authorizationGeneration: 0 };
    const leases: string[] = [];
    const context = {
      credentialId: "login-a",
      accountId: "ACC-A",
      serviceLineNumber: "SL-A",
      terminalId: "dish-a",
    };
    const host: LocalHost = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      request: async (request) => {
        if (request.kind === "select") {
          const lease = "lease-" + (leases.length + 1);
          leases.push(lease);
          return { status: 200, body: { lease, state } };
        }

        return { status: 200, body: state };
      },
    };
    const view = await render(
      <LocalDashboard
        host={host}
        context={context}
        renderLocal={(lease) => <p data-testid='local-lease'>{lease}</p>}
      />,
    );
    await expect.element(page.getByTestId("local-lease")).toBeInTheDocument();
    const original = leases[0];
    state = { ...state, authorizationGeneration: 1 };
    for (const listener of listeners) listener(state);
    await expect.poll(() => leases.length).toBe(2);
    expect(leases[1]).not.toBe(original);
    await expect.element(page.getByTestId("local-lease")).toHaveTextContent(leases[1]);
    await view.unmount();
  });
  it("keeps legacy LAN hooks unmounted until explicit local verification and removes them when identity changes", async () => {
    let state: LocalState = { ...ready, status: "idle", terminalId: null, recording: false };
    let notify!: (state: LocalState) => void;
    const operations: string[] = [];
    const host: LocalHost = {
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      request: async (request) => {
        operations.push(request.kind);
        if (request.kind === "state") return { status: 200, body: state };
        if (request.kind === "connect") {
          state = ready;
          notify(state);
          return { status: 200, body: state };
        }
        if (request.kind === "select")
          return { status: 200, body: { lease: "lease-a", state: ready } };
        return { status: 200, body: {} };
      },
    };
    render(<LocalDashboard host={host} renderLocal={() => <p>Verified local dashboard</p>} />);
    await expect
      .element(page.getByRole("button", { name: "Connect local dish", exact: true }))
      .toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Verified local dashboard");
    expect(operations).toEqual(["state"]);
    await page.getByRole("button", { name: "Connect local dish", exact: true }).click();
    await expect
      .element(page.getByText("Verified local dashboard", { exact: true }))
      .toBeInTheDocument();
    state = { ...ready, status: "changed", generation: 2, terminalId: null, recording: false };
    notify(state);
    await expect
      .element(page.getByRole("button", { name: "Connect local dish", exact: true }))
      .toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Verified local dashboard");
  });
});
