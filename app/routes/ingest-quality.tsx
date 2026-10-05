/**
 * UI-ING-06 데이터 품질(`/ingest/quality`, ING-06.02). 권한 INGEST_READ 또는 ANALYTICS_RUN(OPERATOR·ANALYST 이상 — VIEWER도 ANALYTICS_READ가 있어 화면 권한은 ANALYTICS_RUN으로 가린다).
 * API: 순위 API-ING-13(`day` 기본 어제, `groupBy` device|space|model, `spaceId`), 최하위 10개·문제 유형 분포 `GET /core/ingest/quality/summary`,
 * 30일 추이 `GET /core/ingest/quality/trend`(브라우저에서 BFF로)
 */
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Button, Card, PageHeader, SelectField, TextField } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { qualityApi } from "~/features/ingest/m5-api";
import { QUALITY_GROUPS, type QualityGroup, type QualityItem, type QualitySummary } from "~/features/ingest/model/m5";
import { QualityView } from "~/features/ingest/quality";
import { DEFAULT_TIMEZONE, zonedDate } from "~/lib/format";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/ingest-quality";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const groupParam = url.searchParams.get("groupBy") ?? "device";
  const group: QualityGroup = (QUALITY_GROUPS as readonly string[]).includes(groupParam) ? (groupParam as QualityGroup) : "device";
  const dayParam = url.searchParams.get("day") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : zonedDate(ctx.runtime.now(), DEFAULT_TIMEZONE, -1);
  const spaceId = /^\d+$/.test(url.searchParams.get("spaceId") ?? "") ? (url.searchParams.get("spaceId") as string) : "";
  const q = new URLSearchParams({ day, groupBy: group, page: "1", size: "100" });
  if (spaceId) q.set("spaceId", spaceId);
  const s = new URLSearchParams({ day, groupBy: group });
  if (spaceId) s.set("spaceId", spaceId);
  const [list, summary, spaces] = await Promise.all([
    callList<QualityItem>(ctx, request, `/api/v1/core/ingest/quality?${q}`),
    callApi<QualitySummary>(ctx, request, `/api/v1/core/ingest/quality/summary?${s}`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
  ]);
  return {
    day,
    group,
    spaceId,
    items: list.ok ? list.list.responses.map((i) => ({ ...i, targetId: String(i.targetId) })) : [],
    failed: !list.ok,
    summary: summary.ok ? (summary.data ?? null) : null,
    spaces: spaces.ok ? flattenSpaces(spaces.data ?? []).map((sp) => ({ id: sp.id, name: sp.path.join(" › ") })) : [],
  };
}

export default function IngestQuality({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { day, group, spaceId } = loaderData;
  return (
    <>
      <PageHeader crumb={t("ingest.crumb")} title={t("ingest.quality.title")} />
      <IngestAreaTabs current="quality" />
      <Card>
        <Form method="get" className="flex flex-wrap items-end gap-2">
          <TextField label={t("ingest.quality.day")} name="day" type="date" defaultValue={day} />
          <SelectField label={t("ingest.quality.groupBy")} name="groupBy" defaultValue={group}>
            {QUALITY_GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`ingest.quality.groups.${g}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("ingest.quality.space")} name="spaceId" defaultValue={spaceId}>
            <option value="">{t("common.all")}</option>
            {loaderData.spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </SelectField>
          <Button type="submit">{t("common.search")}</Button>
        </Form>
      </Card>
      <div className="mt-4">
        <QualityView key={`${day}-${group}-${spaceId}`} items={loaderData.items} summary={loaderData.summary} group={group} day={day} failed={loaderData.failed} timezone={root?.timezone ?? "Asia/Seoul"} api={qualityApi} />
      </div>
    </>
  );
}
