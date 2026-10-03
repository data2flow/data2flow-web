/**
 * UI-FLW-02 플로우 편집기(FLW-01.01·01.02·01.06·03.07·05.03·05.06). 조회 FLOW_READ(ANALYST는 읽기 전용), 저장·적용 FLOW_WRITE,
 * 제어 노드 포함 적용 FLOW_DEPLOY_CONTROL(서버가 다시 검사, 없으면 팔레트의 제어 노드 잠김).
 * API: 상세 API-FLW-02, 카탈로그 API-FLW-30, 지표 API-FLW-14. 저장·검증·적용·버전·롤백은 브라우저에서 BFF로(API-FLW-03·04·06·07·08)
 */
import { useNavigate, useRevalidator, useRouteLoaderData } from "react-router";
import { callApi, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { flowApi } from "~/features/flows/api";
import { FlowEditor } from "~/features/flows/flow-editor";
import type { FlowDetail } from "~/features/flows/model/types";
import { loadEditorContext } from "~/features/flows/server";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/flow-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.flowId);
  const [detail, editor] = await Promise.all([callApi<FlowDetail>(ctx, request, `/api/v1/core/flows/${id}`), loadEditorContext(ctx, request, params.flowId)]);
  return { detail: orThrow(detail), ...editor };
}

export default function FlowDetailPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const permissions = root?.me?.permissions;
  const { detail } = loaderData;
  return (
    <>
      <PageHeader crumb={t("flows.crumb")} title={detail.flow.name} />
      <FlowEditor
        key={`${detail.flow.flowId}:${detail.flow.activeVersion ?? ""}:${detail.flow.draftVersion ?? ""}:${detail.version.version}`}
        detail={detail}
        nodeTypes={loaderData.nodeTypes}
        spaces={loaderData.spaces}
        devices={loaderData.devices}
        models={loaderData.models}
        metricKeys={loaderData.metricKeys}
        metrics={loaderData.metrics}
        canWrite={hasAny(permissions, ["FLOW_WRITE"])}
        canDeployControl={hasAny(permissions, ["FLOW_DEPLOY_CONTROL"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        api={flowApi}
        onCreated={(flowId) => navigate(`/automation/flows/${encodeURIComponent(flowId)}`, { replace: true })}
        onReload={() => void revalidator.revalidate()}
      />
    </>
  );
}
