/** API-RUL-31 메신저 콜백 — M4 자리(BFF 훅 커밋에서 채운다). 지금은 모든 채널 404 */
export function action() {
  return new Response(null, { status: 404 });
}

export function loader() {
  return new Response(null, { status: 404 });
}
