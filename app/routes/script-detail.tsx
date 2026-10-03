/**
 * UI-SCR-02 스크립트 편집기(SCR-03.01 Monaco, SCR-03.02 테스트 실행, SCR-04.05 정적 검사) + 버전 탭(UI-SCR-03 일부).
 * 조회 SCRIPT_READ(OPERATOR는 읽기 전용), 저장·검사·테스트·배포 SCRIPT_WRITE, 강제 배포 SCRIPT_FORCE_DEPLOY.
 * API: 상세 API-SCR-04, 최근 원본 API-ING-05(실패해도 화면은 열림). 저장·검사·테스트·배포·버전 코드는 브라우저에서 BFF로(API-SCR-03·05·06·07·08)
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader, Tabs } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { scriptApi, type ScriptDetail as Detail } from "~/features/scripts/api";
import { ScriptEditor } from "~/features/scripts/script-editor";
import { ScriptVersions } from "~/features/scripts/script-versions";
import type { RawMessageOption } from "~/features/scripts/test-panel";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/script-detail";

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

export default function ScriptDetailPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const { script } = loaderData;
  const tab = params.get("tab") === "versions" ? "versions" : "code";
  const timezone = root?.timezone ?? "Asia/Seoul";
  return (
    <>
      <PageHeader crumb={t("scripts.title")} title={script.name} />
      <IngestAreaTabs current="scripts" />
      <Tabs
        current={tab}
        items={[
          { key: "code", label: t("scripts.editor.tabs.code"), to: "?tab=code" },
          { key: "versions", label: t("scripts.editor.tabs.versions"), to: "?tab=versions" },
        ]}
      />
      {tab === "code" ? (
        <ScriptEditor
          key={script.id}
          script={script}
          canWrite={hasAny(permissions, ["SCRIPT_WRITE"])}
          canForce={hasAny(permissions, ["SCRIPT_FORCE_DEPLOY"])}
          recent={loaderData.recent}
          recentFailed={loaderData.recentFailed}
          timezone={timezone}
          api={scriptApi}
        />
      ) : (
        <ScriptVersions scriptId={script.id} versions={script.versions ?? []} timezone={timezone} api={scriptApi} />
      )}
    </>
  );
}
