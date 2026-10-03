/**
 * UI-DSC-07 커넥터 카탈로그 — 새 소스 1단계(DSC-09.01, DSC-01.02). INTEGRATOR 이상(SRC_ADMIN, 라우트 가드).
 * API-DSC-55 카탈로그가 실패해도 M2 기본 유형(MQTT 구독·플랫폼 브로커·가상 환경)으로 만들 수 있다.
 */
import { useTranslation } from "react-i18next";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { ConnectorCatalog } from "~/features/sources/components/catalog";
import { IngestTabs } from "~/features/sources/components/common";
import { normalizeCatalog } from "~/features/sources/model/catalog";
import type { Route } from "./+types/sources-new";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const result = await callApi<unknown>(bff(context), request, "/api/v1/core/connectors");
  const catalog = normalizeCatalog(result.ok ? result.data : null);
  return { ...catalog, catalogError: !result.ok };
}

export default function SourcesNew({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  return (
    <>
      <IngestTabs current="sources" />
      <PageHeader crumb={t("sources.list.title")} title={t("sources.new.title")} />
      <p className="mb-3 text-[12.5px] text-muted">{t("sources.new.steps")}</p>
      <ConnectorCatalog connectors={loaderData.connectors} templates={loaderData.templates} catalogError={loaderData.catalogError} />
    </>
  );
}
