/**
 * 동시 편집 표시 상태(FLW-11.01, FLW-06.09, UI-FLW-17, API-FLW-42).
 * 서버 → `presence.snapshot {participants}`, `presence.changed`(참여자 목록 또는 한 명), `lock.granted|lock.denied {nodeId, holder}`, `flow.updated {version, by}`.
 * 잠금이 거절된 노드는 설정 패널이 읽기 전용("○○님이 편집 중")이 된다. 잠금은 서버(Redis TTL 60초)가 정하고, 최종 보호는 저장 때 낙관적 잠금이다.
 */
import type { LiveConnectionState } from "./live";

export interface Participant {
  userId: string;
  name: string;
  color?: string;
  readOnly?: boolean;
  selected?: string[];
}

export interface PresenceState {
  connection: LiveConnectionState;
  participants: Participant[];
  /** 내가 가진 잠금 */
  locks: string[];
  /** 다른 사람이 가진 잠금(노드 → 이름) */
  heldBy: Record<string, { userId?: string; name: string }>;
  /** 다른 사람이 저장했다(캔버스 갱신 안내) */
  updated?: { version: number; by?: { userId?: string; name?: string } | string };
}

export type PresenceMessage =
  | { type: "presence.snapshot"; participants: Participant[] }
  | { type: "presence.changed"; participants?: Participant[]; participant?: Participant; left?: boolean }
  | { type: "lock.granted"; nodeId: string; holder?: { userId?: string; name?: string } }
  | { type: "lock.denied"; nodeId: string; holder?: { userId?: string; name?: string } | string }
  | { type: "flow.updated"; version: number; by?: { userId?: string; name?: string } | string };

export type PresenceAction = { type: "connection"; state: LiveConnectionState } | { type: "message"; message: PresenceMessage; me?: string } | { type: "released"; nodeId: string } | { type: "dismissUpdate" };

export const MAX_AVATARS = 8;
export const PRESENCE_HEARTBEAT_MS = 20_000;
export const SELECT_DEBOUNCE_MS = 200;

export function initialPresence(): PresenceState {
  return { connection: "idle", participants: [], locks: [], heldBy: {} };
}

/** 떠난 사람이 잡고 있던 잠금 표시는 지운다(이름만 아는 잠금은 남긴다) */
function withoutLeft(heldBy: PresenceState["heldBy"], participants: Participant[]): PresenceState["heldBy"] {
  const present = new Set(participants.map((p) => p.userId));
  return Object.fromEntries(Object.entries(heldBy).filter(([, h]) => !h.userId || present.has(h.userId)));
}

const holderName = (holder: { name?: string } | string | undefined) => (typeof holder === "string" ? holder : (holder?.name ?? ""));

export function presenceReducer(state: PresenceState, action: PresenceAction): PresenceState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.state, ...(action.state === "open" ? {} : { locks: [] }) };
    case "released":
      return { ...state, locks: state.locks.filter((id) => id !== action.nodeId) };
    case "dismissUpdate":
      return { ...state, updated: undefined };
    case "message": {
      const message = action.message;
      switch (message.type) {
        case "presence.snapshot":
          return { ...state, participants: message.participants ?? [], heldBy: withoutLeft(state.heldBy, message.participants ?? []) };
        case "presence.changed": {
          if (message.participants) return { ...state, participants: message.participants, heldBy: withoutLeft(state.heldBy, message.participants) };
          const one = message.participant;
          if (!one) return state;
          const rest = state.participants.filter((p) => p.userId !== one.userId);
          return message.left ? { ...state, participants: rest, heldBy: withoutLeft(state.heldBy, rest) } : { ...state, participants: [...rest, one] };
        }
        case "lock.granted": {
          const heldBy = { ...state.heldBy };
          if (message.holder?.userId && message.holder.userId !== action.me) {
            heldBy[message.nodeId] = { userId: message.holder.userId, name: message.holder.name ?? "" };
            return { ...state, heldBy };
          }
          delete heldBy[message.nodeId];
          return { ...state, locks: [...new Set([...state.locks, message.nodeId])], heldBy };
        }
        case "lock.denied": {
          const holder = message.holder;
          const userId = typeof holder === "string" ? undefined : holder?.userId;
          return { ...state, locks: state.locks.filter((id) => id !== message.nodeId), heldBy: { ...state.heldBy, [message.nodeId]: { ...(userId ? { userId } : {}), name: holderName(holder) } } };
        }
        case "flow.updated": {
          const by = message.by;
          if (by && typeof by !== "string" && by.userId && by.userId === action.me) return state;
          return { ...state, updated: { version: message.version, by } };
        }
        default:
          return state;
      }
    }
  }
}

/** 다른 사람(나 제외)과 그 사람이 고른 노드 → 색 */
export function othersSelection(state: PresenceState, me: string | undefined): Map<string, { name: string; color: string }> {
  const out = new Map<string, { name: string; color: string }>();
  for (const p of state.participants) {
    if (p.userId === me) continue;
    for (const nodeId of p.selected ?? []) if (!out.has(nodeId)) out.set(nodeId, { name: p.name, color: p.color ?? "#2f6fde" });
  }
  return out;
}

export function avatars(state: PresenceState, me: string | undefined): { shown: Participant[]; more: number } {
  const others = state.participants.filter((p) => p.userId !== me);
  return { shown: others.slice(0, MAX_AVATARS), more: Math.max(0, others.length - MAX_AVATARS) };
}

export function parsePresence(raw: unknown): PresenceMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as { type?: unknown };
    return value && typeof value.type === "string" ? (value as PresenceMessage) : null;
  } catch {
    return null;
  }
}

export function updatedByName(updated: PresenceState["updated"]): string {
  if (!updated?.by) return "";
  return typeof updated.by === "string" ? updated.by : (updated.by.name ?? "");
}
