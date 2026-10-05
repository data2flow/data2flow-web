/**
 * 디자인 토큰 값(DSH-07.02). data2flow-docs/storyboards/lib.js의 THEMES와 같은 값이고, app.css의 `--d2f-*`도 이 값이다.
 * 화면 부품은 CSS 변수(Tailwind `bg-panel`, `text-fair-ink` 등)를 쓰고, 이 모듈은 CSS 변수를 읽을 수 없는 곳
 * (ECharts 캔버스, PNG 내보내기 배경, meta theme-color)에서만 쓴다.
 */
export const LIGHT_TOKENS = {
  bg: "#F6F8FB",
  panel: "#FFFFFF",
  panel2: "#F9FAFB",
  line: "#E6E8EB",
  line2: "#EFF1F4",
  text: "#1D273B",
  text2: "#49566B",
  text3: "#8590A2",
  inv: "#1D273B",
  onInv: "#FFFFFF",
  accent: "#206BC4",
  accentSoft: "#E8F0FA",
  good: "#2FB344",
  goodSoft: "#EAF7EC",
  fair: "#F59F00",
  fairSoft: "#FEF5E6",
  poor: "#F76707",
  poorSoft: "#FEF0E6",
  bad: "#D63939",
  badSoft: "#FBEBEB",
  virt: "#AE3EC9",
  virtSoft: "#F7ECFA",
  ai1: "#206BC4",
  ai2: "#4299E1",
  ai3: "#AE3EC9",
} as const;

export type TokenName = keyof typeof LIGHT_TOKENS;

export const DARK_TOKENS: Record<TokenName, string> = {
  bg: "#151F2C",
  panel: "#1B2636",
  panel2: "#202C3D",
  line: "#2A3749",
  line2: "#243143",
  text: "#E2E7EF",
  text2: "#A9B4C4",
  text3: "#76839A",
  inv: "#E2E7EF",
  onInv: "#151F2C",
  accent: "#4C8DDE",
  accentSoft: "#1E3350",
  good: "#4CC461",
  goodSoft: "#1C3326",
  fair: "#F7B32B",
  fairSoft: "#3A2F17",
  poor: "#FA8A3C",
  poorSoft: "#3B2719",
  bad: "#E86161",
  badSoft: "#3A2026",
  virt: "#C47ADB",
  virtSoft: "#33233F",
  ai1: "#4C8DDE",
  ai2: "#63A6EE",
  ai3: "#C47ADB",
};

/** 테마의 토큰 값 */
export function tokens(dark = false): Record<TokenName, string> {
  return dark ? DARK_TOKENS : LIGHT_TOKENS;
}

/** `#RRGGBB` + 불투명도 → rgba() */
export function alpha(hex: string, opacity: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}
