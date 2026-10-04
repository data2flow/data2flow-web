/**
 * UI-SCR-07 수식 항목(`/scripts/formulas`, SCR-01.06 노코드 파생 측정). 조회 SCRIPT_READ(OPERATOR), 작성 SCRIPT_WRITE(INTEGRATOR·ADMIN).
 * API: 목록 API-SCR-20, 적용 대상 후보(모델 API-DEV-46, 기기 API-DEV-01, 공간 API-DEV-01 트리), 측정 키(API-DEV-50 VERIFIED).
 * 저장·삭제·미리 보기(API-SCR-20·21)는 브라우저에서 BFF로
 */
import { useTranslation } from "react-i18next";
import { useRevalidator, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { ScriptAreaTabs } from "~/features/scripts/area-tabs";
import { FormulaEditor } from "~/features/scripts/formula-editor";
import { formulaApi, type FormulaMetric } from "~/features/scripts/m5-api";
import { hasAny } from "~/lib/permissions";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/script-formulas";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [formulas, models, devices, spaces, metrics] = await Promise.all([
    callList<FormulaMetric>(ctx, request, "/api/v1/core/formula-metrics?page=1&size=100"),
    callList<{ id: string | number; code?: string; name: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
    callList<{ id: string | number; name: string }>(ctx, request, "/api/v1/core/devices?size=100&sort=name"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ key: string }>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100"),
  ]);
  return {
    formulas: formulas.ok ? formulas.list.responses.map((f) => ({ ...f, id: String(f.id), targetId: String(f.targetId) })) : [],
    failed: !formulas.ok,
    targets: {
      MODEL: models.ok ? models.list.responses.map((m) => ({ id: String(m.id), name: m.code ? `${m.code} · ${m.name}` : m.name })) : [],
      DEVICE: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
      SPACE: spaces.ok ? flattenSpaces(spaces.data ?? []).map((s) => ({ id: s.id, name: s.path.join(" › ") })) : [],
    },
    metricKeys: metrics.ok ? metrics.list.responses.map((m) => m.key) : [],
  };
}

export default function ScriptFormulas({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const revalidator = useRevalidator();
  return (
    <>
      <PageHeader crumb={t("scripts.crumb")} title={t("scripts.formulas.title")} />
      <IngestAreaTabs current="scripts" />
      <ScriptAreaTabs current="formulas" />
      {loaderData.failed && <p className="mb-2 text-[12.5px] text-warn">{t("scripts.formulas.loadFailed")}</p>}
      <FormulaEditor
        formulas={loaderData.formulas}
        targets={loaderData.targets}
        metricKeys={loaderData.metricKeys}
        canWrite={hasAny(root?.me?.permissions, ["SCRIPT_WRITE"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        api={formulaApi}
        onChanged={() => void revalidator.revalidate()}
      />
    </>
  );
}
