/**
 * 실행 취소·다시 실행(FLW-01.01, UI-FLW-02 "실행 취소/다시 실행(50단계)").
 * 바뀐 상태만 쌓고, 50단계를 넘으면 가장 오래된 것부터 버린다. 새 변경이 들어오면 다시 실행 목록은 비운다.
 */
export const HISTORY_LIMIT = 50;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function history<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function record<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past.at(-1);
  if (previous === undefined) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}

/** 이력을 지우고 현재 값만 남긴다(불러오기·되돌리기 후) */
export function resetHistory<T>(present: T): History<T> {
  return history(present);
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
