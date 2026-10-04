/**
 * DSH-11.04 색약 친화 팔레트(TC-DSH-098)와 DSH-13.01 브랜딩 대비 계산(TC-DSH-113)
 */
import { describe, expect, it } from "vitest";
import { AA_TEXT, colorDistance, contrastRatio, deltaE2000, formatRatio, hexToRgb, isHexColor, minAdjacentDistance, rgbToHex, rgbToLab, simulate } from "../color";
import { DARK_BACKGROUND, DARK_PALETTE, LIGHT_BACKGROUND, LIGHT_PALETTE, chartPalette, seriesColor, statusIcon } from "../palette";

describe("DSH-11.04 기본 팔레트", () => {
  it("TC-DSH-098 AT-DSH-11.3: 8색, 색약 3종 시뮬레이션에서도 인접 색 ΔE00 ≥ 10, 배경 대비 ≥ 3:1(밝음·어두움)", () => {
    for (const [palette, background] of [
      [LIGHT_PALETTE, LIGHT_BACKGROUND],
      [DARK_PALETTE, DARK_BACKGROUND],
    ] as const) {
      expect(palette).toHaveLength(8);
      expect(minAdjacentDistance(palette)).toBeGreaterThanOrEqual(10);
      for (const color of palette) expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(3);
    }
    expect(chartPalette(true)).toBe(DARK_PALETTE);
    expect(seriesColor(9)).toBe(LIGHT_PALETTE[1]);
    expect(seriesColor(-1, true)).toBe(DARK_PALETTE[7]);
  });

  it("상태 표시는 색과 함께 아이콘을 쓴다(BR-DSH-15)", () => {
    expect(["good", "warn", "bad", "muted"].map((t) => statusIcon(t as never))).toEqual(["✔", "!", "▲", "–"]);
  });

  it("CIEDE2000은 Sharma 표 값과 맞는다, 시뮬레이션은 범위를 벗어나지 않는다", () => {
    // Sharma, Wu, Dalal(2005) 시험 쌍 1: ΔE00 = 2.0425
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    // 쌍 7: 무채색(ΔE00 = 0)
    expect(deltaE2000([50, 0, 0], [50, 0, 0])).toBe(0);
    // 쌍 17: 색상각이 180° 넘게 차이 나는 경우 ΔE00 = 27.1492
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 3);
    expect(deltaE2000([50, 2.49, -0.001], [50, -2.49, 0.0009])).toBeCloseTo(7.1792, 3);
    const sim = simulate([255, 0, 0], "deuteranopia");
    expect(sim.every((c) => c >= 0 && c <= 255)).toBe(true);
    expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 1);
    expect(colorDistance("#zzz", "#000000")).toBe(0);
    expect(colorDistance("#ff0000", "#00ff00", "protanopia")).toBeLessThan(colorDistance("#ff0000", "#00ff00"));
  });
});

describe("DSH-13.01 대비 계산", () => {
  it("TC-DSH-113 AT-DSH-14.2: #FFFF00 on 흰색 = 1.07:1(표시 1.1:1), #0055AA on 흰색 ≥ 4.5:1", () => {
    expect(contrastRatio("#FFFF00", "#FFFFFF")).toBeCloseTo(1.07, 2);
    expect(formatRatio(contrastRatio("#FFFF00", "#FFFFFF")!)).toBe("1.1:1");
    expect(contrastRatio("#0055AA", "#ffffff")!).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("red", "#fff")).toBeNull();
    expect(isHexColor("0055aa")).toBe(true);
    expect(isHexColor("#05a")).toBe(false);
    expect(hexToRgb("#0055AA")).toEqual([0, 85, 170]);
    expect(rgbToHex([0, 85.2, 300])).toBe("#0055ff");
  });
});
