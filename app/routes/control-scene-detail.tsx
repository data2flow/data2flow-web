/**
 * UI-ACT-04 장면 편집·미리보기·실행(`/control/scenes/{id}`, `new`는 새 장면, ACT-05.01~03).
 * API: 장면 API-ACT-10, 미리보기 API-ACT-12, 실행 API-ACT-11(브라우저 → BFF). 대상 후보는 기기 목록(API-DEV-11)·공간 트리(API-DEV-01)·기능 카탈로그(API-ACT-25)
 */
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useRouteLoaderData } from "react-router";
import { callApi, callList, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, PageHeader } from "~/components/ui";
import type { Scene } from "~/features/control/model/admin";
import { SceneEditor } from "~/features/control/scenes";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/control-scene-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const isNew = params.sceneId === "new";
  const [scene, devices, spaces, capabilities] = await Promise.all([
    isNew ? Promise.resolve(null) : callApi<Scene>(ctx, request, `/api/v1/core/scenes/${encodeURIComponent(params.sceneId)}`),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/devices?status=ACTIVE&size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ name: string }>(ctx, request, "/api/v1/core/capabilities?size=100"),
  ]);
  return {
    scene: scene ? orThrow(scene) : null,
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    capabilities: capabilities.ok ? capabilities.list.responses.map((c) => c.name) : ["Switch", "Thermostat", "FanSpeed", "Ventilation", "Dimmer", "Lock"],
  };
}

export default function ControlSceneDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const { scene, devices, spaces, capabilities } = loaderData;
  const canManage = hasAny(permissions, ["SCENE_MANAGE"]);
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/control/scenes" className="hover:underline">
            {t("control.scenes.title")}
          </Link>
        }
        title={scene?.name ?? t("control.scenes.new")}
      />
      {!canManage && (
        <div className="mb-3">
          <Alert tone="info">{t("control.common.readOnly")}</Alert>
        </div>
      )}
      <SceneEditor
        key={scene ? `${scene.sceneId}:${scene.version}` : "new"}
        scene={scene}
        devices={devices}
        spaces={spaces}
        capabilities={capabilities}
        canManage={canManage}
        canRun={hasAny(permissions, ["SCENE_RUN"])}
        onSaved={(saved) => {
          if (!scene) navigate(`/control/scenes/${encodeURIComponent(saved.sceneId)}`, { replace: true });
        }}
        onDeleted={() => navigate("/control/scenes")}
      />
    </>
  );
}
