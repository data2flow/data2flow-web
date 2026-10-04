/**
 * 규칙 화면 loader·action 공용(서버 전용 라우트 모듈에서만 부른다).
 * 폼 맥락: 규칙 템플릿(API-RUL-05), 알림 정책(API-RUL-21), 공간 트리(API-DEV-01), 범위 미리보기용 기기(API-DEV-11), 기기 모델(API-DEV-46), 측정 항목(API-DEV-50).
 * 저장: API-RUL-02(생성)·API-RUL-03(수정, baseVersion), 오류는 화면 필드로 옮긴다.
 */
import { data } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import type { SpaceNode } from "~/lib/spaces";
import type { PolicyOption } from "./components/rule-editor";
import { serverFieldProblems } from "./model/rule-form";
import type { MetricInfo, RulePayload, RuleSaveResult, RuleTemplate, ScopeDevice } from "./model/types";

interface DeviceRow {
  id: string | number;
  name: string;
  space?: { id: string | number } | null;
  model?: { id: string | number; code?: string | null } | null;
  tags?: string[];
  metrics?: string[];
}

export async function loadRuleFormContext(ctx: BffRequestContext, request: Request) {
  const [templates, policies, spaces, devices, models, metrics] = await Promise.all([
    callList<RuleTemplate>(ctx, request, "/api/v1/core/rule-templates"),
    callList<PolicyOption>(ctx, request, "/api/v1/core/notification-policies?size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<DeviceRow>(ctx, request, "/api/v1/core/devices?status=ACTIVE&size=100"),
    callList<{ id: string; code: string; name: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
    callList<MetricInfo>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100"),
  ]);
  const scopeDevices: ScopeDevice[] = devices.ok
    ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name, spaceId: d.space?.id != null ? String(d.space.id) : null, modelCode: d.model?.code ?? null, tags: d.tags ?? [], metrics: d.metrics ?? [] }))
    : [];
  return {
    templates: templates.ok ? templates.list.responses : [],
    policies: policies.ok ? policies.list.responses.map((p) => ({ notificationPolicyId: String(p.notificationPolicyId), name: p.name })) : [],
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    devices: scopeDevices,
    models: models.ok ? models.list.responses.map((m) => ({ code: m.code, name: m.name })) : [],
    metrics: metrics.ok ? metrics.list.responses.map((m) => ({ key: m.key, displayName: m.displayName, unit: m.unit, valueType: m.valueType, validMin: m.validMin, validMax: m.validMax })) : [],
  };
}

export interface RuleSaveActionData {
  intent: "save";
  ok?: boolean;
  result?: RuleSaveResult;
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, { key: string; params?: Record<string, string> }>;
}

/** 규칙 폼 저장(action). 성공하면 규칙 상세로 보낸다(경고는 쿼리로) */
export async function saveRule(ctx: BffRequestContext, request: Request, form: FormData, ruleId?: string) {
  let payload: RulePayload;
  try {
    payload = JSON.parse(field(form, "payload")) as RulePayload;
  } catch {
    return data<RuleSaveActionData>({ intent: "save", error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
  const result = ruleId
    ? await callApi<RuleSaveResult>(ctx, request, `/api/v1/core/rules/${encodeURIComponent(ruleId)}`, { method: "PUT", body: payload })
    : await callApi<RuleSaveResult>(ctx, request, "/api/v1/core/rules", { method: "POST", body: payload, idempotencyKey: field(form, "idempotencyKey") || undefined });
  if (!result.ok) {
    const fieldErrors = serverFieldProblems(result.errors);
    if (result.code === "RULE_NAME_DUPLICATED") fieldErrors.name = { key: "errors.RULE_NAME_DUPLICATED" };
    if (result.code === "RULE_TARGET_LIMIT_EXCEEDED") fieldErrors.scope = { key: "errors.RULE_TARGET_LIMIT_EXCEEDED" };
    return data<RuleSaveActionData>({ intent: "save", error: { code: result.code, message: result.message }, fieldErrors: fieldErrors as RuleSaveActionData["fieldErrors"] }, { status: result.status });
  }
  return { intent: "save" as const, ok: true, result: result.data };
}
