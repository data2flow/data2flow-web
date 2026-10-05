/**
 * 차트 기본 팔레트(DSH-11.04, BR-DSH-15, TC-DSH-098). 색약 3종(적색맹·녹색맹·청색맹) 시뮬레이션에서도 이웃한 색의
 * CIEDE2000 ΔE가 10 이상이고, 테마 배경(밝음 #FFFFFF·어두움 #1B2636, 패널 토큰) 대비가 3:1 이상이다.
 * 밝은 화면은 Okabe–Ito 계열을 흰 바탕 대비에 맞게 어둡게 고친 8색, 어두운 화면은 원래 밝기의 8색이다.
 * 상태 표시는 색만 쓰지 않고 아이콘·글자를 함께 쓴다(statusIcon).
 */
export const LIGHT_PALETTE = ["#0072B2", "#D55E00", "#007A5E", "#3F51B5", "#AA3377", "#8C6D00", "#1B7F9E", "#B0413E"] as const;
export const DARK_PALETTE = ["#56B4E9", "#E69F00", "#3CC4A0", "#CC79A7", "#9DA9FF", "#F0E442", "#7FD1E8", "#FF8C69"] as const;
export const LIGHT_BACKGROUND = "#FFFFFF";
export const DARK_BACKGROUND = "#1B2636";

export function chartPalette(dark = false): readonly string[] {
  return dark ? DARK_PALETTE : LIGHT_PALETTE;
}

export function seriesColor(index: number, dark = false): string {
  const palette = chartPalette(dark);
  return palette[((index % palette.length) + palette.length) % palette.length];
}

export type StatusTone = "good" | "warn" | "bad" | "muted";

/** 상태 → 색 + 아이콘(색 없이도 구분, AT-DSH-11.3). 글자는 화면이 i18n으로 붙인다 */
export function statusIcon(tone: StatusTone): string {
  return { good: "✔", warn: "!", bad: "▲", muted: "–" }[tone];
}
