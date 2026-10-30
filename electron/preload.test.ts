import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as channels from "./ipc";

describe("Windows account preload boundary", () => {
  it("strips Electron events from renderer callbacks and removes the exact registered listeners", () => {
    const ipc = new EventEmitter();
    let bridge!: {
      onOpenAccounts: (callback: (...args: unknown[]) => void) => () => void;
      onAccountsChanged: (callback: (...args: unknown[]) => void) => () => void;
      onLocalState: (callback: (...args: unknown[]) => void) => () => void;
    };
    const source = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
    const script = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(script, {
      exports: {},
      process: { platform: "win32", versions: {} },
      require: (id: string) => {
        if (id === "electron")
          return {
            ipcRenderer: ipc,
            contextBridge: {
              exposeInMainWorld: (_name: string, value: typeof bridge) => {
                bridge = value;
              },
            },
          };
        if (id === "./ipc") return channels;
        throw new Error("Unexpected preload dependency");
      },
    });
    const home: unknown[][] = [];
    const changes: unknown[][] = [];
    const states: unknown[][] = [];
    const stopStates = bridge.onLocalState((...args) => states.push(args));
    const stopHome = bridge.onOpenAccounts((...args) => home.push(args));
    const stopChanges = bridge.onAccountsChanged((...args) => changes.push(args));
    const privateEvent = { sender: { privileged: true } };
    const change = { kind: "snapshots", accountId: "ACC-A" };
    ipc.emit(channels.ACCOUNT_HOME_CHANNEL, privateEvent);
    ipc.emit(channels.ACCOUNT_CHANGED_CHANNEL, privateEvent, change);
    ipc.emit(channels.LOCAL_STATE_CHANNEL, privateEvent, { version: 1 });
    expect(states).toEqual([[{ version: 1 }]]);
    stopStates();
    ipc.emit(channels.LOCAL_STATE_CHANNEL, privateEvent, { version: 1 });
    expect(states).toHaveLength(1);
    expect(home).toEqual([[]]);
    expect(changes).toEqual([[change]]);
    stopHome();
    stopChanges();
    ipc.emit(channels.ACCOUNT_HOME_CHANNEL, privateEvent);
    ipc.emit(channels.ACCOUNT_CHANGED_CHANNEL, privateEvent, change);
    expect(home).toHaveLength(1);
    expect(changes).toHaveLength(1);
  });
});
