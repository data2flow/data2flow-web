/**
 * UI-RUL-05 알람 상세(RUL-02.01·02.02·02.04, RUL-04.01). 조회 ALARM_READ(VIEWER+), 조치 ALARM_HANDLE(OPERATOR+).
 * API: 상세 API-RUL-11 `{alarm, events, children, chart}`, 차트 API-TSD-02(기기)·API-TSD-04(공간 평균), 발송 이력 API-RUL-27(`alarmId`),
 * 처리 API-RUL-12(ack·clear)·API-RUL-13(notes·assignee)·API-RUL-25(무음, 대상 ALARM).
 * 담당자 후보: 회원 목록(API-IAM-31)은 IAM_MANAGE만 볼 수 있어, 그 밖의 역할은 "나"와 지금 담당자만 고른다.
 */
import { useTranslation } from "react-i18next";
import { data, useRouteLoaderData } from "react-router";
import { callApi, callList, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { ButtonLink, PageHeader } from "~/components/ui";
import { ACTION_TYPES, AlarmDetailView, NOTE_MAX, type AlarmActionResult, type AlarmDetailData, type Delivery } from "~/features/alarms/components/alarm-detail-view";
import { quickSilence } from "~/features/alarms/model/silence";
import type { ChartSeries, SeriesPoint } from "~/lib/chart-model";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/alarm-detail";

const HOUR = 3_600_000;

export function meta() {
  return [{ title: "data2flow" }];
}

interface TelemetryResult {
  resolutionUsed?: string;
  series?: { metric?: string; unit?: string | null; points?: SeriesPoint[]; gaps?: { from: string; to: string }[] }[];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const id = encodeURIComponent(params.alarmId);
  const [detailResult, me] = await Promise.all([callApi<AlarmDetailData>(ctx, request, `/api/v1/core/alarms/${id}`), getMe(ctx, request)]);
  const detail = orThrow(detailResult);
  const alarm = { ...detail.alarm, id: String(detail.alarm.id) };
  const metric = detail.chart?.metric ?? alarm.metric;
  const from = detail.chart?.from ?? new Date(Date.parse(alarm.raisedAt) - 2 * HOUR).toISOString();
  const to = detail.chart?.to ?? new Date(Math.min(ctx.runtime.now(), Date.parse(alarm.clearedAt ?? alarm.raisedAt) + 2 * HOUR)).toISOString();
  const timezone = me.ok ? (me.data.timezone ?? "Asia/Seoul") : "Asia/Seoul";
  const telemetry = metric
    ? alarm.device?.id
      ? callApi<TelemetryResult>(ctx, request, `/api/v1/core/telemetry/series?${new URLSearchParams({ deviceId: String(alarm.device.id), metrics: metric, from, to, resolution: "auto", tz: timezone })}`)
      : alarm.space?.id
        ? callApi<TelemetryResult>(ctx, request, "/api/v1/core/telemetry/query", { method: "POST", body: { series: [{ spaceId: String(alarm.space.id), metric, agg: "avg" }], from, to, resolution: "auto", tz: timezone } })
        : Promise.resolve(null)
    : Promise.resolve(null);
  const permissions = me.ok ? me.data.permissions : [];
  const [chart, deliveries, users] = await Promise.all([
    telemetry,
    callList<Delivery>(ctx, request, `/api/v1/core/notification-deliveries?${new URLSearchParams({ alarmId: alarm.id, size: "50" })}`),
    hasAny(permissions, ["IAM_MANAGE"]) ? callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/users?status=ACTIVE&size=100") : Promise.resolve(null),
  ]);
  const first = chart?.ok ? chart.data.series?.[0] : undefined;
  // core Alarm(API-RUL-10)에는 단위가 없다 → 값 표시는 차트 시계열의 단위를 쓴다
  if (!alarm.unit && first?.unit) alarm.unit = first.unit;
  const series: ChartSeries[] = first ? [{ key: `alarm-${alarm.id}`, label: metric ?? "", unit: first.unit ?? alarm.unit ?? null, points: first.points ?? [], gaps: first.gaps ?? [], raw: chart?.ok ? chart.data.resolutionUsed === "raw" : false }] : [];
  const candidates = new Map<string, { userId: string; name: string }>();
  if (me.ok) candidates.set(String(me.data.id), { userId: String(me.data.id), name: me.data.name ?? me.data.loginId });
  if (alarm.assignee) candidates.set(String(alarm.assignee.userId), { userId: String(alarm.assignee.userId), name: alarm.assignee.name });
  if (users?.ok) for (const u of users.list.responses) candidates.set(String(u.id), { userId: String(u.id), name: u.name });
  return {
    detail: { ...detail, alarm, children: (detail.children ?? []).map((c) => ({ ...c, id: String(c.id) })), events: detail.events ?? [] },
    series,
    deliveries: deliveries.ok ? deliveries.list.responses : null,
    users: [...candidates.values()],
    nowMs: ctx.runtime.now(),
  };
}

export async function action({ request, context, params }: Route.ActionArgs): Promise<AlarmActionResult | ReturnType<typeof data<AlarmActionResult>>> {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const base = `/api/v1/core/alarms/${encodeURIComponent(params.alarmId)}`;
  let result;
  if (intent === "ack") result = await callApi(ctx, request, `${base}/ack`, { method: "POST", body: {} });
  else if (intent === "clear") {
    const note = field(form, "note").trim();
    if (note.length > NOTE_MAX) return data({ intent, fieldErrors: { note: "alarms.v.noteLength" } }, { status: 400 });
    result = await callApi(ctx, request, `${base}/clear`, { method: "POST", body: note ? { note } : {} });
  } else if (intent === "note") {
    const text = field(form, "text").trim();
    const actionType = field(form, "actionType");
    if (!text || text.length > NOTE_MAX) return data({ intent, fieldErrors: { text: "alarms.v.noteLength" } }, { status: 400 });
    if (actionType && !(ACTION_TYPES as readonly string[]).includes(actionType)) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
    result = await callApi(ctx, request, `${base}/notes`, { method: "POST", body: actionType ? { text, actionType } : { text } });
  } else if (intent === "assign") {
    const userId = field(form, "userId");
    if (!userId) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
    result = await callApi(ctx, request, `${base}/assignee`, { method: "PUT", body: { userId } });
  } else if (intent === "silence") {
    const minutes = Number(field(form, "minutes"));
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
    result = await callApi(ctx, request, "/api/v1/core/silences", { method: "POST", body: quickSilence({ type: "ALARM", id: params.alarmId }, minutes, ctx.runtime.now()) });
  } else return data({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
  if (!result.ok) return data({ intent, error: { code: result.code, message: result.message } }, { status: result.status });
  return { intent, ok: true };
}

export default function AlarmDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { detail } = loaderData;
  return (
    <>
      <PageHeader crumb={t("alarms.crumb")} title={detail.alarm.title} actions={<ButtonLink to="/alarms">{t("alarms.backToList")}</ButtonLink>} />
      <AlarmDetailView
        detail={detail}
        deliveries={loaderData.deliveries}
        series={loaderData.series}
        users={loaderData.users}
        meId={root?.me?.id}
        canHandle={hasAny(root?.me?.permissions, ["ALARM_HANDLE"])}
        timezone={root?.timezone ?? "Asia/Seoul"}
        nowMs={loaderData.nowMs}
        result={actionData as AlarmActionResult | undefined}
      />
    </>
  );
}
