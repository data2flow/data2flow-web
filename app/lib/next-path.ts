/**
 * 로그인 뒤 돌아갈 경로 검사(design/auth.md §9.2 "복귀 경로 검사", AT-IAM-02.8).
 * `/`로 시작하고 `//`·`/\`로 시작하지 않는 같은 사이트 경로만 허용한다. 나머지는 홈(`/`).
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  // 제어 문자(줄바꿈 등)가 들어 있으면 거부
  if ([...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return "/";
  try {
    const url = new URL(value, "http://bff.local");
    if (url.origin !== "http://bff.local") return "/";
    if (url.pathname.startsWith("/bff/") || url.pathname === "/logout") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
