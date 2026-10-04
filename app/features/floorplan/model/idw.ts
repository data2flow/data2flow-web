/**
 * 히트 컬러 모드(DSH-02.03, BR-DSH-05): 평면도 위 측정값 분포를 IDW(역거리 가중) 보간으로 칠한다.
 * 서버는 마커 값만 주고(API-DSH-03) 보간은 화면이 계산한다. 좌표는 이미지 대비 비율(0~1)이다.
 */
export interface HeatPoint {
  x: number;
  y: number;
  value: number;
}

export interface HeatCell {
  col: number;
  row: number;
  value: number;
}

export interface HeatGrid {
  cols: number;
  rows: number;
  cells: HeatCell[];
  min: number;
  max: number;
}

/** 한 점의 IDW 추정값. 마커 위치와 겹치면 그 마커 값을 그대로 쓴다(BR-DSH-05: 마커 위치 색 = 실제 값) */
export function idwAt(points: readonly HeatPoint[], x: number, y: number, power = 2, aspect = 1): number | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0].value;
  let weighted = 0;
  let total = 0;
  for (const p of points) {
    const dx = (p.x - x) * aspect;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-12) return p.value;
    const w = 1 / Math.pow(d2, power / 2);
    weighted += w * p.value;
    total += w;
  }
  return weighted / total;
}

/** 격자(cols × rows) 셀 중심마다 IDW 값을 계산한다. aspect는 이미지 가로/세로 비(거리를 실제 비율로) */
export function idwGrid(points: readonly HeatPoint[], cols: number, rows: number, options: { power?: number; aspect?: number } = {}): HeatGrid | null {
  const usable = points.filter((p) => Number.isFinite(p.value));
  if (usable.length === 0 || cols < 1 || rows < 1) return null;
  const cells: HeatCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ col, row, value: idwAt(usable, (col + 0.5) / cols, (row + 0.5) / rows, options.power ?? 2, options.aspect ?? 1)! });
    }
  }
  const values = usable.map((p) => p.value);
  return { cols, rows, cells, min: Math.min(...values), max: Math.max(...values) };
}

/** 색약 친화 순차 팔레트(viridis 근사, DSH-11.04) — 낮음 보라 → 높음 노랑 */
const STOPS: [number, number, number][] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

/** 값을 [min, max] 안에서 0~1로 바꿔 색을 고른다. min = max면(마커 1개 등) 가운데 색 하나 */
export function heatColor(value: number, min: number, max: number): string {
  const t = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0.5;
  const scaled = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const [r, g, b] = STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
  return `rgb(${r}, ${g}, ${b})`;
}

/** 범례 그라데이션(CSS linear-gradient) */
export function legendGradient(): string {
  return `linear-gradient(to right, ${STOPS.map(([r, g, b], i) => `rgb(${r}, ${g}, ${b}) ${Math.round((i / (STOPS.length - 1)) * 100)}%`).join(", ")})`;
}
