import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

/**
 * 화면 경로(spec/detail/00-navigation.md). 로그인 전 공개 페이지는 언어 접두사(`/en` `/ja` `/zh`)를 붙일 수 있다(ADR-037).
 */
export default [
  // k8s 프로브용(웹은 Node라 actuator가 없다)
  route("healthz", "routes/healthz.ts"),
  // 브라우저 API 중계(design/auth.md §9.2)
  route("bff/api/:svc/*", "routes/bff-api.ts"),
  // 실시간 연결 중계(SSE, design/auth.md §8·§9.2)
  route("bff/stream/*", "routes/bff-stream.ts"),
  route("logout", "routes/logout.ts"),

  // 공개 페이지(UI-IAM-01·02·03·05, NFR-12.01)
  route(":lang?/login", "routes/login.tsx"),
  route(":lang?/password-reset", "routes/password-reset.tsx"),
  route(":lang?/password-reset/:token", "routes/password-reset-confirm.tsx"),
  route(":lang?/invitations/:token", "routes/invitation.tsx"),
  route(":lang?/signup", "routes/signup.tsx"),
  route(":lang?/signup/verify/:token", "routes/signup-verify.tsx"),
  route(":lang?/privacy", "routes/privacy.tsx"),
  route("error/:status", "routes/error-page.tsx"),

  // 로그인 뒤 화면
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("me", "routes/me.tsx", [
      index("routes/me-index.ts"),
      route("profile", "routes/me-profile.tsx"),
      route("security", "routes/me-security.tsx"),
      route("sessions", "routes/me-sessions.tsx"),
    ]),
    route("admin/members", "routes/admin-members.tsx"),
    route("admin/members/:userId", "routes/admin-member-detail.tsx"),
    route("admin/roles", "routes/admin-roles.tsx"),
    route("admin/audit", "routes/admin-audit.tsx"),
    route("admin/security", "routes/admin-security.tsx"),
    route("admin/settings", "routes/admin-settings.tsx"),

    // M2 수집 경로(spec/detail/00-navigation.md §2)
    route("spaces", "routes/spaces.tsx"),
    route("spaces/:spaceId", "routes/space-detail.tsx"),
    route("sites", "routes/sites.tsx"),
    route("devices", "routes/devices.tsx"),
    route("devices/pending", "routes/devices-pending.tsx"),
    route("devices/new", "routes/devices-new.tsx"),
    route("devices/:deviceId", "routes/device-detail.tsx"),
    route("models", "routes/models.tsx"),
    route("models/:modelCode", "routes/model-detail.tsx"),
    route("metrics", "routes/metrics.tsx"),
    route("device-groups", "routes/device-groups.tsx"),
    route("device-groups/:groupId", "routes/device-group-detail.tsx"),
    route("explore", "routes/explore.tsx"),
    route("ingest/monitor", "routes/ingest-monitor.tsx"),
    route("ingest/failures", "routes/ingest-failures.tsx"),
    route("sources", "routes/sources.tsx"),
    route("sources/new", "routes/sources-new.tsx"),
    route("sources/new/:connectorKey", "routes/source-new-form.tsx"),
    route("sources/:sourceId", "routes/source-detail.tsx"),
    route("sources/:sourceId/edit", "routes/source-edit.tsx"),
    route("scripts", "routes/scripts.tsx"),
    route("scripts/:scriptId", "routes/script-detail.tsx"),
  ]),
] satisfies RouteConfig;
