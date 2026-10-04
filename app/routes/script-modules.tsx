/**
 * UI-SCR-06 공유 모듈 목록(`/scripts/modules`, SCR-04.01). 조회 SCRIPT_READ, [새 모듈] SCRIPT_WRITE.
 * API: 목록 API-SCR-18(GET), 생성 API-SCR-18(POST, 브라우저에서 BFF로)
 */
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useRouteLoaderData, useSearchParams } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { ButtonLink, Card, EmptyState, PageHeader, Table } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { ScriptAreaTabs } from "~/features/scripts/area-tabs";
import { moduleApi, type ModuleSummary } from "~/features/scripts/m5-api";
import { CreateModuleDialog } from "~/features/scripts/module-editor";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/script-modules";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const list = await callList<ModuleSummary>(ctx, request, "/api/v1/core/script-modules?page=1&size=100");
  return { modules: list.ok ? list.list.responses.map((m) => ({ ...m, id: String(m.id) })) : [], failed: !list.ok };
}

export default function ScriptModules({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const canWrite = hasAny(root?.me?.permissions, ["SCRIPT_WRITE"]);
  const { modules } = loaderData;
  return (
    <>
      <PageHeader
        crumb={t("scripts.crumb")}
        title={t("scripts.modules.title")}
        actions={
          canWrite && (
            <ButtonLink to="?dialog=create" variant="primary">
              {t("scripts.modules.new")}
            </ButtonLink>
          )
        }
      />
      <IngestAreaTabs current="scripts" />
      <ScriptAreaTabs current="modules" />
      {canWrite && params.get("dialog") === "create" && (
        <CreateModuleDialog open onClose={() => navigate("/scripts/modules")} onCreated={(m) => navigate(`/scripts/modules/${encodeURIComponent(m.id)}`)} api={moduleApi} />
      )}
      <Card>
        {loaderData.failed && <p className="mb-2 text-[12.5px] text-warn">{t("scripts.modules.loadFailed")}</p>}
        {modules.length === 0 ? (
          <EmptyState title={t("scripts.modules.empty")} body={t("scripts.modules.emptyBody")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("scripts.modules.name")}</th>
                <th>{t("scripts.modules.description")}</th>
                <th>{t("scripts.modules.latestCol")}</th>
                <th>{t("scripts.modules.usedByCol")}</th>
                <th>{t("scripts.modules.updatedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/scripts/modules/${encodeURIComponent(m.id)}`} className="font-mono text-accent hover:underline">
                      {m.name}
                    </Link>
                  </td>
                  <td>{m.description ?? ""}</td>
                  <td className="font-mono">{m.latestVersionNo ? `v${m.latestVersionNo}` : "–"}</td>
                  <td>{t("scripts.modules.usedByN", { n: m.usedBy ?? 0 })}</td>
                  <td>{formatDateTime(m.updatedAt, root?.timezone ?? "Asia/Seoul", i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
