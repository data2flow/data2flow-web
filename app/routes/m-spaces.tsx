/**
 * UI-DSH-14 공간 탭(`/m/spaces`): 공간 트리(API-DSH-02)를 한 줄씩(기기·오프라인·알람 수). 누르면 공간 보기. DEV_READ.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { EmptyState } from "~/components/ui";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { Route } from "./+types/m-spaces";

export async function loader({ request, context }: Route.LoaderArgs) {
  const result = await callApi<SpaceNode[]>(bff(context), request, "/api/v1/core/spaces");
  return { spaces: result.ok ? flattenSpaces(result.data ?? []).map((s) => ({ id: s.id, name: s.name, depth: s.depth, counts: s.node.counts ?? null })) : [] };
}

export default function MobileSpaces({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  if (loaderData.spaces.length === 0) return <EmptyState title={t("field.mobile.noSpaces")} />;
  return (
    <ul className="flex flex-col gap-1">
      {loaderData.spaces.map((s) => (
        <li key={s.id}>
          <Link to={`/spaces/${encodeURIComponent(s.id)}`} className="flex min-h-11 items-center justify-between rounded border border-line bg-panel px-3" style={{ marginLeft: `${(s.depth - 1) * 12}px` }}>
            <span>{s.name}</span>
            {s.counts && <span className="text-[12px] text-muted">{t("field.mobile.spaceCounts", { devices: s.counts.devices ?? 0, alarms: s.counts.alarms ?? 0 })}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
