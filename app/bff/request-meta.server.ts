/**
 * 요청 메타: 상관 ID, 사용자 IP, 언어.
 */
import { randomUUID } from "node:crypto";
import { languageFromAcceptHeader, languageFromPath } from "~/i18n";
import type { RequestMeta } from "./session.server";

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * 호스트 nginx → Ingress → BFF 순서로 들어오므로 X-Forwarded-For 끝의 신뢰 홉(nginx)을 건너뛴 바로 앞 주소가 사용자 IP다
 * (auth.md §5 "사용자 IP 전달"). 값이 모자라면 첫 주소를 쓴다.
 */
export function clientIpFrom(header: string | null, trustedHops: number): string | undefined {
  const list = (header ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^[0-9A-Fa-f:.]{2,45}$/.test(part));
  if (list.length === 0) return undefined;
  const index = list.length - 1 - trustedHops;
  return list[index >= 0 ? index : 0];
}

export function requestMetaFrom(request: Request, trustedHops: number): RequestMeta {
  const incoming = request.headers.get("X-REQUEST-ID");
  const url = new URL(request.url);
  const lang = languageFromPath(url.pathname) ?? languageFromAcceptHeader(request.headers.get("Accept-Language"));
  return {
    requestId: incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID(),
    lang,
    clientIp: clientIpFrom(request.headers.get("X-Forwarded-For"), trustedHops),
    userAgent: request.headers.get("User-Agent")?.slice(0, 512) || undefined,
  };
}
