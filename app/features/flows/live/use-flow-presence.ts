/**
 * 편집 참여 훅(FLW-11.01, FLW-06.09, UI-FLW-17): `/bff/stream/flows/{id}/presence`(API-FLW-42).
 * 노드 선택은 200ms 디바운스로 `presence.select`, 설정 패널을 열면 `lock.acquire`, 닫으면 `lock.release`, 20초마다 `heartbeat`.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { initialPresence, parsePresence, presenceReducer, PRESENCE_HEARTBEAT_MS, SELECT_DEBOUNCE_MS, type PresenceState } from "../model/presence";
import { FlowSocket, socketUrl, type SocketFactory } from "./flow-socket";

export interface PresenceControls {
  state: PresenceState;
  select: (nodeIds: string[]) => void;
  acquire: (nodeId: string) => void;
  release: (nodeId: string) => void;
  dismissUpdate: () => void;
}

export function useFlowPresence({ flowId, enabled, create, me }: { flowId: string | null; enabled: boolean; create?: SocketFactory; me?: string }): PresenceControls {
  const [state, dispatch] = useReducer(presenceReducer, undefined, initialPresence);
  const socketRef = useRef<FlowSocket | null>(null);
  const selectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  });
  useEffect(() => {
    if (!enabled || !flowId || !create) return;
    const socket = new FlowSocket({
      url: socketUrl(`/bff/stream/flows/${encodeURIComponent(flowId)}/presence`),
      create,
      keepAlive: { message: { type: "heartbeat" }, everyMs: PRESENCE_HEARTBEAT_MS },
      onState: (connection) => dispatch({ type: "connection", state: connection }),
      onMessage: (raw) => {
        const message = parsePresence(raw);
        if (message) dispatch({ type: "message", message, me: meRef.current });
      },
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      if (selectTimer.current) clearTimeout(selectTimer.current);
      socketRef.current = null;
      socket.stop();
    };
  }, [flowId, enabled, create]);

  const select = useCallback((nodeIds: string[]) => {
    if (selectTimer.current) clearTimeout(selectTimer.current);
    selectTimer.current = setTimeout(() => {
      selectTimer.current = null;
      socketRef.current?.send({ type: "presence.select", nodeIds });
    }, SELECT_DEBOUNCE_MS);
  }, []);
  const acquire = useCallback((nodeId: string) => void socketRef.current?.send({ type: "lock.acquire", nodeId }), []);
  const release = useCallback((nodeId: string) => {
    socketRef.current?.send({ type: "lock.release", nodeId });
    dispatch({ type: "released", nodeId });
  }, []);
  const dismissUpdate = useCallback(() => dispatch({ type: "dismissUpdate" }), []);
  return { state, select, acquire, release, dismissUpdate };
}
