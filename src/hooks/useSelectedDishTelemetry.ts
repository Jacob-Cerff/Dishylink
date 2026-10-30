import { useEffect, useState } from "react";
import { sameTerminal, type LocalHost, type LocalState } from "@core/localSource";
const initial: LocalState = {
  version: 1,
  status: "idle",
  terminalId: null,
  routerId: null,
  generation: 0,
  recording: false,
  controls: false,
  viewActive: false,
};
export function useLocalSource(host?: LocalHost) {
  const [state, setState] = useState<LocalState>(initial);
  useEffect(() => {
    if (!host) return;
    let active = true;
    let eventReceived = false;
    const receive = (value: LocalState) => {
      if (active && value?.version === 1) setState(value);
    };
    const unsubscribe = host.subscribe?.((value) => {
      eventReceived = true;
      receive(value);
    });
    void host.request({ kind: "state" }).then(
      (reply) => {
        if (!eventReceived && reply.status === 200) receive(reply.body as LocalState);
      },
      () => {},
    );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [host]);
  return state;
}
export function selectedDishSource(state: LocalState, terminalId: string): "lan" | "cloud" {
  return state.version === 1 &&
    state.status === "ready" &&
    state.recording &&
    sameTerminal(state.terminalId, terminalId)
    ? "lan"
    : "cloud";
}
