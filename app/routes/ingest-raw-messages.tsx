/**
 * UI-ING-02 원본 메시지 목록(`/ingest/raw-messages`, UC-ING-06, ING-01.01/02). 권한 INGEST_READ(OPERATOR 이상).
 * API: API-ING-05 커서 목록(기간 필수·31일 이하·보관 30일 안, 소스·기기·상태 여러 개, 토픽 포함 문자열, 가상 포함), 행을 누르면 API-ING-06 상세 패널.
 * 소스 후보 API-DSC-01, 기기 후보 API-DEV-10. CSV 내보내기(`format=csv`)는 core가 아직 400이라 넣지 않는다.
 */
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData } from "react-router";
import { callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Button, Card, PageHeader, SelectField, TextField } from "~/components/ui";
import { IngestAreaTabs } from "~/features/ingest/area-tabs";
import { RAW_PERIODS, RAW_STATUSES, RawMessageList, rawPeriod, type RawMessageRow, type RawPeriod } from "~/features/ingest/raw-messages";
import { errorText } from "~/lib/error-text";
import type { RootData } from "~/root";
import type { Route } from "./+types/ingest-raw-messages";

export function meta() {
  return [{ title: "data2flow" }];
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const ids = (values: string[]) => values.filter((v) => /^\d+$/.test(v));

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const p = url.searchParams;
  const period = rawPeriod(p.get("period"));
  const now = ctx.runtime.now();
  const filter = {
    period,
    sourceIds: ids(p.getAll("sourceId")),
    deviceIds: ids(p.getAll("deviceId")),
    statuses: p.getAll("status").filter((s) => /^[A-Z_]{1,40}$/.test(s)),
    topic: (p.get("topic") ?? "").slice(0, 200),
    includeVirtual: p.get("virtual") !== "false",
  };
  const q = new URLSearchParams({ from: iso(now - RAW_PERIODS[period] * 3600_000), to: iso(now), size: "50", includeVirtual: String(filter.includeVirtual) });
  filter.sourceIds.forEach((id) => q.append("sourceId", id));
  filter.deviceIds.forEach((id) => q.append("deviceId", id));
  filter.statuses.forEach((s) => q.append("status", s));
  if (filter.topic) q.set("topicContains", filter.topic);
  const cursor = p.get("cursor");
  if (cursor) q.set("cursor", cursor);
  const [listed, sources, devices] = await Promise.all([
    callList<RawMessageRow>(ctx, request, `/api/v1/core/ingest/raw-messages?${q}`),
    callList<{ id: string | number; name: string }>(ctx, request, "/api/v1/core/sources?size=100"),
    callList<{ id: string | number; name: string }>(ctx, request, "/api/v1/core/devices?size=100"),
  ]);
  const env = listed.ok ? (listed.list as unknown as { countsByStatus?: Record<string, number>; nextCursor?: string | null }) : {};
  return {
    filter,
    rows: listed.ok ? listed.list.responses.map((r) => ({ ...r, id: String(r.id), sourceId: r.sourceId == null ? null : String(r.sourceId), deviceId: r.deviceId == null ? null : String(r.deviceId) })) : [],
    counts: env.countsByStatus ?? {},
    nextCursor: env.nextCursor ?? null,
    failure: listed.ok ? null : { code: listed.code, message: listed.message },
    sources: sources.ok ? sources.list.responses.map((s) => ({ id: String(s.id), name: s.name })) : [],
    devices: devices.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
  };
}

export default function IngestRawMessages({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { filter } = loaderData;
  const base = () => {
    const q = new URLSearchParams({ period: filter.period });
    filter.sourceIds.forEach((id) => q.append("sourceId", id));
    filter.deviceIds.forEach((id) => q.append("deviceId", id));
    if (filter.topic) q.set("topic", filter.topic);
    if (!filter.includeVirtual) q.set("virtual", "false");
    return q;
  };
  const statusLink = (status: string) => {
    const q = base();
    q.append("status", status);
    return `?${q}`;
  };
  const nextLink = loaderData.nextCursor
    ? (() => {
        const q = base();
        filter.statuses.forEach((s) => q.append("status", s));
        q.set("cursor", loaderData.nextCursor);
        return `?${q}`;
      })()
    : null;
  return (
    <>
      <PageHeader crumb={t("ingest.crumb")} title={t("ingest.rawList.title")} />
      <IngestAreaTabs current="raw" />
      <Card>
        <Form method="get" className="flex flex-wrap items-end gap-3">
          <SelectField label={t("ingest.rawList.period")} name="period" defaultValue={filter.period}>
            {(Object.keys(RAW_PERIODS) as RawPeriod[]).map((k) => (
              <option key={k} value={k}>
                {t(`ingest.rawList.periods.${k}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("ingest.rawList.source")} name="sourceId" multiple size={3} defaultValue={filter.sourceIds}>
            {loaderData.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("ingest.rawList.device")} name="deviceId" multiple size={3} defaultValue={filter.deviceIds}>
            {loaderData.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("ingest.raw.status")} name="status" multiple size={3} defaultValue={filter.statuses}>
            {RAW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <TextField label={t("ingest.rawList.topic")} name="topic" maxLength={200} defaultValue={filter.topic} />
          <SelectField label={t("ingest.rawList.virtual")} name="virtual" defaultValue={String(filter.includeVirtual)}>
            <option value="true">{t("ingest.rawList.includeVirtual")}</option>
            <option value="false">{t("ingest.rawList.excludeVirtual")}</option>
          </SelectField>
          <Button type="submit" variant="primary">
            {t("common.search")}
          </Button>
        </Form>
        <p className="mt-2 text-[12px] text-muted">{t("ingest.rawList.retention")}</p>
      </Card>
      <div className="mt-4">
        <RawMessageList
          rows={loaderData.rows}
          counts={loaderData.counts}
          statusLink={statusLink}
          nextLink={nextLink}
          failure={loaderData.failure ? errorText(t, loaderData.failure) : null}
          timezone={root?.timezone ?? "Asia/Seoul"}
          lang={i18n.language}
        />
      </div>
    </>
  );
}
