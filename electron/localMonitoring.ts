import { app, powerMonitor, type BrowserWindow } from "electron";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  appendFileSync,
} from "node:fs";
import { LocalMonitor } from "./localMonitor";
import { getAccountRegistry } from "./accounts";
import { openRecorderWorker } from "./recorderWorkerHost";
import { hostIdentity } from "./selfDevice";
import { preferences } from "./preferences";
import {
  localBinding,
  localMember,
  sameTerminal,
  routerKey,
  type LocalReply,
  type LocalState,
} from "../core/localSource";
import { validAccountId, type DishContext } from "../core/accountContext";
import { DishClient, DISH_LAN_HANDLE_URL } from "../core/dishClient";
import { createRouterOrigins } from "../core/routerEndpoint";
import { prepareRouterClientUpdate, readRouterClients } from "../core/routerClientUpdate";
import { prepareDishConfigUpdate } from "../core/dishConfigUpdate";
import {
  buildRouterConfigRequest,
  readRouterConfigContext,
  readCurrentSubnet,
  readRouterWifiConfig,
  type RouterConfigUpdate,
} from "../core/routerConfigUpdate";
import type { RouterClientUpdate } from "../core/routerClientUpdate";
import type { DishConfigJson } from "../core/dishClient";
import { classifyLocalFrame } from "./localFrame";
import { RecordingIdentity } from "../core/recordingIdentity";
import { legacyHistorySummary } from "./legacyHistory";
import type { AlertTransition } from "../core/alertEngine";
import { LOCAL_STATE_CHANNEL } from "./ipc";

let monitor: LocalMonitor | null = null;
let stop: (() => void) | null = null;
export function localViewVisible(lease?: unknown): boolean {
  return Boolean(
    monitor &&
    (lease === undefined
      ? monitor.state().viewActive
      : typeof lease === "string" && monitor.current(lease)),
  );
}
export function leaveLocalView(): void {
  monitor?.leaveAll();
}
export function stopLocalMonitoring(): void {
  stop?.();
  stop = null;
  monitor = null;
}
let dispatch: (value: unknown) => Promise<LocalReply> = async () => ({
  status: 503,
  body: { error: "local_monitor_unavailable" },
});
export function handleLocalRequest(value: unknown): Promise<LocalReply> {
  return dispatch(value);
}
const bad = (): LocalReply => ({ status: 400, body: { error: "invalid_local_request" } });
export function startLocalMonitoring(
  rendererRoot: string,
  parent: () => BrowserWindow | undefined,
  onState: () => void,
  onAlerts: (terminalId: string, transitions: AlertTransition[]) => void,
): void {
  stopLocalMonitoring();
  const registry = getAccountRegistry();
  const userData = app.getPath("userData");
  const protoset = join(
    app.isPackaged ? rendererRoot : join(app.getAppPath(), "public"),
    "dish.protoset",
  );
  const bytes = new Uint8Array(readFileSync(protoset));
  const dish = DishClient.load("dish", { handleUrl: DISH_LAN_HANDLE_URL, protosetBytes: bytes });
  const router = DishClient.load("router", { protosetBytes: bytes });
  const origins = createRouterOrigins(
    () =>
      Object.values(networkInterfaces())
        .flat()
        .filter((entry) => entry && entry.family === "IPv6" && !entry.internal)
        .map((entry) => entry!.address),
    () => preferences().routerAddress,
  );
  const fingerprint = () =>
    JSON.stringify([
      preferences().routerAddress,
      Object.entries(networkInterfaces())
        .flatMap(([name, entries]) =>
          (entries ?? [])
            .filter((entry) => !entry.internal)
            .map((entry) => [name, entry.address, entry.netmask, entry.mac]),
        )
        .sort(),
    ]);
  let environment = fingerprint();
  let enabled = false;
  let observed = new RecordingIdentity("unassigned");
  const member = (context: DishContext, id: string) =>
    fingerprint() === environment && localMember(registry?.list().sessions ?? [], context, id);
  const binding = (context: DishContext, id: string, routerId: string | null) =>
    fingerprint() === environment &&
    localBinding(registry?.list().sessions ?? [], context, id, routerId);
  const publicState = (state: LocalState) => {
    const window = parent();
    if (window && !window.isDestroyed()) window.webContents.send(LOCAL_STATE_CHANNEL, state);
    onState();
  };
  const handlers = new Map<
    string,
    ReturnType<NonNullable<typeof registry>["scopedLocalHandler"]>
  >();
  const scopedHandler = async (context: DishContext, current: () => boolean, key: string) => {
    const cached = handlers.get(key);
    if (cached) return cached;
    const routerId = source.state().routerId;
    if (!registry || !routerId) throw new Error("Binding unavailable");
    const routerClient = await router;
    const handler = registry.scopedLocalHandler(context, "Router-" + routerKey(routerId), current, {
      prepareDeviceUpdate: async (update, targetId, gateway) =>
        prepareRouterClientUpdate(routerClient, update, targetId, gateway, hostIdentity()),
      prepareDishConfigUpdate: async (changes) =>
        prepareDishConfigUpdate(await dish, changes, context.terminalId),
      prepareRouterConfigUpdate: async (update, targetId, gateway) =>
        routerClient.encodeRequest(
          buildRouterConfigRequest(
            targetId,
            update,
            await readRouterConfigContext(update, routerClient, targetId, gateway),
          ),
        ),
      readRouterSubnet: (target, gateway) => readCurrentSubnet(routerClient, target, gateway),
      readRouterClients: (target, gateway) => readRouterClients(routerClient, target, gateway),
      readRouterConfig: (target, gateway) => readRouterWifiConfig(routerClient, target, gateway),
    });
    handlers.set(key, handler);
    return handler;
  };
  const source: LocalMonitor = new LocalMonitor({
    probe: async (signal) => (await (await dish).getDeviceInfo(signal)).id ?? "",
    member,
    binding,
    identity: (context) => registry?.sessionIdentity(context.credentialId),
    changed: (state) => {
      if (!state.viewActive) handlers.clear();
      publicState(state);
    },
    open: async (terminalId, generation, identity) => {
      observed = new RecordingIdentity(terminalId);
      const directory = join(userData, "local-v1", terminalId);
      mkdirSync(directory, { recursive: true });
      const metadata = join(directory, "source.json");
      if (existsSync(metadata)) {
        const existing = JSON.parse(readFileSync(metadata, "utf8"));
        if (
          existing.version !== 1 ||
          existing.terminalId !== terminalId ||
          existing.source !== "lan"
        )
          throw new Error("Invalid source metadata");
      } else {
        writeFileSync(metadata + ".tmp", JSON.stringify({ version: 1, source: "lan", terminalId }));
        renameSync(metadata + ".tmp", metadata);
      }
      return openRecorderWorker({
        terminalId,
        dataDirectory: join(directory, "history"),
        protoset,
        hostIdentity,
        observe: identity,
        changed: () => {
          if (source.state().generation === generation) source.invalidate();
        },
        alerts: (id, transitions) => {
          if (source.state().generation === generation) onAlerts(id, transitions);
        },
        pause: async (clientId, paused) => {
          const context = source.automationContext();
          if (!context || source.state().generation !== generation)
            throw new Error("Verified original target required");
          const current = () =>
            source.state().generation === generation &&
            JSON.stringify(source.automationContext()) === JSON.stringify(context) &&
            binding(context, terminalId, source.state().routerId);
          const handler = await scopedHandler(
            context,
            current,
            `automation-${generation}-${JSON.stringify(context)}`,
          );
          if (!current()) throw new Error("Binding changed");
          const reply = await handler.updateClient({ kind: "pause", clientId, paused });
          if (reply.status !== 200) throw new Error("Local pause refused");
        },
        routerAddress: () => preferences().routerAddress,
      });
    },
  });
  monitor = source;
  const checkNetwork = () => {
    const next = fingerprint();
    if (next === environment) return;
    environment = next;
    source.invalidate();
    if (enabled) void source.connect();
  };
  const timer = setInterval(checkNetwork, 5000);
  timer.unref();
  const suspend = () => source.invalidate();
  const resume = () => {
    environment = fingerprint();
    source.invalidate();
    if (enabled) void source.connect();
  };
  powerMonitor.on("suspend", suspend);
  powerMonitor.on("resume", resume);
  const unsubscribe = registry?.subscribe(() => source.reconcile());
  dispatch = async (value) => {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
      const request = value as Record<string, unknown>;
      checkNetwork();
      if (request.kind === "state") return { status: 200, body: source.state() };
      if (request.kind === "legacy")
        return { status: 200, body: legacyHistorySummary(join(userData, "data")) };
      if (request.kind === "connect") {
        enabled = true;
        await source.connect();
        return { status: 200, body: source.state() };
      }
      if (request.kind === "disconnect") {
        enabled = false;
        source.disconnect();
        return { status: 200, body: source.state() };
      }
      if (request.kind === "select") {
        const context = request.context as DishContext | undefined;
        if (
          context !== undefined &&
          (!context ||
            typeof context !== "object" ||
            ![
              context.credentialId,
              context.accountId,
              context.serviceLineNumber,
              context.terminalId,
            ].every(validAccountId))
        )
          return bad();
        const lease = source.select(context);
        if (!lease) return { status: 409, body: { error: "local_source_unavailable" } };
        if (context && source.state().terminalId)
          appendFileSync(
            join(userData, "local-v1", source.state().terminalId!, "bindings.ndjson"),
            JSON.stringify({ at: Date.now(), context, routerId: source.state().routerId }) + "\n",
          );
        return { status: 200, body: { lease, state: source.state() } };
      }
      if (typeof request.lease !== "string" || !validAccountId(request.lease)) return bad();
      const lease = request.lease;
      if (request.kind === "leave") {
        source.leave(lease);
        return { status: 200, body: { ok: true } };
      }
      if (request.kind === "api")
        return source.api(
          lease,
          request.path as string,
          request.method === undefined ? "GET" : (request.method as string),
        );
      if (request.kind === "lan") {
        if (
          !["dish", "router"].includes(String(request.target)) ||
          !Array.isArray(request.bytes) ||
          request.bytes.length > 1048576 ||
          !request.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
        )
          return bad();
        const target = request.target as "dish" | "router";
        const frame = new Uint8Array(request.bytes);
        const operation = classifyLocalFrame(frame, target);
        if (!operation) return bad();
        return source.guarded(lease, operation === "write", async () => {
          const codec = await (target === "dish" ? dish : router);
          const decoded = codec.decodeRequest(frame.slice(5));
          if (decoded.targetId !== undefined) {
            const wanted =
              target === "dish"
                ? "ut" + source.state().terminalId
                : "Router-" + routerKey(source.state().routerId);
            if (decoded.targetId !== wanted)
              return { status: 403, body: { error: "local_target_mismatch" } };
          }
          if (operation === "write") {
            const proofSignal = AbortSignal.timeout(4000);
            const actual =
              target === "dish"
                ? await (await dish).getDeviceInfo(proofSignal)
                : await origins.run(async (origin) =>
                    (
                      await DishClient.load("router", {
                        handleUrl: origin + "/SpaceX.API.Device.Device/Handle",
                        protosetBytes: bytes,
                      })
                    ).getDeviceInfo(proofSignal),
                  );
            const matches =
              target === "dish"
                ? sameTerminal(actual.id, source.state().terminalId)
                : routerKey(actual.id) !== null &&
                  routerKey(actual.id) === routerKey(source.state().routerId);
            if (!matches) {
              source.invalidate();
              return { status: 409, body: { error: "local_source_changed" } };
            }
          }
          if (!source.current(lease, operation === "write"))
            return { status: 409, body: { error: "local_source_changed" } };
          const init: RequestInit = {
            method: "POST",
            headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" },
            body: frame as unknown as BodyInit,
            signal: AbortSignal.timeout(10000),
          };
          const response = await (target === "dish"
            ? fetch(DISH_LAN_HANDLE_URL, init)
            : origins.run((origin) => fetch(origin + "/SpaceX.API.Device.Device/Handle", init)));
          const result = new Uint8Array(await response.arrayBuffer());
          if (result.length >= 5 && result[0] === 0) {
            const size = new DataView(
              result.buffer,
              result.byteOffset,
              result.byteLength,
            ).getUint32(1);
            if (size <= result.length - 5) {
              const json = codec.decodeResponse(result.slice(5, 5 + size));
              try {
                const identity = observed.observe(
                  json as unknown as Record<string, unknown>,
                  target,
                );
                source.observe(identity.terminalId, identity.routerId);
              } catch {
                source.invalidate();
                return { status: 409, body: { error: "local_source_changed" } };
              }
            }
          }
          return {
            status: 200,
            body: {
              status: response.status,
              headers: {
                "content-type":
                  response.headers.get("content-type") ?? "application/grpc-web+proto",
                "grpc-status": response.headers.get("grpc-status") ?? "0",
                "grpc-message": response.headers.get("grpc-message") ?? "",
              },
              bytes: Array.from(result),
            },
          };
        });
      }
      if (request.kind === "cloud")
        return source.guarded(lease, true, async () => {
          const context = source.context(lease);
          if (!context) return { status: 403, body: { error: "local_binding_required" } };
          const handler = await scopedHandler(context, () => source.current(lease, true), lease);
          const path = request.path;
          const method = request.method ?? "GET";
          if (
            method === "GET" &&
            [
              "/cloud/account",
              "/cloud/usage",
              "/cloud/router-config",
              "/cloud/router-clients",
              "/cloud/router-subnet",
            ].includes(String(path))
          )
            return handler.handle(path as string);
          if (method === "GET" && path === "/cloud/session")
            return { status: 200, body: { connected: true } };
          if (method === "POST" && path === "/cloud/device")
            return handler.updateClient(request.body as RouterClientUpdate);
          if (method === "POST" && path === "/cloud/dish-config")
            return handler.updateDishConfig(request.body as DishConfigJson);
          if (method === "POST" && path === "/cloud/router-config")
            return handler.updateRouterConfig(request.body as RouterConfigUpdate);
          return bad();
        });
      return bad();
    } catch {
      return { status: 503, body: { error: "local_request_failed" } };
    }
  };
  stop = () => {
    clearInterval(timer);
    unsubscribe?.();
    powerMonitor.removeListener("suspend", suspend);
    powerMonitor.removeListener("resume", resume);
    source.disconnect();
    handlers.clear();
    dispatch = async () => ({ status: 503, body: { error: "local_monitor_unavailable" } });
  };
}
