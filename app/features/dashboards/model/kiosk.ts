/**
 * TV/키오스크 모드(DSH-06.02, UI-DSH-06, TC-DSH-062·063).
 * - 주소 `/kiosk?boards=1,2,3&interval=60`: boards 1~10개, interval 30~600초(기본 60)
 * - 순환: interval마다 다음 대시보드로. 이전 대시보드 부품은 내려서(unmount) 차트를 dispose하고 버퍼를 비운다(메모리가 계속 늘지 않게)
 * - 세션 유지: 화면이 BFF에 가벼운 요청(`GET /bff/api/core/accounts/me`)을 주기적으로 보내 유휴 만료(기본 30분)를 늦추고,
 *   Access 만료(60분)는 BFF가 Refresh로 서버 쪽에서 갱신한다. 화면은 다시 불러오지 않는다(깜빡임 0, AT-DSH-06.2)
 */

export const MIN_INTERVAL = 30;
export const MAX_INTERVAL = 600;
export const DEFAULT_INTERVAL = 60;
export const MAX_BOARDS = 10;
/** 세션 유지 요청 주기: 유휴 만료 최소값 5분보다 짧게 */
export const KEEP_ALIVE_MS = 4 * 60_000;
/** 마우스를 움직이면 조작 단추를 보이는 시간 */
export const CONTROLS_VISIBLE_MS = 3_000;

export interface KioskParams {
  boards: string[];
  interval: number;
  errors: ("BOARDS" | "INTERVAL")[];
}

export function parseKioskParams(search: URLSearchParams): KioskParams {
  const boards = [...new Set((search.get("boards") ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{1,18}$/.test(s)))];
  const raw = search.get("interval");
  const interval = raw === null || raw === "" ? DEFAULT_INTERVAL : Number(raw);
  const errors: KioskParams["errors"] = [];
  if (boards.length < 1 || boards.length > MAX_BOARDS) errors.push("BOARDS");
  const intervalOk = Number.isInteger(interval) && interval >= MIN_INTERVAL && interval <= MAX_INTERVAL;
  if (!intervalOk) errors.push("INTERVAL");
  return { boards: boards.slice(0, MAX_BOARDS), interval: intervalOk ? interval : DEFAULT_INTERVAL, errors };
}

export function kioskUrl(boards: string[], interval = DEFAULT_INTERVAL): string {
  return `/kiosk?boards=${boards.map(encodeURIComponent).join(",")}&interval=${interval}`;
}

export interface RotationState {
  index: number;
  /** 다음 전환까지 남은 초 */
  remaining: number;
  paused: boolean;
}

export function initialRotation(interval: number): RotationState {
  return { index: 0, remaining: interval, paused: false };
}

/** 1초 진행 */
export function tick(state: RotationState, count: number, interval: number): RotationState {
  if (state.paused || count <= 1) return state.paused ? state : { ...state, remaining: interval };
  if (state.remaining > 1) return { ...state, remaining: state.remaining - 1 };
  return { ...state, index: (state.index + 1) % count, remaining: interval };
}

export function skip(state: RotationState, count: number, interval: number): RotationState {
  return { ...state, index: count > 0 ? (state.index + 1) % count : 0, remaining: interval };
}

export function togglePause(state: RotationState): RotationState {
  return { ...state, paused: !state.paused };
}

/** 진행 막대 비율(0~1) */
export function progressOf(state: RotationState, interval: number): number {
  return Math.min(1, Math.max(0, 1 - state.remaining / interval));
}

/**
 * 세션 유지 타이머. ping이 401(세션 끝)을 알리면 멈추고 onEnded를 부른다.
 * 반환값으로 멈춘다. 타이머는 setInterval 하나만 쓴다(가짜 타이머로 시험).
 */
export function startKeepAlive(ping: () => Promise<number>, onEnded: () => void, everyMs = KEEP_ALIVE_MS): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    void ping()
      .then((status) => {
        if (!stopped && status === 401) {
          stop();
          onEnded();
        }
      })
      .catch(() => undefined);
  }, everyMs);
  function stop() {
    stopped = true;
    clearInterval(timer);
  }
  return stop;
}
