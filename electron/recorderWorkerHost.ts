import { Worker } from "node:worker_threads";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Recorder } from "./localMonitor";
import type { LocalReply } from "../core/localSource";
import type { HostNetworkIdentity } from "../core/hostNetworkIdentity";
import type { AlertTransition } from "../core/alertEngine";
export async function openRecorderWorker(options: {
  terminalId: string;
  dataDirectory: string;
  protoset: string;
  hostIdentity: () => HostNetworkIdentity;
  observe: (dish: string | null, router: string | null) => void;
  changed: () => void;
  alerts: (terminalId: string, transitions: AlertTransition[]) => void;
  pause: (clientId: number, paused: boolean) => Promise<void>;
  startPaused?: boolean;
  routerAddress?: () => string | null;
}): Promise<Recorder> {
  // This is a separately built Node entry, not a browser Web Worker asset.
  const workerEntry = new URL("./recorderWorker.js", import.meta.url);
  const worker = new Worker(workerEntry, {
    workerData: {
      terminalId: options.terminalId,
      dataDirectory: options.dataDirectory,
      protoset: options.protoset,
      hostIdentity: options.hostIdentity(),
      routerAddress: options.routerAddress?.() ?? null,
    },
  });
  let closing = false;
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve: (reply: LocalReply) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const fail = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.resolve({ status: 503, body: { error: "recorder_stopped" } });
    }
    pending.clear();
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Recorder start timeout"));
    }, 12000);
    worker.on("message", (message: Record<string, unknown>) => {
      if (message.kind === "ready") {
        clearTimeout(timer);
        resolve();
        if (!options.startPaused) worker.postMessage({ kind: "start" });
      }
      if (message.kind === "identity")
        options.observe(message.terminalId as string, message.routerId as string | null);
      if (message.kind === "identity-changed") options.changed();
      if (message.kind === "alerts")
        options.alerts(options.terminalId, message.transitions as AlertTransition[]);
      if (message.kind === "pause") {
        void options.pause(message.clientId as number, message.paused as boolean).then(
          () => {
            if (!closing) worker.postMessage({ kind: "pause-result", id: message.id, ok: true });
          },
          () => {
            if (!closing) worker.postMessage({ kind: "pause-result", id: message.id, ok: false });
          },
        );
      }
      if (message.kind === "response") {
        const request = pending.get(message.id as number);
        if (!request) return;
        pending.delete(message.id as number);
        clearTimeout(request.timer);
        request.resolve({ status: message.status as number, body: message.body });
      }
    });
    worker.on("error", () => {
      clearTimeout(timer);
      fail();
      reject(new Error("Recorder worker failed"));
      if (!closing) options.changed();
    });
    worker.on("exit", () => {
      clearTimeout(timer);
      fail();
      reject(new Error("Recorder stopped before startup completed"));
      if (!closing) options.changed();
    });
  });
  return {
    request: (path, method) =>
      new Promise((resolve) => {
        if (closing) {
          resolve({ status: 503, body: { error: "recorder_stopped" } });
          return;
        }
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ status: 504, body: { error: "recorder_timeout" } });
        }, 12000);
        pending.set(id, { resolve, timer });
        worker.postMessage({ kind: "request", id, path, method });
      }),
    configure: (options_) => {
      if (!closing)
        worker.postMessage({
          kind: "configure",
          ...options_,
          routerAddress: options.routerAddress?.() ?? null,
          hostIdentity: options.hostIdentity(),
        });
    },
    close: async () => {
      if (closing) return;
      closing = true;
      fail();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          void worker.terminate().then(() => resolve());
        }, 2000);
        worker.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        worker.postMessage({ kind: "stop" });
      });
      const lock = join(options.dataDirectory, "historian.lock");
      try {
        if (existsSync(lock) && Number(readFileSync(lock, "utf8").trim()) === process.pid)
          unlinkSync(lock);
      } catch {
        /* Preserve a lock we cannot verify. */
      }
    },
  };
}
