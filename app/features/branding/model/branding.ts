/**
 * 브랜딩 설정(DSH-13.01, UI-DSH-13, API-DSH-25) 화면 모델.
 * - 주 색상: HEX 6자리, 흰 배경 대비가 4.5:1 미만이면 경고 "대비가 낮습니다(1.1:1, 기준 4.5:1)"와 [그래도 저장](`contrastWarningAcked`)
 * - 로고: PNG·SVG ≤ 1MB, SVG 안 스크립트·이벤트 속성·외부 참조 금지(서버도 다시 검사, BR-DSH-20). 파비콘: ICO·PNG
 * - 로그인 문구 ≤ 100자, 메일 발신 이름 ≤ 50자, 서명 ≤ 500자
 */
import { AA_TEXT, contrastRatio, formatRatio, isHexColor } from "~/lib/color";

export const ASSET_MAX_BYTES = 1024 * 1024;
export const LOGIN_MESSAGE_MAX = 100;
export const SENDER_NAME_MAX = 50;
export const SIGNATURE_MAX = 500;
export const PUBLIC_THEMES = ["LIGHT", "DARK", "AUTO"] as const;

export type AssetKind = "LOGO_LIGHT" | "LOGO_DARK" | "FAVICON" | "LOGIN_BACKGROUND";

export interface Branding {
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  loginBackgroundUrl?: string | null;
  loginMessage?: string | null;
  mailSenderName?: string | null;
  mailSignature?: string | null;
  publicTheme?: string | null;
  appName?: string | null;
  appShortName?: string | null;
  contrastRatio?: number | null;
  version: number;
}

export interface BrandingForm {
  primaryColor: string;
  loginMessage: string;
  mailSenderName: string;
  mailSignature: string;
  publicTheme: string;
  appName: string;
  logoLightAssetId?: string;
  logoDarkAssetId?: string;
  faviconAssetId?: string;
  loginBackgroundAssetId?: string;
}

export function formOf(b: Branding | null | undefined): BrandingForm {
  return {
    primaryColor: b?.primaryColor ?? "#206BC4",
    loginMessage: b?.loginMessage ?? "",
    mailSenderName: b?.mailSenderName ?? "",
    mailSignature: b?.mailSignature ?? "",
    publicTheme: b?.publicTheme ?? "AUTO",
    appName: b?.appName ?? "",
  };
}

/** 흰 배경 대비와 경고 여부 */
export function contrastCheck(color: string): { ratio: number | null; label: string | null; low: boolean } {
  if (!isHexColor(color)) return { ratio: null, label: null, low: false };
  const ratio = contrastRatio(color.startsWith("#") ? color : `#${color}`, "#ffffff") as number;
  return { ratio, label: formatRatio(ratio), low: ratio < AA_TEXT };
}

export type BrandingFieldError = "COLOR" | "LOGIN_MESSAGE" | "SENDER_NAME" | "SIGNATURE";

export function validateBranding(form: BrandingForm): Partial<Record<keyof BrandingForm, BrandingFieldError>> {
  const errors: Partial<Record<keyof BrandingForm, BrandingFieldError>> = {};
  if (!isHexColor(form.primaryColor)) errors.primaryColor = "COLOR";
  if (form.loginMessage.length > LOGIN_MESSAGE_MAX) errors.loginMessage = "LOGIN_MESSAGE";
  if (form.mailSenderName.length > SENDER_NAME_MAX) errors.mailSenderName = "SENDER_NAME";
  if (form.mailSignature.length > SIGNATURE_MAX) errors.mailSignature = "SIGNATURE";
  return errors;
}

/** PUT 본문(온 키만 바꾸는 필드 + baseVersion, 대비 확인 여부) */
export function brandingBody(form: BrandingForm, baseVersion: number, contrastWarningAcked: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    primaryColor: form.primaryColor.startsWith("#") ? form.primaryColor.toUpperCase() : `#${form.primaryColor.toUpperCase()}`,
    loginMessage: form.loginMessage.trim() || null,
    mailSenderName: form.mailSenderName.trim() || null,
    mailSignature: form.mailSignature.trim() || null,
    publicTheme: form.publicTheme,
    appName: form.appName.trim() || null,
    contrastWarningAcked,
    baseVersion,
  };
  for (const key of ["logoLightAssetId", "logoDarkAssetId", "faviconAssetId", "loginBackgroundAssetId"] as const) if (form[key]) body[key] = form[key];
  return body;
}

export type AssetCheck = { ok: true } | { ok: false; reason: "TYPE" | "SIZE" | "UNSAFE_SVG" };

const SVG_UNSAFE = [/<script[\s>]/i, /\son[a-z]+\s*=/i, /(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)/i, /<foreignObject/i, /javascript:/i];

/** 올리기 전 파일 검사(서버가 다시 본다) */
export function checkAsset(kind: AssetKind, file: { name: string; type: string; size: number }, text?: string): AssetCheck {
  const name = file.name.toLowerCase();
  const isSvg = file.type === "image/svg+xml" || name.endsWith(".svg");
  const isPng = file.type === "image/png" || name.endsWith(".png");
  const isIco = file.type === "image/x-icon" || file.type === "image/vnd.microsoft.icon" || name.endsWith(".ico");
  const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/.test(name);
  const typeOk = kind === "FAVICON" ? isIco || isPng : kind === "LOGIN_BACKGROUND" ? isPng || isJpeg : isPng || isSvg;
  if (!typeOk) return { ok: false, reason: "TYPE" };
  if (file.size > ASSET_MAX_BYTES) return { ok: false, reason: "SIZE" };
  if (isSvg && text !== undefined && SVG_UNSAFE.some((p) => p.test(text))) return { ok: false, reason: "UNSAFE_SVG" };
  return { ok: true };
}
