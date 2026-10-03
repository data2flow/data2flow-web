import type { Config } from "@react-router/dev/config";

export default {
  // 서버 렌더링 + BFF(ADR-024, ADR-041)
  ssr: true,
  /**
   * React Router 내장 Origin 검사는 끈다(모든 Origin을 통과시켜 BFF 미들웨어로 넘김).
   * 운영에서는 TLS를 호스트 nginx가 끝내서 서버가 보는 request.url이 `http://`라 내장 검사가 정상 POST까지 막는다.
   * 대신 BFF 미들웨어가 더 엄격하게 검사한다: Origin이 DATA2FLOW_PUBLIC_ORIGIN(·ALLOWED_ORIGINS)과 정확히 같고
   * CSRF 토큰이 세션 토큰과 같아야 한다(BR-IAM-22, app/bff/middleware.server.ts).
   */
  allowedActionOrigins: ["**"],
} satisfies Config;
