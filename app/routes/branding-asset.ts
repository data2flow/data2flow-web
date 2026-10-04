/**
 * 브랜딩 자산 공개 중계(`GET /branding/assets/{asset-id}`, DSH-13.01, API-DSH-25). 로그인 화면·공유 화면에서도 쓰므로 세션 없이
 * gateway 공개 경로 `/api/v1/core/public/branding/assets/{id}`만 부른다. 내용 형식은 core가 검사한 PNG·SVG·ICO만 그대로 넘긴다.
 * SVG는 문서로 열려도 스크립트가 돌지 않게 CSP sandbox를 붙인다.
 */
import { publicFetch } from "~/bff/gateway.server";
import { bff } from "~/bff/middleware.server";
import { brandingAssetPath } from "~/features/dashboards/server";
import type { Route } from "./+types/branding-asset";

const ALLOWED = ["image/png", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon", "image/jpeg", "image/webp"];

export async function loader({ context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const path = brandingAssetPath(params.assetId ?? "");
  if (!path) return new Response(null, { status: 404 });
  let upstream: Response;
  try {
    upstream = await publicFetch(ctx.runtime, ctx.meta, path, { headers: { Accept: "image/*" } });
  } catch {
    return new Response(null, { status: 502 });
  }
  const type = (upstream.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!upstream.ok || !ALLOWED.includes(type)) return new Response(null, { status: upstream.ok ? 415 : upstream.status });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
