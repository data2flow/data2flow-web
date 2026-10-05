/**
 * UI-RUL-10 알람 통계(RUL-06.01, AT-RUL-14.1). RULE_READ(ANALYST+).
 * API-RUL-20 `GET /alarms/stats?from=&to=&spaceId=` → 카드(발생 수·MTTA·MTTR·미확인 비율), 상위 규칙·공간·기기 순위, 일별 추이.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useSearchParams } from "react-router";
import { callApi, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { SpaceSelect } from "~/components/space-picker";
import { Button, ButtonLink, Card, Kpi, PageHeader, SelectField, Table } from "~/components/ui";
import { formatDuration } from "~/features/alarms/components/alarm-list-view";
import { EChart } from "~/features/rules/components/echart";
import { dailyBarOption } from "~/features/rules/model/simulation";
import type { SpaceNode } from "~/lib/spaces";
import type { Route } from "./+types/alarm-stats";

const PERIODS = [7, 30, 90] as const;

interface Ranked {
  id?: string;
  ruleId?: string;
  spaceId?: string;
  deviceId?: string;
  name: string;
  count: number;
}

interface AlarmStats {
  raised: number;
  mttaSec: number | null;
  mttrSec: number | null;
  unackedRatio: number | null;
  topRules: Ranked[];
  topSpaces: Ranked[];
  topDevices: Ranked[];
  daily: { date: string; raised: number }[];
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const days = (PERIODS as readonly number[]).includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 7;
  const now = ctx.runtime.now();
  const query = new URLSearchParams({ from: new Date(now - days * 86_400_000).toISOString(), to: new Date(now).toISOString() });
  const spaceId = url.searchParams.get("spaceId");
  if (spaceId) query.set("spaceId", spaceId);
  const [stats, spaces] = await Promise.all([callApi<AlarmStats>(ctx, request, `/api/v1/core/alarms/stats?${query}`), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
  return { days, stats: orThrow(stats), spaces: spaces.ok ? (spaces.data ?? []) : [] };
}

export default function AlarmStatsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { stats } = loaderData;
  const option = useMemo(() => dailyBarOption(stats.daily ?? [], t("alarmStats.raised")), [stats.daily, t]);
  const cards = [
    { key: "raised", value: String(stats.raised ?? 0) },
    { key: "mtta", value: stats.mttaSec == null ? "–" : formatDuration(Math.round(stats.mttaSec), t) },
    { key: "mttr", value: stats.mttrSec == null ? "–" : formatDuration(Math.round(stats.mttrSec), t) },
    { key: "unacked", value: stats.unackedRatio == null ? "–" : `${Math.round(stats.unackedRatio * 100)}%` },
  ];
  const ranking = (title: string, rows: Ranked[], link?: (r: Ranked) => string | null) => (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{t("common.none")}</p>
      ) : (
        <ol className="flex flex-col gap-1 text-[13px]">
          {rows.slice(0, 10).map((r, i) => {
            const to = link?.(r);
            return (
              <li key={`${r.name}-${i}`} className="flex justify-between gap-2">
                <span>
                  {i + 1}. {to ? <Link to={to} className="text-accent underline">{r.name}</Link> : r.name}
                </span>
                <span className="font-mono">{r.count}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
  return (
    <>
      <PageHeader crumb={t("alarms.crumb")} title={t("alarmStats.title")} actions={<ButtonLink to="/rules/tuning">{t("tuning.title")}</ButtonLink>} />
      <Card>
        <Form method="get" className="flex flex-wrap items-end gap-2">
          <SelectField label={t("alarmStats.period")} name="days" defaultValue={String(loaderData.days)}>
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {t("rules.sim.days", { n: d })}
              </option>
            ))}
          </SelectField>
          <SpaceSelect spaces={loaderData.spaces} name="spaceId" label={t("alarms.filter.space")} emptyLabel={t("common.all")} defaultValue={params.get("spaceId") ?? ""} />
          <Button type="submit">{t("common.search")}</Button>
        </Form>
      </Card>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <Kpi key={c.key} label={t(`alarmStats.cards.${c.key}`)} value={c.value} />
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {ranking(t("alarmStats.topRules"), stats.topRules ?? [], (r) => (r.ruleId ?? r.id ? `/rules/${encodeURIComponent(String(r.ruleId ?? r.id))}` : null))}
        {ranking(t("alarmStats.topSpaces"), stats.topSpaces ?? [], (r) => (r.spaceId ?? r.id ? `/spaces/${encodeURIComponent(String(r.spaceId ?? r.id))}` : null))}
        {ranking(t("alarmStats.topDevices"), stats.topDevices ?? [], (r) => (r.deviceId ?? r.id ? `/devices/${encodeURIComponent(String(r.deviceId ?? r.id))}` : null))}
      </div>
      <div className="mt-4">
        <Card title={t("alarmStats.daily")}>
          <EChart option={option} label={t("alarmStats.daily")} />
          <Table>
            <caption className="sr-only">{t("alarmStats.daily")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("alarmStats.date")}</th>
                <th scope="col">{t("alarmStats.raised")}</th>
              </tr>
            </thead>
            <tbody>
              {(stats.daily ?? []).map((d) => (
                <tr key={d.date}>
                  <td className="font-mono">{d.date}</td>
                  <td className="font-mono">{d.raised}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
