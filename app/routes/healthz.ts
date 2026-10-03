/** liveness·readiness 프로브. 본문은 짧게, 캐시하지 않는다 */
export function loader() {
  return new Response("ok", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}
