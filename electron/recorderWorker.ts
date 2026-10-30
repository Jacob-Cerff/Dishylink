import { parentPort, workerData } from "node:worker_threads";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RecordingIdentity } from "../core/recordingIdentity";
import type { DishContext } from "../core/accountContext";
import type { HostNetworkIdentity } from "../core/hostNetworkIdentity";

if (!parentPort) throw new Error("Recorder requires a worker channel");
const port = parentPort;
const data = workerData as {
  terminalId: string;
  dataDirectory: string;
  protoset: string;
  hostIdentity: HostNetworkIdentity;
  routerAddress?: string | null;
};
process.env.HISTORIAN_EMBED = "1";
process.env.HISTORIAN_DATA_DIR = data.dataDirectory;
process.env.HISTORIAN_PROTOSET = data.protoset;
const source = new RecordingIdentity(data.terminalId);
const historian = await import("../collector/historian.mts");
let controls = false;
let routerAddress: string | null = data.routerAddress ?? null;
let host = data.hostIdentity;
let started = false;
let nextPause = 0;
const pauses = new Map<number, { resolve: () => void; reject: () => void }>();
const bindingFile = join(data.dataDirectory, "automation-target.json");
function permitAutomation(context: DishContext | undefined, routerId: string | undefined): boolean {
  if (!context || !routerId) return false;
  const target = {
    terminalId: data.terminalId,
    accountId: context.accountId,
    serviceLineNumber: context.serviceLineNumber,
    routerId,
  };
  try {
    if (existsSync(bindingFile))
      return (
        JSON.stringify(JSON.parse(readFileSync(bindingFile, "utf8"))) === JSON.stringify(target)
      );
    writeFileSync(bindingFile + ".tmp", JSON.stringify(target));
    renameSync(bindingFile + ".tmp", bindingFile);
    return true;
  } catch {
    return false;
  }
}
let notified = false;
let lastRouter: string | null = null;
historian.setRecordingObserver(async (json, call) => {
  try {
    await source.verify(json, call);
    const identity = source.observe(json, call.target);
    if (!notified || identity.routerId !== lastRouter) {
      notified = true;
      lastRouter = identity.routerId;
      port.postMessage({ kind: "identity", ...identity });
    }
  } catch (error) {
    if (source.blocked) port.postMessage({ kind: "identity-changed" });
    throw error;
  }
});
historian.setRouterAddressReader(() => routerAddress);
historian.setHostIdentityReader(() => host);
historian.setAccountSessionReader(() => controls);
historian.setDevicePauser(
  (clientId, paused) =>
    new Promise<void>((resolve, reject) => {
      if (!controls) {
        reject(new Error("Verified local binding required"));
        return;
      }
      const id = ++nextPause;
      pauses.set(id, { resolve, reject: () => reject(new Error("Local pause refused")) });
      port.postMessage({ kind: "pause", id, clientId, paused });
      setTimeout(() => {
        const pending = pauses.get(id);
        if (pending) {
          pauses.delete(id);
          pending.reject();
        }
      }, 12000).unref();
    }),
);
historian.onAlertTransitions((transitions) =>
  port.postMessage({ kind: "alerts", terminalId: data.terminalId, transitions }),
);
historian.onThroughput((sample) =>
  port.postMessage({ kind: "throughput", terminalId: data.terminalId, sample }),
);
port.on("message", (message: Record<string, unknown>) => {
  if (message.kind === "start" && !started) {
    started = true;
    historian.start();
  }
  if (message.kind === "configure") {
    routerAddress = typeof message.routerAddress === "string" ? message.routerAddress : null;
    if (message.hostIdentity) host = message.hostIdentity as HostNetworkIdentity;
    controls =
      message.controls === true &&
      permitAutomation(
        message.context as DishContext | undefined,
        message.routerId as string | undefined,
      );
  }
  if (message.kind === "pause-result") {
    const pending = pauses.get(message.id as number);
    pauses.delete(message.id as number);
    if (message.ok) pending?.resolve();
    else pending?.reject();
  }
  if (message.kind === "stop") {
    controls = false;
    historian.flushRecording();
    process.exit(0);
  }
  if (message.kind !== "request") return;
  const id = message.id;
  const path = String(message.path);
  const method = String(message.method);
  if (method !== "GET" && !controls) {
    port.postMessage({
      kind: "response",
      id,
      status: 403,
      body: { error: "local_binding_required" },
    });
    return;
  }
  const request = {
    url: path,
    method,
    headers: { origin: "http://localhost" },
    socket: { remoteAddress: "127.0.0.1" },
  } as IncomingMessage;
  const response = {
    statusCode: 200,
    setHeader: () => {},
    end: (value?: string | Buffer) => {
      let body: unknown;
      try {
        body = JSON.parse(value?.toString() ?? "null");
      } catch {
        body = { error: "invalid_recorder_reply" };
      }
      port.postMessage({ kind: "response", id, status: response.statusCode, body });
    },
  };
  try {
    historian.handleRequest(request, response as unknown as ServerResponse);
  } catch {
    port.postMessage({
      kind: "response",
      id,
      status: 503,
      body: { error: "recorder_request_failed" },
    });
  }
});
port.postMessage({ kind: "ready" });
