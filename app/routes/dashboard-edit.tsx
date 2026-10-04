/**
 * UI-DSH-04 대시보드 편집(`/dashboards/{id}/edit`, DSH-04.01·04.05·04.07). 편집할 수 없는 대시보드(남의 ORG 대시보드 등)는 403.
 * 위젯 종류·옵션 스키마는 API-DSH-13 `GET /widget-types`, 변수 선택지는 공간·기기·측정 항목 목록.
 */
import { useNavigate, useRevalidator, data, useRouteLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { DashboardEditor } from "~/features/dashboards/components/dashboard-editor";
import { draftOf } from "~/features/dashboards/model/transfer";
import type { Dashboard, WidgetTypeInfo } from "~/features/dashboards/model/types";
import { variableOptions } from "~/features/dashboards/server";
import type { RootData } from "~/root";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/dashboard-edit";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [r, types] = await Promise.all([
    callApi<Dashboard>(ctx, request, `/api/v1/core/dashboards/${encodeURIComponent(params.dashboardId)}`),
    callApi<WidgetTypeInfo[]>(ctx, request, "/api/v1/core/widget-types"),
  ]);
  if (!r.ok) throw data({ code: r.code }, { status: r.status });
  if (!r.data.editable) throw data({ code: "PERMISSION_DENIED" }, { status: 403 });
  // 메뉴 문서 §3의 위젯 중 M5에서 서버가 주는 종류만(제어·분석·KPI는 각 마일스톤에서)
  const options = await variableOptions(ctx, request, [
    { name: "__space", type: "SPACE" },
    { name: "__device", type: "DEVICE" },
    { name: "__metric", type: "METRIC" },
  ]);
  return { dashboard: r.data, types: types.ok ? (types.data ?? []) : [], options };
}

export default function DashboardEdit({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { dashboard, types, options } = loaderData;
  const view = `/dashboards/${encodeURIComponent(dashboard.id)}`;
  return (
    <>
      <PageHeader title={t("dashboards.edit.heading", { name: dashboard.name })} />
      <DashboardEditor
        key={dashboard.version}
        dashboard={dashboard}
        draft={draftOf(dashboard)}
        types={types}
        timezone={root?.timezone ?? "Asia/Seoul"}
        targetOptions={{ SPACE: options.__space, DEVICE: options.__device, METRIC: options.__metric }}
        onSaved={() => navigate(view)}
        onCancel={() => navigate(view)}
        onReload={() => void revalidator.revalidate()}
      />
    </>
  );
}
