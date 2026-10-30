/**
 * UI-TSD-06 데이터 완전성(`/explore/coverage`, UC-TSD-14, TSD-02.04). 권한 TS_READ(VIEWER 이상).
 * API: API-TSD-09 공백·완전성(spaceId, from·to — 90일 이하), 공간 트리 API-DEV-01, 기기 목록(측정 항목 — 탐색기 링크용).
 */
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Button, Card, PageHeader, SelectField } from "~/components/ui";
import { CoverageTable, coverageRows, type DeviceCompleteness, type GapEntry } from "~/features/explore/components/coverage";
import { errorText } from "~/lib/error-text";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/explore-coverage";

export function meta() {
  return [{ title: "data2flow" }];
}

const PERIOD_DAYS = [1, 7, 30, 90];
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = PERIOD_DAYS.includes(daysParam) ? daysParam : 7;
  const spaceId = /^\d+$/.test(url.searchParams.get("spaceId") ?? "") ? (url.searchParams.get("spaceId") as string) : "";
  const now = ctx.runtime.now();
  const q = new URLSearchParams({ from: iso(now - days * 86400_000), to: iso(now) });
  if (spaceId) q.set("spaceId", spaceId);
  const [gaps, spaces, devices] = await Promise.all([
    callApi<{ gaps?: GapEntry[]; devices?: DeviceCompleteness[] }>(ctx, request, `/api/v1/core/telemetry/gaps?${q}`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ id: string | number; metrics?: string[] | null; latest?: { metricKey: string }[] | null }>(ctx, request, "/api/v1/core/devices?size=100"),
  ]);
  const metricsOf: Record<string, string[]> = {};
  if (devices.ok) for (const d of devices.list.responses) metricsOf[String(d.id)] = d.metrics ?? (d.latest ?? []).map((m) => m.metricKey);
  return {
    days,
    spaceId,
    rows: gaps.ok ? coverageRows((gaps.data?.devices ?? []).map((d) => ({ ...d, deviceId: String(d.deviceId) })), (gaps.data?.gaps ?? []).map((g) => ({ ...g, deviceId: String(g.deviceId) }))) : [],
    failure: gaps.ok ? null : { code: gaps.code, message: gaps.message },
    spaces: spaces.ok ? flattenSpaces(spaces.data ?? []).map((sp) => ({ id: sp.id, name: sp.path.join(" › ") })) : [],
    metricsOf,
  };
}

export default function ExploreCoverage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  return (
    <>
      <PageHeader crumb={t("explore.crumb")} title={t("explore.coverage.title")} />
      <Card>
        <Form method="get" className="flex flex-wrap items-end gap-3">
          <SelectField label={t("explore.coverage.period")} name="days" defaultValue={String(loaderData.days)}>
            {PERIOD_DAYS.map((d) => (
              <option key={d} value={d}>
                {t("explore.coverage.lastDays", { n: d })}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("explore.coverage.space")} name="spaceId" defaultValue={loaderData.spaceId}>
            <option value="">{t("common.all")}</option>
            {loaderData.spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="primary">
            {t("common.search")}
          </Button>
        </Form>
        <p className="mt-2 text-[12px] text-muted">{t("explore.coverage.help")}</p>
      </Card>
      <div className="mt-4">
        <CoverageTable rows={loaderData.rows} metricsOf={loaderData.metricsOf} failure={loaderData.failure ? errorText(t, loaderData.failure) : null} timezone={root?.timezone ?? "Asia/Seoul"} lang={i18n.language} />
      </div>
    </>
  );
}
