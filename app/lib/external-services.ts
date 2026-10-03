/**
 * 외부 서비스 설정(OPS-07.02, API-OPS-41·42). 비밀값은 쓰기 전용이고 비워 보내지 않으면 기존 값을 유지한다(BR-OPS-05).
 */
export const EXTERNAL_KINDS = ["LLM", "MAIL", "WEATHER", "MAP", "AIRQUALITY"] as const;

export interface ExternalService {
  kind: string;
  provider?: string;
  settings?: Record<string, unknown>;
  secretConfigured?: boolean;
  enabled?: boolean;
  lastTestAt?: string;
  lastTestResult?: string;
  version?: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** 폼 → API 본문. 검증에 걸리면 항목 이름 목록 */
export function buildServiceBody(kind: string, form: FormData): { body: Record<string, unknown> } | { invalid: string[] } {
  const invalid: string[] = [];
  let settings: Record<string, unknown>;
  let provider = text(form, "provider");
  if (kind === "MAIL") {
    provider = "smtp";
    const port = Number(text(form, "port"));
    const host = text(form, "host");
    const fromAddress = text(form, "fromAddress");
    if (!host) invalid.push("host");
    if (!Number.isInteger(port) || port < 1 || port > 65535) invalid.push("port");
    if (!EMAIL.test(fromAddress)) invalid.push("fromAddress");
    settings = {
      host,
      port,
      security: text(form, "security") || "STARTTLS",
      username: text(form, "username") || undefined,
      fromAddress,
      fromName: text(form, "fromName") || undefined,
    };
  } else {
    try {
      const raw = text(form, "settingsJson");
      settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("not object");
    } catch {
      invalid.push("settingsJson");
      settings = {};
    }
    if (!provider) invalid.push("provider");
  }
  if (invalid.length > 0) return { invalid };
  const secret = form.get("secret");
  const body: Record<string, unknown> = {
    provider,
    settings,
    enabled: form.get("enabled") === "on",
    baseVersion: Number(text(form, "baseVersion")) || 0,
  };
  if (typeof secret === "string" && secret !== "") body.secret = secret;
  return { body };
}
