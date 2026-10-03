/**
 * 공간 관리 탭의 입력 검증과 변환(UI-DEV-02·03): 목표 환경(DEV-01.04), 운영 시간표(DEV-11.01),
 * 운영 모드 수동 지정(DEV-11.02), 평면도 이미지·마커 좌표(DEV-01.03). 화면과 서버 action이 같은 규칙을 쓴다.
 */

export interface TargetRow {
  metricKey: string;
  min: string;
  max: string;
}

export interface TargetItem {
  metricKey: string;
  min?: number;
  max?: number;
}

/** 숫자 칸(빈 칸은 없음) */
function num(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const text = String(raw).trim();
  if (text === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * 목표 환경 행 검증: 측정 항목 필수·중복 금지, 최소·최대 중 하나 이상, 숫자, 최소 ≤ 최대.
 * 오류는 행 번호별 코드(`metricRequired`·`duplicate`·`valueRequired`·`notNumber`·`minGreaterThanMax`)
 */
export function checkTargets(rows: TargetRow[]): { items: TargetItem[]; errors: Record<number, string> } {
  const errors: Record<number, string> = {};
  const items: TargetItem[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const key = row.metricKey.trim();
    const min = num(row.min);
    const max = num(row.max);
    if (!key) errors[index] = "metricRequired";
    else if (seen.has(key)) errors[index] = "duplicate";
    else if (min === undefined && max === undefined) errors[index] = "valueRequired";
    else if (Number.isNaN(min) || Number.isNaN(max)) errors[index] = "notNumber";
    else if (min !== undefined && max !== undefined && min > max) errors[index] = "minGreaterThanMax";
    seen.add(key);
    if (!errors[index]) items.push({ metricKey: key, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
  });
  return { items, errors };
}

export interface Slot {
  dayOfWeek: number;
  start: string;
  end: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 시간 구간 검증: 요일 1~7, HH:mm, 시작 < 종료, 같은 요일 겹침 금지. 오류는 구간 번호별 코드 */
export function checkSlots(slots: Slot[]): Record<number, string> {
  const errors: Record<number, string> = {};
  slots.forEach((slot, index) => {
    if (!(slot.dayOfWeek >= 1 && slot.dayOfWeek <= 7)) errors[index] = "dayInvalid";
    else if (!TIME.test(slot.start) || !TIME.test(slot.end)) errors[index] = "timeInvalid";
    else if (minutes(slot.start) >= minutes(slot.end)) errors[index] = "startAfterEnd";
  });
  const valid = new Set(slots.map((_, i) => i).filter((i) => !errors[i]));
  slots.forEach((slot, index) => {
    if (!valid.has(index)) return;
    const overlaps = slots.some((other, j) => j !== index && valid.has(j) && other.dayOfWeek === slot.dayOfWeek && minutes(other.start) < minutes(slot.end) && minutes(slot.start) < minutes(other.end));
    if (overlaps) errors[index] = "overlap";
  });
  return errors;
}

/** 요일·시작 순서로 정렬 */
export function sortSlots(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || minutes(a.start) - minutes(b.start));
}

/** 수동 지정 종료 시각: 지금 이후 7일 이내(UI-DEV-02) */
export function checkOverrideUntil(untilIso: string | null | undefined, nowMs: number): string | undefined {
  if (!untilIso) return undefined;
  const t = Date.parse(untilIso);
  if (Number.isNaN(t)) return "untilInvalid";
  if (t <= nowMs || t - nowMs > 7 * 86400_000) return "untilRange";
  return undefined;
}

export const FLOORPLAN_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
export const FLOORPLAN_MAX_BYTES = 10 * 1024 * 1024;

/** 평면도 이미지: PNG/JPG/SVG, 10MB 이하, 크기를 알면 400×300 이상 */
export function checkFloorplanFile(file: { type: string; size: number; width?: number; height?: number }): boolean {
  if (!FLOORPLAN_TYPES.includes(file.type)) return false;
  if (file.size <= 0 || file.size > FLOORPLAN_MAX_BYTES) return false;
  if (file.width !== undefined && file.height !== undefined && (file.width < 400 || file.height < 300)) return false;
  return true;
}

/** 이미지 위 클릭 위치를 0~1 비율 좌표로(소수 4자리, 범위 밖은 끝으로) */
export function ratioFromClick(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

/** JSON 폼 값을 배열로(잘못된 값은 빈 배열) */
export function parseJsonArray<T>(raw: string): T[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * 평면도 이미지 주소(API-DEV-142). core는 서명 URL 대신 세션으로 읽는 API 경로(`/api/v1/core/spaces/{id}/floorplan/image?v=`)를 준다.
 * 브라우저는 토큰이 없으므로 같은 경로를 BFF 중계(`/bff/api/core/…`)로 바꿔 읽는다. 이미 다른 주소면 그대로 둔다
 */
export function browserImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^(https?:\/\/[^/]+)?\/api\/v1\/core\//, "/bff/api/core/");
}
