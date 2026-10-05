/**
 * UI-DEV-14 조직 달력(`/calendar?view=month|week|list&date=YYYY-MM-DD&spaceId=`, DEV-12.01, DSC-06.03·06.04).
 * 조회 DEV_READ(VIEWER+) API-DEV-101, 추가 API-DEV-100, 수정·삭제 API-DEV-102(DEV_PLACE, OPERATOR+). 외부 달력 연결은 SRC_ADMIN(INTEGRATOR+)에게 외부 맥락 화면 링크.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, useRouteLoaderData } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, ButtonLink, Card, PageHeader, Tabs } from "~/components/ui";
import { CalendarGrid, CalendarToolbar, EventDialog, ExternalCalendarLink, type CalendarResult } from "~/features/calendar/components/calendar-view";
import { checkEvent, eventPatch, shiftAnchor, viewRange, type CalendarEvent, type CalendarView } from "~/features/calendar/model/calendar";
import { resolveTimezone, zonedDate } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/calendar";

const VIEWS = ["month", "week", "list"] as const;

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const me = await getMe(ctx, request);
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const today = zonedDate(ctx.runtime.now(), timezone);
  const viewParam = url.searchParams.get("view") ?? "month";
  const view: CalendarView = (VIEWS as readonly string[]).includes(viewParam) ? (viewParam as CalendarView) : "month";
  const dateParam = url.searchParams.get("date") ?? "";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;
  const spaceId = url.searchParams.get("spaceId") ?? "";
  const { from, to } = viewRange(view, anchor);
  const query = new URLSearchParams({ from, to, size: "100" });
  if (spaceId) query.set("spaceId", spaceId);
  const [events, spaces] = await Promise.all([callList<CalendarEvent>(ctx, request, `/api/v1/core/calendar-events?${query}`), callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces")]);
  return {
    view,
    anchor,
    today,
    spaceId,
    events: events.ok ? events.list.responses.map((e) => ({ ...e, id: String(e.id) })) : [],
    failed: !events.ok,
    spaces: spaces.ok ? (spaces.data ?? []) : [],
  };
}

function fail(intent: string, result: { code: string; message: string; status: number; errors?: { field: string; code: string }[] }) {
  const fieldErrors = Object.fromEntries((result.errors ?? []).map((e) => [e.field, e.code]));
  return data({ intent, error: { code: result.code, message: result.message }, fieldErrors } as CalendarResult, { status: result.status });
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(field(form, "id"));
  if (intent === "delete") {
    const result = await callApi(ctx, request, `/api/v1/core/calendar-events/${id}`, { method: "DELETE" });
    return result.ok ? ({ intent, ok: true } as CalendarResult) : fail(intent, result);
  }
  if (intent !== "create" && intent !== "update") return data({ intent, error: { code: "INVALID_REQUEST" } } as CalendarResult, { status: 400 });
  const input = {
    title: field(form, "title"),
    type: field(form, "type"),
    startsOn: field(form, "startsOn"),
    endsOn: field(form, "endsOn"),
    startTime: field(form, "startTime"),
    endTime: field(form, "endTime"),
    affectsMode: field(form, "affectsMode"),
    scopeSpaceIds: form.getAll("scopeSpaceIds").map(String).filter(Boolean),
  };
  if (intent === "create") {
    const errors = checkEvent(input);
    if (Object.keys(errors).length) return data({ intent, fieldErrors: errors } as CalendarResult, { status: 400 });
    const body = { title: input.title.trim(), type: input.type, startsOn: input.startsOn, endsOn: input.endsOn, startTime: input.startTime || null, endTime: input.endTime || null, scopeSpaceIds: input.scopeSpaceIds, affectsMode: input.affectsMode || null };
    const result = await callApi(ctx, request, "/api/v1/core/calendar-events", { method: "POST", body });
    return result.ok ? ({ intent, ok: true } as CalendarResult) : fail(intent, result);
  }
  const before = await callApi<CalendarEvent>(ctx, request, `/api/v1/core/calendar-events/${id}`);
  if (!before.ok) return fail(intent, before);
  const auto = before.data.origin !== "MANUAL";
  if (!auto) {
    const errors = checkEvent(input);
    if (Object.keys(errors).length) return data({ intent, fieldErrors: errors } as CalendarResult, { status: 400 });
  }
  const merged = auto ? { ...before.data, title: before.data.title, type: before.data.type, startsOn: before.data.startsOn, endsOn: before.data.endsOn, startTime: before.data.startTime ?? "", endTime: before.data.endTime ?? "", affectsMode: input.affectsMode, scopeSpaceIds: before.data.scopeSpaceIds ?? [] } : input;
  const result = await callApi(ctx, request, `/api/v1/core/calendar-events/${id}`, { method: "PATCH", body: eventPatch(before.data, merged) });
  return result.ok ? ({ intent, ok: true } as CalendarResult) : fail(intent, result);
}

export default function CalendarPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const canWrite = hasAny(permissions, ["DEV_PLACE"]);
  const { view, anchor, today, spaceId, events, failed, spaces } = loaderData;
  const [dialog, setDialog] = useState<{ event: CalendarEvent | null } | null>(null);
  const result = actionData as CalendarResult | undefined;
  useEffect(() => {
    if (result?.ok) setDialog(null);
  }, [result]);
  const hrefFor = (p: { view?: CalendarView; anchor?: string; spaceId?: string; shift?: number }) => {
    const v = p.view ?? view;
    const q = new URLSearchParams({ view: v, date: p.shift ? shiftAnchor(v, anchor, p.shift) : (p.anchor ?? anchor) });
    const s = p.spaceId ?? spaceId;
    if (s) q.set("spaceId", s);
    return `/calendar?${q}`;
  };
  return (
    <>
      <PageHeader title={t("calendar.title")} crumb={t("nav.spaces")} />
      <Tabs section current="calendar" items={[{ key: "spaces", label: t("nav.spaces"), to: "/spaces" }, { key: "sites", label: t("sites.title"), to: "/sites" }, { key: "calendar", label: t("calendar.title"), to: "/calendar" }]} />
      <Card>
        <CalendarToolbar view={view} anchor={anchor} today={today} spaceId={spaceId} spaces={spaces} hrefFor={hrefFor} canWrite={canWrite} onAdd={() => setDialog({ event: null })} />
        {failed && (
          <Alert tone="warning">
            {t("calendar.loadFailed")} <ButtonLink to={hrefFor({})}>{t("calendar.retry")}</ButtonLink>
          </Alert>
        )}
        {result?.ok && (
          <p role="status" className="mb-2 text-[12.5px] text-good-ink">
            {t(`calendar.done.${result.intent}`, { defaultValue: t("common.saved") })}
          </p>
        )}
        {result?.fieldErrors && Object.keys(result.fieldErrors).length > 0 && !dialog && (
          <Alert tone="danger">
            {Object.values(result.fieldErrors)
              .map((code) => t(`calendar.validation.${code}`, { defaultValue: code }))
              .join(" · ")}
          </Alert>
        )}
        {result?.error && !dialog && <Alert tone="danger">{t(`errors.${result.error.code}`, { defaultValue: result.error.message || t("errors.UNKNOWN") })}</Alert>}
        <CalendarGrid view={view} anchor={anchor} events={events} today={today} onOpen={(event) => setDialog({ event })} />
      </Card>
      <div className="mt-4">
        <ExternalCalendarLink canConnect={hasAny(permissions, ["SRC_ADMIN"])} />
      </div>
      {dialog && <EventDialog key={dialog.event?.id ?? "new"} event={dialog.event} defaultDate={anchor} spaces={spaces} canWrite={canWrite} result={result} onClose={() => setDialog(null)} />}
    </>
  );
}
