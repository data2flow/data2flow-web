/**
 * UI-TSD-04 데이터 보관 설정(`/settings/data-retention`, TSD-05.01·02.01·05.03, UI-OPS-04 통합). 보기 TS_POLICY(ADMIN·INTEGRATOR), 저장은 ADMIN(IAM_MANAGE로 가린다).
 * API: API-TSD-40 유효 정책, API-TSD-43 저장 현황, API-TSD-33 장기 보관 파일 목록, 재정의 대상 측정 항목(API-DEV-50)·모델(API-DEV-40).
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { RetentionEditor } from "~/features/data/components/retention-editor";
import type { ArchiveFile, PoliciesResponse, StorageStats } from "~/features/data/model/retention";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/settings-data-retention";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [policies, stats, archives, metrics, models] = await Promise.all([
    callApi<PoliciesResponse>(ctx, request, "/api/v1/core/retention-policies"),
    callApi<StorageStats>(ctx, request, "/api/v1/core/storage-stats"),
    callList<ArchiveFile>(ctx, request, "/api/v1/core/archives?size=50"),
    callList<{ key: string; displayName?: string | null }>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100"),
    callList<{ id: string | number; name: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
  ]);
  return {
    effective: orThrow(policies).effective ?? [],
    stats: stats.ok ? stats.data : null,
    archives: archives.ok ? archives.list.responses : [],
    metrics: metrics.ok ? metrics.list.responses.map((m) => ({ key: m.key, name: m.displayName ?? null })) : [],
    models: models.ok ? models.list.responses.map((m) => ({ id: String(m.id), name: m.name })) : [],
  };
}

export default function SettingsDataRetention({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("data.retention.crumb")} title={t("data.retention.title")} />
      <RetentionEditor
        effective={loaderData.effective}
        stats={loaderData.stats}
        archives={loaderData.archives}
        metrics={loaderData.metrics}
        models={loaderData.models}
        canSave={hasAny(root?.me?.permissions, ["TS_POLICY"]) && hasAny(root?.me?.permissions, ["IAM_MANAGE"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        lang={i18n.language}
      />
    </>
  );
}
