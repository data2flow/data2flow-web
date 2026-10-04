/**
 * 색 계산 도우미(DSH-11.04 색약 친화 팔레트, DSH-13.01 브랜딩 대비 경고).
 * - WCAG 2.1 상대 휘도·대비(TC-DSH-113): #FFFF00 on #FFFFFF = 1.07:1, #0055AA on 흰색 ≥ 4.5:1
 * - CIEDE2000 색차(ΔE00)와 Machado(2009) 색각 이상 시뮬레이션(심도 1.0, 적색맹·녹색맹·청색맹)으로 인접 색 구분을 확인한다(TC-DSH-098)
 */

export type Rgb = [number, number, number];

const HEX = /^#?([0-9a-f]{6})$/i;

export function isHexColor(value: string | null | undefined): boolean {
  return HEX.test((value ?? "").trim());
}

/** "#RRGGBB" → [0..255]×3. 형식이 틀리면 null */
export function hexToRgb(hex: string): Rgb | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number) => {
  const v = Math.min(1, Math.max(0, l));
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
};

/** WCAG 상대 휘도 */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 대비(1~21). 색 형식이 틀리면 null */
export function contrastRatio(a: string, b: string): number | null {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return null;
  const [hi, lo] = [relativeLuminance(x), relativeLuminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** 화면 표시용 대비 "1.1:1"(소수 첫째 자리, 내림이 아닌 반올림) */
export function formatRatio(ratio: number): string {
  return `${(Math.round(ratio * 10) / 10).toFixed(1)}:1`;
}

/** WCAG AA 일반 글자 기준 */
export const AA_TEXT = 4.5;

export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia";

/** Machado, Oliveira, Fernandes (2009) 심도 1.0 행렬(선형 RGB) */
const MACHADO: Record<Deficiency, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function simulate(rgb: Rgb, deficiency: Deficiency): Rgb {
  const lin = rgb.map(toLinear);
  const m = MACHADO[deficiency];
  return m.map((row) => fromLinear(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])) as Rgb;
}

/** sRGB → CIE L*a*b*(D65) */
export function rgbToLab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000 색차(Sharma 2005 구현) */
export function deltaE2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** 두 색의 ΔE00(선택: 색각 이상 시뮬레이션 뒤) */
export function colorDistance(a: string, b: string, deficiency?: Deficiency): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return 0;
  const sx = deficiency ? simulate(x, deficiency) : x;
  const sy = deficiency ? simulate(y, deficiency) : y;
  return deltaE2000(rgbToLab(sx), rgbToLab(sy));
}

/** 인접 색 쌍 중 가장 작은 ΔE00(정상 시각 + 색약 3종) */
export function minAdjacentDistance(palette: readonly string[]): number {
  let min = Infinity;
  for (let i = 0; i < palette.length - 1; i += 1) {
    for (const d of [undefined, "protanopia", "deuteranopia", "tritanopia"] as const) {
      min = Math.min(min, colorDistance(palette[i], palette[i + 1], d));
    }
  }
  return min;
}
