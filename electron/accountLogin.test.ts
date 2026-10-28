import { describe, expect, it } from "vitest";
import { runAccountLogin, type LoginHost } from "./accountLogin";
import type { CloudResult } from "../cloud/starlinkCloudHandler";

function host() {
  let cookie: string | null = null;
  let changed = () => {};
  let closed = () => {};
  let ready = () => {};
  let windows = 0;
  let listeners = 0;
  let destroyed = 0;
  const adapter: LoginHost = {
    readCookie: async () => cookie,
    onCookieChanged: (listener) => {
      changed = listener;
      listeners++;
      return () => {
        listeners--;
        changed = () => {};
      };
    },
    createWindow: () => {
      windows++;
      return {
        onReady: (listener) => {
          ready = listener;
        },
        onClosed: (listener) => {
          closed = listener;
        },
        load: () => {
          ready();
        },
        destroy: () => {
          destroyed++;
          closed();
        },
      };
    },
  };
  return {
    adapter,
    setCookie: (value: string) => {
      cookie = value;
      changed();
    },
    close: () => closed(),
    counts: () => ({ windows, listeners, destroyed }),
  };
}

describe("native sign-in lifecycle", () => {
  it("adopts a valid existing partition without flashing a login window", async () => {
    const native = host();
    native.setCookie("Starlink.Com.Sso=existing");
    const result = await runAccountLogin(
      native.adapter,
      async () => ({ status: 200, body: { credentialId: "login-a" } }),
      new AbortController().signal,
      0,
    );
    expect(result.status).toBe(200);
    expect(native.counts().windows).toBe(0);
  });
  it("waits for sign-in cookies, validates them, and removes listeners after success", async () => {
    const native = host();
    let sawCookie = "";
    const loggingIn = runAccountLogin(
      native.adapter,
      async (cookie) => {
        sawCookie = cookie;
        return { status: 200, body: { credentialId: "login-a" } };
      },
      new AbortController().signal,
      0,
    );
    await Promise.resolve();
    native.setCookie("Starlink.Com.Sso=new");
    expect((await loggingIn).status).toBe(200);
    expect(sawCookie).toBe("Starlink.Com.Sso=new");
    expect(native.counts()).toEqual({ windows: 1, listeners: 0, destroyed: 1 });
  });
  it("cancels cleanly while an adoption request is still pending", async () => {
    const native = host();
    let release!: (result: CloudResult) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const loggingIn = runAccountLogin(
      native.adapter,
      async () =>
        new Promise((resolve) => {
          release = resolve;
          notifyStarted();
        }),
      new AbortController().signal,
      0,
    );
    await Promise.resolve();
    native.setCookie("Starlink.Com.Sso=new");
    await started;
    native.close();
    expect((await loggingIn).status).toBe(499);
    release({ status: 200, body: {} });
    await Promise.resolve();
    expect(native.counts().listeners).toBe(0);
  });
  it("aborts an open reconnect window without adopting cookies afterwards", async () => {
    const native = host();
    const abort = new AbortController();
    let calls = 0;
    const loggingIn = runAccountLogin(
      native.adapter,
      async () => {
        calls++;
        return { status: 200, body: {} };
      },
      abort.signal,
      0,
    );
    await Promise.resolve();
    abort.abort();
    expect((await loggingIn).status).toBe(499);
    native.setCookie("Starlink.Com.Sso=late");
    expect(calls).toBe(0);
    expect(native.counts().listeners).toBe(0);
  });
});
