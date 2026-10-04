/**
 * UI-OPS-01 시스템 상태(`/admin/system`) 중 M5 "저장 지표"(OPS-01.03): DB 용량, 테이블별 크기, 증가 추세, 디스크 여유. OPS_MANAGE.
 * 구성 요소 카드·수집·작업 지표·하트비트(OPS-01.01·01.02·01.04)는 이 화면의 다른 영역으로 남긴다.
 * API: API-OPS-03 `GET /core/ops/metrics/storage`.
 */
import { useTranslation } from "react-i18next";
import { useRouteLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { StoragePanel } from "~/features/data/components/storage-panel";
import type { StorageMetrics } from "~/features/data/model/storage";
import type { RootData } from "~/root";
import type { Route } from "./+types/admin-system";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const storage = await callApi<StorageMetrics>(ctx, request, "/api/v1/core/ops/metrics/storage");
  return { storage: storage.ok ? storage.data : null };
}

export default function AdminSystem({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("nav.admin")} title={t("data.system.title")} />
      <StoragePanel metrics={loaderData.storage} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} />
    </>
  );
}
