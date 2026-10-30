import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const workers = vi.hoisted(() => [] as EventEmitter[]);
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super();
      workers.push(this);
    }
    postMessage() {}
    terminate() {
      return Promise.resolve(0);
    }
  },
}));
import { openRecorderWorker } from "./recorderWorkerHost";
it("rejects startup promptly if the recorder exits before ready", async () => {
  const pending = openRecorderWorker({
    terminalId: "test-dish",
    dataDirectory: "unused",
    protoset: "unused",
    hostIdentity: () => ({ macAddresses: [], ipAddresses: [] }),
    observe: () => {},
    changed: () => {},
    alerts: () => {},
    pause: async () => {},
  });
  const outcome = pending.then(
    () => "ready",
    () => "rejected",
  );
  workers.at(-1)!.emit("exit", 0);
  expect(
    await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve("hung"), 50))]),
  ).toBe("rejected");
});
