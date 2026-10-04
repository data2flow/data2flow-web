/**
 * TC-DSH-016 AT-DSH-02.3 IDW 보간(DSH-02.03, BR-DSH-05): 마커 위치 값은 원값 그대로, 기준 구현과 오차 ≤ 1e-6, 마커 1개면 균일 색, 범례 min~max.
 */
import { describe, expect, it } from "vitest";
import { heatColor, idwAt, idwGrid, legendGradient } from "../idw";

const points = [
  { x: 0.1, y: 0.2, value: 22 },
  { x: 0.8, y: 0.3, value: 26 },
  { x: 0.5, y: 0.9, value: 24 },
  { x: 0.2, y: 0.7, value: 1150 },
];

/** 기준 구현: 거리 제곱 역수 가중 평균 */
function reference(x: number, y: number) {
  let num = 0;
  let den = 0;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    const w = 1 / (d * d);
    num += w * p.value;
    den += w;
  }
  return num / den;
}

describe("TC-DSH-016 IDW 보간", () => {
  it("마커 위치에서는 원값 그대로(BR-DSH-05)", () => {
    for (const p of points) expect(idwAt(points, p.x, p.y)).toBe(p.value);
  });

  it("거리 가중 결과가 기준 구현과 오차 1e-6 이하", () => {
    for (const [x, y] of [[0.3, 0.3], [0.6, 0.5], [0.95, 0.95], [0, 0]]) {
      expect(Math.abs(idwAt(points, x, y)! - reference(x, y))).toBeLessThanOrEqual(1e-6);
    }
  });

  it("마커 1개면 공간 전체가 한 값(균일 색), 마커 없으면 없음", () => {
    const grid = idwGrid([{ x: 0.5, y: 0.5, value: 900 }], 4, 3)!;
    expect(new Set(grid.cells.map((c) => c.value))).toEqual(new Set([900]));
    expect(new Set(grid.cells.map((c) => heatColor(c.value, grid.min, grid.max))).size).toBe(1);
    expect(idwGrid([], 4, 3)).toBeNull();
    expect(idwAt([], 0, 0)).toBeNull();
    expect(idwGrid(points, 0, 3)).toBeNull();
  });

  it("격자 범례는 마커 값의 최저~최고, 셀 값은 그 안", () => {
    const grid = idwGrid(points, 10, 8, { aspect: 1.5 })!;
    expect(grid.cells).toHaveLength(80);
    expect(grid.min).toBe(22);
    expect(grid.max).toBe(1150);
    for (const c of grid.cells) {
      expect(c.value).toBeGreaterThanOrEqual(22);
      expect(c.value).toBeLessThanOrEqual(1150);
    }
  });

  it("색은 최저 보라 → 최고 노랑(색약 친화), 범위 밖은 끝 색, 범례 그라데이션 5단", () => {
    expect(heatColor(0, 0, 10)).toBe("rgb(68, 1, 84)");
    expect(heatColor(10, 0, 10)).toBe("rgb(253, 231, 37)");
    expect(heatColor(-5, 0, 10)).toBe(heatColor(0, 0, 10));
    expect(heatColor(50, 0, 10)).toBe(heatColor(10, 0, 10));
    expect(heatColor(3, 3, 3)).toBe("rgb(33, 145, 140)");
    expect(legendGradient()).toMatch(/^linear-gradient\(to right, rgb\(68, 1, 84\) 0%.*rgb\(253, 231, 37\) 100%\)$/);
  });
});
