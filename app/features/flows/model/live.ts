/**
 * 라이브 뷰 상태(FLW-03.01~03.03, API-FLW-40, UI-FLW-02 실시간): 서버 메시지(node.stats·node.sample·apply.status·flow.status·sampling)를
 * 노드 카운터·상태 배지·와이어 움직임·최근 메시지 버퍼로 바꾸는 순수 리듀서. 시계는 밖에서 넣는다(vi.useFakeTimers로 시험).
 * - 화면에 쌓는 샘플은 노드당 최근 20건(FLW-03.02), 표시는 노드당 초당 5건(디버그 켠 노드 50건)까지만(BR-FLW-12, TC-FLW-065)
 * - 권한 밖 공간 메시지(masked)는 내용 없이 "권한 밖 데이터"로만 보인다(AT-FLW-04.3)
 */

export type LiveConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "denied" | "ended";
export type NodeHealth = "OK" | "WARN" | "ERROR";

export interface NodeStats {
  nodeId: string;
  in: number;
  out: Record<string, number>;
  errors: number;
  lastAt?: string | null;
  status: NodeHealth;
  lastError?: string | null;
}

export interface NodeSample {
  t: string;
  version?: number;
  nodeId: string;
  messageId: string;
  direction: "in" | "out";
  port?: string | null;
  payload?: unknown;
  masked: boolean;
}

export interface LiveApplyStatus {
  targetVersion: number;
  instances: { instanceId: string; appliedVersion: number }[];
  converged: boolean;
}

export type LiveMessage =
  | { type: "node.stats"; t: string; version?: number; nodes: NodeStats[] }
  | ({ type: "node.sample" } & NodeSample)
  | ({ type: "apply.status" } & LiveApplyStatus)
  | { type: "flow.status"; status: string; reason?: string | null }
  | { type: "sampling"; nodeId: string; droppedPerSec: number }
  | { type: "pong" };

/** 노드별 최근 메시지 보관 수(FLW-03.02 "최근 메시지 N건") */
export const SAMPLE_BUFFER = 20;
/** 노드당 초당 표시 샘플 상한(BR-FLW-12). 디버그를 켠 노드는 50 */
export const SAMPLE_RATE = 5;
export const DEBUG_SAMPLE_RATE = 50;
/** 마지막 node.stats에서 늘어난 출력 포트(와이어 움직임) 표시 시간 */
export const WIRE_ACTIVE_MS = 1500;

export interface LiveState {
  connection: LiveConnectionState;
  /** 엔진이 보고한 처리 버전(메시지의 version) */
  version?: number;
  stats: Record<string, NodeStats>;
  /** 이번 갱신에서 출력이 늘어난 포트: `${nodeId}:${port}` → 늘어난 시각 */
  activePorts: Record<string, number>;
  samples: Record<string, NodeSample[]>;
  /** 화면 표시 상한 창 */
  window: Record<string, { start: number; count: number }>;
  /** 화면에서 줄인 샘플 수(노드별 누적) */
  skipped: Record<string, number>;
  /** 서버가 알린 샘플 줄임(sampling) */
  sampling: Record<string, number>;
  applyStatus?: LiveApplyStatus;
  flowStatus?: { status: string; reason?: string | null };
  lastMessageAt?: number;
}

export function initialLiveState(): LiveState {
  return { connection: "idle", stats: {}, activePorts: {}, samples: {}, window: {}, skipped: {}, sampling: {} };
}

export type LiveAction =
  | { type: "connection"; state: LiveConnectionState }
  | { type: "message"; message: LiveMessage; now: number; debugNodes?: readonly string[] }
  | { type: "clear"; nodeId?: string };

function onStats(state: LiveState, message: Extract<LiveMessage, { type: "node.stats" }>, now: number): LiveState {
  const stats = { ...state.stats };
  const activePorts: Record<string, number> = {};
  for (const [key, at] of Object.entries(state.activePorts)) if (now - at < WIRE_ACTIVE_MS) activePorts[key] = at;
  for (const node of message.nodes ?? []) {
    const previous = state.stats[node.nodeId];
    for (const [port, count] of Object.entries(node.out ?? {})) {
      if (count > (previous?.out?.[port] ?? 0) || (!previous && count > 0)) activePorts[`${node.nodeId}:${port}`] = now;
    }
    stats[node.nodeId] = { ...node, out: node.out ?? {}, status: node.status ?? "OK" };
  }
  return { ...state, stats, activePorts, version: message.version ?? state.version };
}

function onSample(state: LiveState, sample: NodeSample, now: number, debugNodes: readonly string[]): LiveState {
  const limit = debugNodes.includes(sample.nodeId) ? DEBUG_SAMPLE_RATE : SAMPLE_RATE;
  const current = state.window[sample.nodeId];
  const window = !current || now - current.start >= 1000 ? { start: now, count: 0 } : current;
  if (window.count >= limit) {
    return { ...state, window: { ...state.window, [sample.nodeId]: window }, skipped: { ...state.skipped, [sample.nodeId]: (state.skipped[sample.nodeId] ?? 0) + 1 } };
  }
  const clean: NodeSample = sample.masked ? { ...sample, payload: undefined } : sample;
  const buffer = [clean, ...(state.samples[sample.nodeId] ?? [])].slice(0, SAMPLE_BUFFER);
  return {
    ...state,
    samples: { ...state.samples, [sample.nodeId]: buffer },
    window: { ...state.window, [sample.nodeId]: { start: window.start, count: window.count + 1 } },
    version: sample.version ?? state.version,
  };
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.state };
    case "clear": {
      if (!action.nodeId) return { ...state, samples: {}, skipped: {} };
      const samples = { ...state.samples };
      delete samples[action.nodeId];
      return { ...state, samples };
    }
    case "message": {
      const { message, now } = action;
      const next = { ...state, lastMessageAt: now };
      switch (message.type) {
        case "node.stats":
          return onStats(next, message, now);
        case "node.sample": {
          const { type: _type, ...sample } = message;
          return onSample(next, sample, now, action.debugNodes ?? []);
        }
        case "apply.status":
          return { ...next, applyStatus: { targetVersion: message.targetVersion, instances: message.instances ?? [], converged: message.converged } };
        case "flow.status":
          return { ...next, flowStatus: { status: message.status, reason: message.reason ?? null } };
        case "sampling":
          return { ...next, sampling: { ...next.sampling, [message.nodeId]: message.droppedPerSec } };
        default:
          return next;
      }
    }
  }
}

/** 받은 텍스트를 라이브 메시지로. 모르는 형식은 버린다 */
export function parseLiveMessage(raw: unknown): LiveMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as { type?: unknown };
    if (!value || typeof value !== "object" || typeof value.type !== "string") return null;
    return value as LiveMessage;
  } catch {
    return null;
  }
}

/** 출력 포트 합계(노드 카드 "처리 n건") */
export function totalOut(stats: NodeStats | undefined): number {
  return Object.values(stats?.out ?? {}).reduce((sum, n) => sum + n, 0);
}

/** 와이어가 방금 움직였는지(출력 포트 카운터가 늘었는지) */
export function isWireActive(state: LiveState, from: string, port: string, now: number): boolean {
  const at = state.activePorts[`${from}:${port}`];
  return at !== undefined && now - at < WIRE_ACTIVE_MS;
}
