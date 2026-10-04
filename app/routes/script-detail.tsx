/**
 * UI-SCR-02 스크립트 편집기(SCR-03.01 Monaco, SCR-03.02 테스트 실행, SCR-04.05 정적 검사) + 버전 탭(UI-SCR-03 일부).
 * 조회 SCRIPT_READ(OPERATOR는 읽기 전용), 저장·검사·테스트·배포 SCRIPT_WRITE, 강제 배포 SCRIPT_FORCE_DEPLOY.
 * API: 상세 API-SCR-04, 최근 원본 API-ING-05(실패해도 화면은 열림). 저장·검사·테스트·배포·버전 코드는 브라우저에서 BFF로(API-SCR-03·05·06·07·08)
 * 사용처 탭(UI-SCR-08, SCR-04.04): 비활성화·활성화(API-SCR-17)와 삭제(API-SCR-02, 사용처 0일 때만)는 이 화면 action
 * M5: 테스트 케이스 탭(UI-SCR-04, SCR-03.03), 설정 탭(SCR-04.02), 운영 탭(UI-SCR-05, SCR-03.05·05.01·05.02·05.03).
 * 운영 탭의 [이 입력으로 테스트]는 같은 화면 상태로 코드 탭 테스트 패널에 입력을 넘긴다
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { data, redirect, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader, Tabs } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { scriptApi, type ScriptDetail as Detail } from "~/features/scripts/api";
import { scriptOpsApi } from "~/features/scripts/m5-api";
import { ScriptAreaTabs } from "~/features/scripts/area-tabs";
import { ScriptConfigTab } from "~/features/scripts/script-config";
import { ScriptEditor } from "~/features/scripts/script-editor";
import { ScriptOps } from "~/features/scripts/script-ops";
import { TestCasesTab } from "~/features/scripts/test-cases";
import { ScriptUsageTab, type UsageActionResult } from "~/features/scripts/script-usage";
import { ScriptVersions } from "~/features/scripts/script-versions";
import type { RawMessageOption } from "~/features/scripts/test-panel";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/script-detail";

const TABS = ["code", "tests", "config", "versions", "usage", "ops"] as const;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.scriptId);
  const now = ctx.runtime.now();
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const [detail, raw] = await Promise.all([
    callApi<Detail>(ctx, request, `/api/v1/core/scripts/${id}?include=versions,usage,tests,config`),
    callList<RawMessageOption>(ctx, request, `/api/v1/core/ingest/raw-messages?from=${iso(now - 24 * 3600_000)}&to=${iso(now)}&size=50`),
  ]);
  return { script: orThrow(detail), recent: raw.ok ? raw.list.responses.slice(0, 50) : [], recentFailed: !raw.ok };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(params.scriptId);
  if (intent === "disable" || intent === "enable") {
    const result = await callApi<{ status: string; impact?: UsageActionResult["impact"] }>(ctx, request, `/api/v1/core/scripts/${id}/${intent}`, { method: "POST" });
    if (!result.ok) return data<UsageActionResult>({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
    return { intent, ok: true, impact: result.data?.impact ?? null } satisfies UsageActionResult;
  }
  if (intent === "delete") {
    const result = await callApi(ctx, request, `/api/v1/core/scripts/${id}`, { method: "DELETE" });
    if (!result.ok) return data<UsageActionResult>({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
    return redirect("/scripts");
  }
  return data<UsageActionResult>({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
}

export default function ScriptDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const navigate = useNavigate();
  const { script } = loaderData;
  const tabParam = params.get("tab");
  const tab = TABS.includes(tabParam as (typeof TABS)[number]) ? (tabParam as (typeof TABS)[number]) : "code";
  const timezone = root?.timezone ?? "Asia/Seoul";
  const canWrite = hasAny(permissions, ["SCRIPT_WRITE"]);
  const [injected, setInjected] = useState<{ input: unknown; seq: number } | null>(null);
  return (
    <>
      <PageHeader crumb={t("scripts.title")} title={script.name} />
      <IngestAreaTabs current="scripts" />
      <ScriptAreaTabs current="scripts" />
      <Tabs
        current={tab}
        items={TABS.map((key) => ({ key, label: key === "tests" ? t("scripts.editor.tabs.tests", { n: script.tests?.length ?? 0 }) : t(`scripts.editor.tabs.${key}`), to: `?tab=${key}` }))}
      />
      {tab === "tests" ? (
        <TestCasesTab scriptId={script.id} initialCases={script.tests ?? []} canWrite={canWrite} api={scriptOpsApi} />
      ) : tab === "config" ? (
        <ScriptConfigTab scriptId={script.id} config={script.config} version={script.version} canWrite={canWrite} api={scriptOpsApi} />
      ) : tab === "ops" ? (
        <ScriptOps
          scriptId={script.id}
          canWrite={canWrite}
          logCaptureUntil={script.logCaptureUntil}
          timezone={timezone}
          api={scriptOpsApi}
          onTestWithInput={(input) => {
            setInjected((current) => ({ input, seq: (current?.seq ?? 0) + 1 }));
            navigate("?tab=code");
          }}
        />
      ) : tab === "usage" ? (
        <ScriptUsageTab script={script} canWrite={hasAny(permissions, ["SCRIPT_WRITE"])} lang={i18n.language} result={actionData as UsageActionResult | undefined} />
      ) : tab === "code" ? (
        <ScriptEditor
          key={script.id}
          script={script}
          canWrite={hasAny(permissions, ["SCRIPT_WRITE"])}
          canForce={hasAny(permissions, ["SCRIPT_FORCE_DEPLOY"])}
          recent={loaderData.recent}
          recentFailed={loaderData.recentFailed}
          timezone={timezone}
          api={scriptApi}
          injected={injected}
        />
      ) : (
        <ScriptVersions scriptId={script.id} versions={script.versions ?? []} timezone={timezone} api={scriptApi} />
      )}
    </>
  );
}
