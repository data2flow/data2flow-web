/**
 * UI-ACT-04 장면 목록(`/control/scenes`, ACT-05.01). 조회 DEV_READ(경로는 SCENE_RUN·SCENE_MANAGE), 새 장면 SCENE_MANAGE.
 * API: API-ACT-10 `GET /api/v1/core/scenes`
 */
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, ButtonLink, Card, EmptyState, PageHeader, Table } from "~/components/ui";
import { ControlAreaTabs } from "~/features/control/area-tabs";
import type { SceneSummary } from "~/features/control/model/admin";
import { sceneSpaceName } from "~/features/control/scenes";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/control-scenes";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [scenes, spaces] = await Promise.all([callList<SceneSummary>(ctx, request, "/api/v1/core/scenes?size=100"), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
  return { scenes: scenes.ok ? scenes.list.responses : [], failed: !scenes.ok, spaces: spaces.ok ? (spaces.data ?? []) : [] };
}

export default function ControlScenes({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const { scenes, failed, spaces } = loaderData;
  return (
    <>
      <PageHeader
        crumb={t("nav.control")}
        title={t("control.scenes.title")}
        actions={
          hasAny(permissions, ["SCENE_MANAGE"]) && (
            <ButtonLink to="/control/scenes/new" variant="primary">
              {t("control.scenes.new")}
            </ButtonLink>
          )
        }
      />
      <ControlAreaTabs current="scenes" permissions={permissions} />
      <Card>
        {failed && <Alert tone="warning">{t("control.common.loadFailed")}</Alert>}
        {scenes.length === 0 && !failed ? (
          <EmptyState title={t("control.scenes.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("control.scenes.colName")}</th>
                <th>{t("control.scenes.colItems")}</th>
                <th>{t("control.scenes.colSpace")}</th>
                <th>{t("control.scenes.colUpdated")}</th>
                <th>{t("control.history.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {scenes.map((s) => (
                <tr key={s.sceneId}>
                  <td>
                    <Link to={`/control/scenes/${encodeURIComponent(s.sceneId)}`} className="text-accent hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="font-mono">{s.itemCount}</td>
                  <td>{sceneSpaceName(spaces, s.spaceId)}</td>
                  <td>{formatDateTime(s.updatedAt, root?.timezone ?? "Asia/Seoul", i18n.language)}</td>
                  <td>
                    <Link to={`/control/scenes/${encodeURIComponent(s.sceneId)}`} className="text-accent hover:underline">
                      {hasAny(permissions, ["SCENE_RUN"]) ? t("control.scenes.run") : t("control.common.open")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
