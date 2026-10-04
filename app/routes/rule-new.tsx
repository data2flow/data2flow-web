/**
 * UI-RUL-02 새 규칙(RUL-01.01~10·01.12·01.13). RULE_WRITE.
 * 시작값: `?template=`(API-RUL-05 템플릿), `?copy={ruleId}`(복제), `?fromChart=1&metric=&op=&value=&spaceId=|deviceIds=`(데이터 탐색 차트 기준선, API-RUL-07).
 * 저장: API-RUL-02 → 규칙 상세로 이동(대상 수·경고 표시).
 */
import { useTranslation } from "react-i18next";
import { data, redirect } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { RuleEditorPage, type RuleEditorLoaderData } from "~/features/rules/components/rule-editor-page";
import { loadRuleFormContext, saveRule } from "~/features/rules/server";
import type { RuleDetail } from "~/features/rules/model/types";
import type { Route } from "./+types/rule-new";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<RuleEditorLoaderData> {
  const ctx = bff(context);
  const url = new URL(request.url);
  const form = await loadRuleFormContext(ctx, request);
  const copy = url.searchParams.get("copy");
  if (copy) {
    const source = await callApi<RuleDetail>(ctx, request, `/api/v1/core/rules/${encodeURIComponent(copy)}`);
    if (source.ok) {
      const { ruleId: _id, version: _v, status: _s, errorReason: _e, flowId: _f, ...rest } = source.data;
      void [_id, _v, _s, _e, _f];
      return { ...form, rule: null, draft: rest, copySuffix: " (2)" };
    }
  }
  if (url.searchParams.get("fromChart")) {
    const deviceIds = url.searchParams.getAll("deviceIds").filter(Boolean);
    const spaceId = url.searchParams.get("spaceId");
    const body = {
      metric: url.searchParams.get("metric") ?? "",
      value: Number(url.searchParams.get("value")),
      op: url.searchParams.get("op") || ">",
      target: { ...(deviceIds.length ? { deviceIds } : {}), ...(spaceId ? { spaceId } : {}) },
    };
    const draft = await callApi<Partial<RuleDetail>>(ctx, request, "/api/v1/core/rules/draft-from-chart", { method: "POST", body });
    return { ...form, rule: null, draft: draft.ok ? draft.data : null, draftError: draft.ok ? null : { code: draft.code, message: draft.message } };
  }
  return { ...form, rule: null, templateKey: url.searchParams.get("template") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  if (field(form, "intent") !== "save") return data({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const result = await saveRule(ctx, request, form);
  if ("ok" in result && result.ok && result.result) {
    const warnings = (result.result.warnings ?? []).map((w) => (typeof w === "string" ? w : w.code));
    const query = new URLSearchParams({ saved: "1" });
    if (warnings.length) query.set("warn", warnings.join(","));
    throw redirect(`/rules/${encodeURIComponent(result.result.ruleId)}?${query}`);
  }
  return result;
}

export default function RuleNew({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader crumb={t("rules.crumb")} title={t("rules.newTitle")} />
      <RuleEditorPage data={loaderData} actionData={actionData && "error" in actionData ? (actionData as never) : undefined} />
    </>
  );
}
