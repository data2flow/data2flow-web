/**
 * UI-FLW-02 새 플로우(빈 캔버스, FLW-01.01). FLOW_WRITE만(경로 가드). 처음 [저장]하면 API-FLW-03으로 만들고 편집기 주소로 옮긴다.
 */
import { useTranslation } from "react-i18next";
import { useNavigate, useRouteLoaderData } from "react-router";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { flowApi } from "~/features/flows/api";
import { FlowEditor } from "~/features/flows/flow-editor";
import { loadEditorContext } from "~/features/flows/server";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/flow-new";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadEditorContext(bff(context), request);
}

export default function FlowNewPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  const permissions = root?.me?.permissions;
  return (
    <>
      <PageHeader crumb={t("flows.crumb")} title={t("flows.newTitle")} />
      <FlowEditor
        detail={null}
        nodeTypes={loaderData.nodeTypes}
        spaces={loaderData.spaces}
        devices={loaderData.devices}
        models={loaderData.models}
        metricKeys={loaderData.metricKeys}
        metrics={null}
        canWrite={hasAny(permissions, ["FLOW_WRITE"])}
        canDeployControl={hasAny(permissions, ["FLOW_DEPLOY_CONTROL"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        me={root?.me ? { userId: root.me.id, name: root.me.name ?? root.me.loginId } : undefined}
        api={flowApi}
        onCreated={(flowId) => navigate(`/automation/flows/${encodeURIComponent(flowId)}`, { replace: true })}
        onReload={() => undefined}
      />
    </>
  );
}
