/**
 * 라이브 뷰 훅(FLW-03.01~03.03): 플로우가 적용되어 있으면 `/bff/stream/flows/{id}`에 연결해 노드 카운터·배지·샘플을 받는다.
 * 연결하면 `subscribe {samples:true}`, 30초마다 `ping`(API-FLW-40).
 */
import { useEffect, useReducer, useRef } from "react";
import { initialLiveState, liveReducer, parseLiveMessage, type LiveState } from "../model/live";
import { FlowSocket, socketUrl, type SocketFactory } from "./flow-socket";

export const LIVE_PING_MS = 30_000;

export function useFlowLive({ flowId, enabled, create, debugNodes, now = Date.now }: { flowId: string | null; enabled: boolean; create?: SocketFactory; debugNodes?: readonly string[]; now?: () => number }): LiveState {
  const [state, dispatch] = useReducer(liveReducer, undefined, initialLiveState);
  const debugRef = useRef(debugNodes ?? []);
  const nowRef = useRef(now);
  useEffect(() => {
    debugRef.current = debugNodes ?? [];
    nowRef.current = now;
  });
  useEffect(() => {
    if (!enabled || !flowId || !create) return;
    const socket = new FlowSocket({
      url: socketUrl(`/bff/stream/flows/${encodeURIComponent(flowId)}`),
      create,
      hello: () => [{ type: "subscribe", samples: true }],
      keepAlive: { message: { type: "ping" }, everyMs: LIVE_PING_MS },
      onState: (connection) => dispatch({ type: "connection", state: connection }),
      onMessage: (raw) => {
        const message = parseLiveMessage(raw);
        if (message) dispatch({ type: "message", message, now: nowRef.current(), debugNodes: debugRef.current });
      },
    });
    socket.start();
    return () => socket.stop();
  }, [flowId, enabled, create]);
  return state;
}
