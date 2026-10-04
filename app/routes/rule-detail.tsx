/**
 * UI-RUL-02 규칙 수정(RUL-01.01~10·01.12, RUL-06.03 상태·오류 사유, BR-RUL-24 변환된 규칙은 읽기 전용). 조회 RULE_READ(ANALYST는 읽기 전용), 저장 RULE_WRITE.
 * 상세는 `GET /api/v1/core/rules/{rule-id}`(문서에 상세 조회 API 번호가 없어 API-RUL-02 요청 모양 + 목록 필드로 받는다), 저장 API-RUL-03(baseVersion, 409 VERSION_CONFLICT).
 * `?simulate=1`이면 시뮬레이션 패널을 열고 바로 실행한다(목록 행 메뉴).
 */
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";
import { callApi, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { RuleEditorPage, type RuleEditorLoaderData } from "~/features/rules/components/rule-editor-page";
import { RuleStatusBadge } from "~/features/rules/components/rule-status";
import type { RuleDetail } from "~/features/rules/model/types";
import { loadRuleFormContext, saveRule } from "~/features/rules/server";
import type { Route } from "./+types/rule-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs): Promise<RuleEditorLoaderData> {
  const ctx = bff(context);
  const url = new URL(request.url);
  const [rule, form] = await Promise.all([callApi<RuleDetail>(ctx, request, `/api/v1/core/rules/${encodeURIComponent(params.ruleId)}`), loadRuleFormContext(ctx, request)]);
  return {
    ...form,
    rule: orThrow(rule),
    openSimulation: url.searchParams.get("simulate") === "1",
    saved: url.searchParams.get("saved") === "1",
    warnings: (url.searchParams.get("warn") ?? "").split(",").filter(Boolean),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent !== "save") return data({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const result = await saveRule(ctx, request, form, params.ruleId);
  if ("ok" in result && result.ok && result.result) {
    const warnings = (result.result.warnings ?? []).map((w) => (typeof w === "string" ? w : w.code));
    const query = new URLSearchParams({ saved: "1" });
    if (warnings.length) query.set("warn", warnings.join(","));
    throw redirect(`/rules/${encodeURIComponent(params.ruleId)}?${query}`);
  }
  return result;
}

export default function RuleDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const rule = loaderData.rule;
  return (
    <>
      <PageHeader crumb={t("rules.crumb")} title={<span className="flex items-center gap-2">{rule?.name}{rule?.status && <RuleStatusBadge status={rule.status} />}</span>} />
      <RuleEditorPage data={loaderData} actionData={actionData && "error" in actionData ? (actionData as never) : undefined} />
    </>
  );
}
