/**
 * UI-ANA-05 실행 결과(`/analytics/{analysisId}/runs/{runId}`, ANA-04.02·05·07·08.02, AIA-01).
 * loader가 분석 정의·실행 결과(API-ANA-09)·최근 실행 20건·설명서(결과 읽는 법)·모델(A 이상)·AI 해설 이력(API-AIA-01 조회)을 함께 읽는다.
 * AI 해설 조회가 409 AI_DISABLED면 AI 탭·버튼을 그리지 않고(TC-AIA-066), 결과 화면 나머지는 그대로다(NFR-02.07).
 * 보관 기간이 지난 결과는 "결과 보관 기간이 지났습니다"(ANA-05.08).
 */
import { useTranslation } from "react-i18next";
import { Link, data, useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { defaultAiApi } from "~/features/ai/api";
import type { AiState, Commentary } from "~/features/ai/model/types";
import { defaultAnalyticsApi } from "~/features/analytics/api";
import { AnalyticsAreaTabs } from "~/features/analytics/components/area-tabs";
import { RunResult } from "~/features/analytics/components/run-result";
import type { Analysis, ModelItem, Run, RunWithResult, TemplateDetail } from "~/features/analytics/model/types";
import { getMe } from "~/bff/user.server";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/analytics-run";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const aid = encodeURIComponent(params.analysisId);
  const rid = encodeURIComponent(params.runId);
  const me = await getMe(ctx, request);
  const permissions = me.ok ? me.data.permissions : [];
  const [analysisRes, runRes, runsRes, modelsRes, commentariesRes] = await Promise.all([
    callApi<Analysis>(ctx, request, `/api/v1/core/analytics/analyses/${aid}`),
    callApi<RunWithResult>(ctx, request, `/api/v1/core/analytics/analyses/${aid}/runs/${rid}`),
    callList<Run>(ctx, request, `/api/v1/core/analytics/analyses/${aid}/runs?page=1&size=20`),
    hasAny(permissions, ["ANALYTICS_RUN"]) ? callList<ModelItem>(ctx, request, "/api/v1/core/analytics/models?size=100", { noGuards: true }) : Promise.resolve(null),
    hasAny(permissions, ["AI_USE"]) ? callList<Commentary>(ctx, request, `/api/v1/ai/commentaries?subjectType=ANALYSIS_RUN&subjectId=${rid}`, { noGuards: true }) : Promise.resolve(null),
  ]);
  const found = orThrow(analysisRes);
  const analysis: Analysis = { ...found, analysisId: found.analysisId ?? found.id ?? params.analysisId };
  let initial: RunWithResult;
  if (runRes.ok) initial = runRes.data;
  else {
    const detail = runRes.detail as { resultExpired?: boolean; run?: Run } | undefined;
    if (!detail?.resultExpired) throw data({ code: runRes.code }, { status: runRes.status });
    initial = { run: detail.run ?? { runId: params.runId, status: "SUCCEEDED" }, result: null, resultExpired: true };
  }
  const template = await callApi<TemplateDetail>(ctx, request, `/api/v1/core/analytics/templates/${encodeURIComponent(analysis.templateKey)}${analysis.templateVersion ? `?version=${encodeURIComponent(analysis.templateVersion)}` : ""}`, { noGuards: true });
  let aiState: AiState = "DISABLED";
  if (commentariesRes) aiState = commentariesRes.ok ? "ENABLED" : commentariesRes.code === "AI_DISABLED" || commentariesRes.status === 403 ? "DISABLED" : "UNKNOWN";
  return {
    analysis,
    initial,
    runs: runsRes.ok ? runsRes.list.responses : [],
    models: modelsRes?.ok ? modelsRes.list.responses : [],
    commentaries: commentariesRes?.ok ? commentariesRes.list.responses : [],
    aiState,
    howToRead: template.ok ? (template.data.guide?.howToRead ?? null) : null,
  };
}

export default function AnalyticsRun({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const { analysis } = loaderData;
  const canRun = hasAny(permissions, ["ANALYTICS_RUN"]);
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/analytics" className="hover:underline">
            {t("analytics.list.title")}
          </Link>
        }
        title={analysis.name}
      />
      <AnalyticsAreaTabs current="analyses" />
      <RunResult
        key={loaderData.initial.run.runId}
        analysis={analysis}
        initial={loaderData.initial}
        runs={loaderData.runs}
        howToRead={loaderData.howToRead}
        models={loaderData.models}
        commentaries={loaderData.commentaries}
        aiState={loaderData.aiState}
        perms={{ canRun, canPin: canRun && hasAny(permissions, ["DASHBOARD_WRITE"]), canFeedback: hasAny(permissions, ["ALARM_HANDLE"]), canAi: canRun && hasAny(permissions, ["AI_USE"]) }}
        api={defaultAnalyticsApi}
        aiApi={defaultAiApi}
        timezone={root?.timezone ?? "Asia/Seoul"}
      />
    </>
  );
}
