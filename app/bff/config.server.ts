/**
 * BFF 설정(IAM-07.04, design/auth.md §9). 값은 모두 환경 변수에서 읽고, 운영에서 필수 값이 없으면 기동하지 않는다
 * (auth.md §11 #8: 기본 시크릿 하드코딩 금지).
 */
import { randomBytes } from "node:crypto";

export interface SessionKey {
  /** 키 ID. 쿠키 앞부분에 적어 두고 교체할 때 이전 키로도 열 수 있게 한다 */
  kid: string;
  /** AES-256 키(32바이트) */
  key: Buffer;
}

export interface BffConfig {
  /** 클러스터 내부 gateway 주소. 예: http://data2flow-api-gateway */
  gatewayUrl: string;
  /** 사용자에게 보이는 웹 주소. CSRF Origin 검사의 기준(BR-IAM-22) */
  publicOrigin: string;
  /** publicOrigin 말고도 허용할 Origin(로컬 개발용) */
  allowedOrigins: string[];
  /** 첫 번째가 현재 키, 나머지는 복호화만 하는 이전 키 */
  sessionKeys: SessionKey[];
  /** 쿠키 Secure 속성. 기본 켜짐 */
  cookieSecure: boolean;
  /** 유휴 시간(분), 기본 30(IAM-03.01, BR-IAM-15) */
  sessionIdleMinutes: number;
  /** 로그인 뒤 최대 수명(시간), 기본 12 */
  sessionAbsoluteHours: number;
  /** Refresh 수명(시간), 쿠키 Max-Age. 기본 6 */
  refreshTtlHours: number;
  /** gateway 호출 시간 제한(ms). gateway 공통 응답 타임아웃(10s)보다 조금 길게 */
  gatewayTimeoutMs: number;
  /** X-Forwarded-For 끝에서 믿을 프록시 홉 수(호스트 nginx). auth.md §5 사용자 IP 전달 */
  trustedProxyHops: number;
  /** Access 캐시용 Redis 주소(선택). 없으면 BFF 메모리에만 둔다(auth.md §9.1) */
  redisUrl?: string;
  /**
   * 로그인 화면의 [가입 신청] 링크(IAM-01.08)는 core 공개 API `GET /api/v1/core/public/signup-settings`(API-IAM-74)로
   * 조직 설정을 읽어 정한다. 이 값은 그 호출이 실패했을 때만 쓰는 대체값이다(기본 꺼짐).
   */
  signupRequestEnabled: boolean;
  /** CSP 헤더. 운영 빌드에서만 켠다(Vite 개발 서버의 HMR 스크립트에는 nonce가 없다) */
  contentSecurityPolicy: boolean;
  /**
   * 메신저 콜백 `/hooks/messenger/{channel}`의 채널별 비밀값(design/auth.md §9.3, k8s Secret data2flow-web).
   * 텔레그램은 `X-Telegram-Bot-Api-Secret-Token`과 비교한다. 값이 없는 채널은 받지 않는다(404)
   */
  messengerSecrets: Record<string, string>;
  /** 메신저 콜백을 넘길 내부 action 주소(gateway를 거치지 않는 유일한 예외, ADR-021). 예: http://data2flow-action */
  actionUrl: string;
  /**
   * 로컬 미리보기 전용(OPS-08.01, ADR-057): 로그인 폼에 미리 채울 관리자 아이디·비밀번호. 기본 꺼짐(undefined).
   * `previewLoginFrom`의 안전장치(웹 주소가 localhost/127.0.0.1 + Secure 쿠키 꺼짐)를 통과할 때만 값이 있다
   */
  previewLogin?: PreviewLogin;
}

export interface PreviewLogin {
  loginId: string;
  password: string;
}

const DEFAULT_GATEWAY = "http://data2flow-api-gateway";
const DEFAULT_ORIGIN = "https://data2flow.java21.net";
const DEFAULT_ACTION = "http://data2flow-action";

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/** `kid:base64` 를 쉼표로 이은 값. 키는 정확히 32바이트여야 한다 */
export function parseSessionKeys(raw: string): SessionKey[] {
  const keys = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf(":");
      if (index <= 0) throw new Error("DATA2FLOW_SESSION_KEYS entry must be kid:base64key");
      const kid = part.slice(0, index);
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(kid)) throw new Error("session key id must be 1-16 chars [A-Za-z0-9_-]");
      const key = Buffer.from(part.slice(index + 1), "base64");
      if (key.length !== 32) throw new Error(`session key ${kid} must be 32 bytes`);
      return { kid, key };
    });
  if (keys.length === 0) throw new Error("DATA2FLOW_SESSION_KEYS is empty");
  return keys;
}

function stripSlash(url: string) {
  return url.replace(/\/+$/, "");
}

const PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * 로컬 미리보기 로그인 미리 채우기(OPS-08.01, ADR-057). `DATA2FLOW_PREVIEW_LOGIN_ID`·`DATA2FLOW_PREVIEW_LOGIN_PASSWORD`가
 * 둘 다 있을 때만 켠다. 웹 주소(DATA2FLOW_PUBLIC_ORIGIN)가 localhost/127.0.0.1이 아니거나 Secure 쿠키가 켜져 있으면(=실제 호스트)
 * 경고만 남기고 끈다. 운영 배포(https://data2flow.java21.net, Secure 쿠키)에서는 값을 넣어도 켜지지 않는다.
 */
export function previewLoginFrom(
  env: NodeJS.ProcessEnv,
  publicOrigin: string,
  cookieSecure: boolean,
  warn: (message: string) => void = (m) => console.warn(m),
): PreviewLogin | undefined {
  const loginId = env.DATA2FLOW_PREVIEW_LOGIN_ID?.trim() ?? "";
  const password = env.DATA2FLOW_PREVIEW_LOGIN_PASSWORD ?? "";
  if (!loginId && !password) return undefined;
  if (!loginId || !password) {
    warn("[bff] preview login autofill disabled: DATA2FLOW_PREVIEW_LOGIN_ID and DATA2FLOW_PREVIEW_LOGIN_PASSWORD must both be set");
    return undefined;
  }
  const host = URL.canParse(publicOrigin) ? new URL(publicOrigin).hostname : "";
  if (!PREVIEW_HOSTS.has(host) || cookieSecure) {
    warn(`[bff] preview login autofill refused: requires DATA2FLOW_PUBLIC_ORIGIN on localhost/127.0.0.1 and DATA2FLOW_COOKIE_SECURE=false (origin ${publicOrigin}, secure ${cookieSecure})`);
    return undefined;
  }
  return { loginId, password };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BffConfig {
  const production = env.NODE_ENV === "production";
  let sessionKeys: SessionKey[];
  if (env.DATA2FLOW_SESSION_KEYS) {
    sessionKeys = parseSessionKeys(env.DATA2FLOW_SESSION_KEYS);
  } else if (production) {
    throw new Error("DATA2FLOW_SESSION_KEYS is required in production");
  } else {
    // 로컬 개발: 프로세스마다 새 키. 다시 시작하면 로그인이 풀린다
    sessionKeys = [{ kid: "dev", key: randomBytes(32) }];
  }
  const publicOrigin = stripSlash(env.DATA2FLOW_PUBLIC_ORIGIN || DEFAULT_ORIGIN);
  const allowedOrigins = (env.DATA2FLOW_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => stripSlash(o.trim()))
    .filter(Boolean);
  const cookieSecure = env.DATA2FLOW_COOKIE_SECURE !== "false";
  return {
    gatewayUrl: stripSlash(env.DATA2FLOW_GATEWAY_URL || DEFAULT_GATEWAY),
    publicOrigin,
    allowedOrigins: [publicOrigin, ...allowedOrigins],
    sessionKeys,
    cookieSecure,
    sessionIdleMinutes: intEnv(env, "DATA2FLOW_SESSION_IDLE_MINUTES", 30, 5, 240),
    sessionAbsoluteHours: intEnv(env, "DATA2FLOW_SESSION_ABSOLUTE_HOURS", 12, 1, 24),
    refreshTtlHours: intEnv(env, "DATA2FLOW_REFRESH_TTL_HOURS", 6, 1, 24),
    gatewayTimeoutMs: intEnv(env, "DATA2FLOW_GATEWAY_TIMEOUT_MS", 12000, 1000, 120000),
    trustedProxyHops: intEnv(env, "DATA2FLOW_TRUSTED_PROXY_HOPS", 1, 0, 5),
    redisUrl: env.DATA2FLOW_REDIS_URL || undefined,
    signupRequestEnabled: env.DATA2FLOW_SIGNUP_REQUEST_ENABLED === "true",
    contentSecurityPolicy: production,
    messengerSecrets: env.DATA2FLOW_MESSENGER_TELEGRAM_SECRET ? { telegram: env.DATA2FLOW_MESSENGER_TELEGRAM_SECRET } : {},
    actionUrl: stripSlash(env.DATA2FLOW_ACTION_URL || DEFAULT_ACTION),
    previewLogin: previewLoginFrom(env, publicOrigin, cookieSecure),
  };
}

let current: BffConfig | undefined;

export function getConfig(): BffConfig {
  current ??= loadConfig();
  return current;
}

/** 테스트에서 설정을 바꿔 끼운다 */
export function setConfig(config: BffConfig | undefined) {
  current = config;
}
