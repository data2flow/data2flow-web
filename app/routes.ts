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
  // 메신저 버튼 응답(서버 간 호출, 세션·CSRF 밖 — 채널별 비밀 검증, design/auth.md §9.3, API-RUL-31)
  route("hooks/messenger/:channel", "routes/hooks-messenger.ts"),
  route("logout", "routes/logout.ts"),
  route("theme", "routes/theme.ts"),

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
      route("notifications", "routes/me-notifications.tsx"),
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

    // M3 폐루프(가상): 자동화(FLW) · 제어(ACT) · 가상 환경(SIM) — spec/detail/00-navigation.md §2
    route("automation/flows", "routes/flows.tsx"),
    route("automation/flows/new", "routes/flow-new.tsx"),
    route("automation/flows/:flowId", "routes/flow-detail.tsx"),
    route("automation/templates", "routes/flow-templates.tsx"),
    route("automation/approvals", "routes/flow-approvals.tsx"),
    route("control/commands", "routes/control-commands.tsx"),
    route("sim", "routes/sim-home.tsx"),
    route("sim/catalog", "routes/sim-catalog.tsx"),
    route("sim/profiles", "routes/sim-profiles.tsx"),
    route("sim/spaces", "routes/sim-spaces.tsx"),
    route("sim/spaces/:spaceId", "routes/sim-space-detail.tsx"),
    route("sim/scenarios", "routes/sim-scenarios.tsx"),
    route("sim/scenarios/:scenarioId/edit", "routes/sim-scenario-edit.tsx"),
    route("sim/runs/:runId", "routes/sim-run.tsx"),
    route("sim/runs/:runId/report", "routes/sim-run-report.tsx"),
    route("sim/replay", "routes/sim-replay.tsx"),

    // M4 자동화 완성(spec/detail/00-navigation.md §2): 규칙·알람(RUL), 알림 정책·템플릿·무음·당직, 유지보수·알림 채널(OPS),
    // 자동화 부가 화면(FLW-04·11), 제어 확장(ACT-01.04·02·03·05·06), 일괄 작업(DEV-02.09)
    route("alarms", "routes/alarms.tsx"),
    route("alarms/stats", "routes/alarm-stats.tsx"),
    route("alarms/:alarmId", "routes/alarm-detail.tsx"),
    route("rules", "routes/rules.tsx"),
    route("rules/new", "routes/rule-new.tsx"),
    route("rules/tuning", "routes/rule-tuning.tsx"),
    route("rules/:ruleId", "routes/rule-detail.tsx"),
    route("notifications/policies", "routes/notification-policies.tsx"),
    route("notifications/policies/:policyId", "routes/notification-policy-detail.tsx"),
    route("notifications/templates", "routes/notification-templates.tsx"),
    route("notifications/silences", "routes/notification-silences.tsx"),
    route("notifications/on-call", "routes/notification-on-call.tsx"),
    route("admin/maintenance", "routes/admin-maintenance.tsx"),
    route("admin/channels", "routes/admin-channels.tsx"),
    route("automation/sink-connections", "routes/sink-connections.tsx"),
    route("automation/snapshots", "routes/flow-snapshots.tsx"),
    route("automation/pipelines", "routes/flow-pipelines.tsx"),
    route("automation/packages", "routes/flow-packages.tsx"),
    route("settings/git-sync", "routes/git-sync.tsx"),
    route("control/scenes", "routes/control-scenes.tsx"),
    route("control/scenes/:sceneId", "routes/control-scene-detail.tsx"),
    route("control/schedules", "routes/control-schedules.tsx"),
    route("control/interlocks", "routes/control-interlocks.tsx"),
    route("control/drivers", "routes/control-drivers.tsx"),
    route("control/capabilities", "routes/control-capabilities.tsx"),
    route("device-jobs", "routes/device-jobs.tsx"),
    route("device-jobs/:jobId", "routes/device-job-detail.tsx"),

    // M5 field: 작업 지시·정기 점검(UI-DEV-13), 설치 현황판(UI-DEV-22) — spec/detail/00-navigation.md §2
    route("work-orders", "routes/work-orders.tsx"),
    route("work-orders/plans", "routes/work-order-plans.tsx"),
    route("work-orders/:workOrderId", "routes/work-order-detail.tsx"),
    route("devices/installation", "routes/devices-installation.tsx"),
  ]),

  // M5 field: 모바일 셸(UI-DSH-14, UI-DEV-17·21)과 QR 딥링크(`/d/{qrToken}`, 로그인 필요) — 00-navigation.md §2·§3
  route("d/:token", "routes/qr-link.tsx"),
  route("m", "routes/m-layout.tsx", [
    index("routes/m-index.ts"),
    route("alarms", "routes/m-alarms.tsx"),
    route("spaces", "routes/m-spaces.tsx"),
    route("work-orders", "routes/m-work-orders.tsx"),
    route("work-orders/:workOrderId", "routes/m-work-order-detail.tsx"),
    route("notifications", "routes/m-notifications.tsx"),
    route("scan", "routes/m-scan.tsx"),
    route("devices/:deviceId", "routes/m-device.tsx"),
    route("commission", "routes/m-commission.tsx"),
  ]),
] satisfies RouteConfig;
