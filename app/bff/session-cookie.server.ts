/**
 * 세션 쿠키 `data2flow_session`(IAM-07.04, design/auth.md §9.1).
 * 내용은 AES-256-GCM으로 암호화하고 `kid`로 키를 교체할 수 있다. 쿠키 값 형식: `v1.{kid}.{iv}.{ciphertext+tag}` (base64url)
 * 브라우저가 가진 것은 이 불투명한 값 하나뿐이고, 안에 든 Refresh 토큰은 BFF만 꺼낼 수 있다.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SessionKey } from "./config.server";

export const SESSION_COOKIE = "data2flow_session";
const VERSION = "v1";
const AAD = Buffer.from(SESSION_COOKIE);

/** 쿠키 안의 내용. 로그인 전에는 CSRF 토큰만 있다 */
export interface SessionPayload {
  /** CSRF 이중 제출 토큰(세션별, BR-IAM-22) */
  csrf: string;
  /** 로그인 계보 ID(auth가 준 sid, 없으면 BFF가 만든 값). Access 캐시 키 */
  sid?: string;
  /** Refresh 토큰. 브라우저 JS는 읽을 수 없다(HttpOnly + 암호화) */
  rt?: string;
  userId?: string;
  orgId?: string;
  /** 로그인 시각(ms). 절대 수명 12시간 계산 */
  iat?: number;
  /** 마지막 활동 시각(ms). 유휴 30분 계산 */
  la?: number;
  /** 최초·임시 비밀번호 상태(IAM-01.02). 비밀번호 변경 화면만 연다 */
  mcp?: boolean;
  /** 2단계 인증 대기 중인 티켓(5분, 1회용, API-IAM-62). 토큰이 아니며 서버만 읽는다 */
  mfa?: { ticket: string; exp: number };
}

const b64u = (buf: Buffer) => buf.toString("base64url");

export function seal(payload: SessionPayload, key: SessionKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(AAD);
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return [VERSION, key.kid, b64u(iv), b64u(enc)].join(".");
}

/** 열 수 없거나(변조, 모르는 kid, 형식 오류) 내용이 이상하면 null */
export function unseal(value: string, keys: SessionKey[]): SessionPayload | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const key = keys.find((k) => k.kid === parts[1]);
  if (!key) return null;
  try {
    const iv = Buffer.from(parts[2], "base64url");
    const enc = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || enc.length < 17) return null;
    const decipher = createDecipheriv("aes-256-gcm", key.key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(enc.subarray(enc.length - 16));
    const plain = Buffer.concat([decipher.update(enc.subarray(0, enc.length - 16)), decipher.final()]);
    const payload = JSON.parse(plain.toString("utf8")) as SessionPayload;
    if (!payload || typeof payload.csrf !== "string" || payload.csrf.length < 16) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie 헤더에서 이름 하나를 꺼낸다 */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export interface CookieAttributes {
  secure: boolean;
  /** 초. 0이면 삭제 */
  maxAge: number;
}

export function serializeSessionCookie(value: string, attrs: CookieAttributes): string {
  const parts = [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.max(0, Math.floor(attrs.maxAge))}`];
  if (attrs.maxAge <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (attrs.secure) parts.push("Secure");
  return parts.join("; ");
}
