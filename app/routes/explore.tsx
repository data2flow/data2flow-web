/**
 * UI-TSD-01 데이터 탐색기 `/explore?q=…` (TSD-03.01·03.04·03.05, TSD-01.04·01.05, DSH-05.02·05.03). 조회 V+, [주석 추가] O+(DEV_PLACE).
 * API: 시계열 API-TSD-02(단일 기기)·API-TSD-04(그 외), 주석 API-TSD-06·07, 공간 API-DEV-01, 실시간 API-DSH-20 `telemetry:{기기}.{항목}`.
 * M5: 여러 항목 비교·정규화 보기(TSD-03.03), [내보내기] 대화상자(TSD-04.01, TS_EXPORT, API-TSD-20).
 */
import { data, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { ExploreView } from "~/features/explore/components/explore-view";
import { annotationTargets, buildTelemetryRequest, mergeAnnotations, toChartSeries, type ApiAnnotation, type TelemetryResult } from "~/features/explore/model/query";
import { decodeState, encodeState, stateFromShortcut, type ExploreState } from "~/features/explore/model/state";
import { checkRange, localToUtc, resolveRange } from "~/features/explore/model/time";
import type { ExploreActionResult, ExploreData } from "~/features/explore/model/types";
import { loadTemperatureUnit } from "~/features/devmodel/units.server";
import { resolveTimezone } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import type { Route } from "./+types/explore";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs): Promise<ExploreData> {
  const ctx = bff(context);
  const url = new URL(request.url);
  const me = await getMe(ctx, request);
  const timezone = resolveTimezone(me.ok ? me.data.timezone : undefined);
  const permissions = me.ok ? me.data.permissions : [];
  const state: ExploreState = url.searchParams.has("q") ? decodeState(url.searchParams.get("q")) : (stateFromShortcut(url.searchParams) ?? decodeState(null));
  const now = ctx.runtime.now();
  const range = resolveRange(state, now);
  const problem = state.series.length ? checkRange(state, now) : undefined;

  const spacesCall = callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces");
  const unitCall = loadTemperatureUnit(ctx, request);
  const base: Omit<ExploreData, "series" | "annotations"> = { state, range, problem, spaces: [], canAnnotate: permissions.includes("DEV_PLACE"), canExport: permissions.includes("TS_EXPORT"), timezone, meId: me.ok ? String(me.data.id) : undefined };

  const telemetry = buildTelemetryRequest(state, range, timezone);
  let result: TelemetryResult | undefined;
  let failure: ExploreData["failure"];
  if (!problem && telemetry.kind !== "none") {
    const response =
      telemetry.kind === "series"
        ? await callApi<TelemetryResult>(ctx, request, telemetry.path)
        : await callApi<TelemetryResult>(ctx, request, telemetry.path, { method: "POST", body: telemetry.body });
    if (response.ok) result = response.data;
    else failure = { code: response.code, message: response.message, retryAfter: response.retryAfter };
  }

  const types = state.annotations.join(",");
  const annotationLists = state.annotations.length
    ? await Promise.all(
        annotationTargets(state).map(async (target) => {
          const list = await callList<ApiAnnotation>(ctx, request, `/api/v1/core/annotations?${new URLSearchParams({ [target.param]: target.id, from: range.from, to: range.to, types })}`);
          return list.ok ? list.list.responses : [];
        }),
      )
    : [];
  const spaces = await spacesCall;
  return {
    ...base,
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    result: result ? { resolutionUsed: result.resolutionUsed, reason: result.reason, truncated: result.truncated } : undefined,
    series: problem ? [] : toChartSeries(telemetry, failure ? { series: [] } : result),
    annotations: mergeAnnotations(annotationLists, state.annotations),
    failure,
    temperatureUnit: await unitCall,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "delete-annotation") {
    const result = await callApi(ctx, request, `/api/v1/core/annotations/${encodeURIComponent(field(form, "id"))}`, { method: "DELETE" });
    return result.ok ? ({ intent, ok: true } as ExploreActionResult) : data({ intent, error: { code: result.code, message: result.message } } as ExploreActionResult, { status: result.status });
  }
  if (intent !== "annotate") return data({ intent, error: { code: "INVALID_REQUEST" } } as ExploreActionResult, { status: 400 });
  const title = field(form, "title").trim();
  if (title.length < 1 || title.length > 200) return data({ intent, fieldError: "title" } as ExploreActionResult, { status: 400 });
  const timezone = resolveTimezone(field(form, "timezone"));
  const timeFrom = localToUtc(field(form, "timeFrom"), timezone);
  const rawTo = field(form, "timeTo");
  const timeTo = rawTo ? localToUtc(rawTo, timezone) : undefined;
  if (!timeFrom || (rawTo && (!timeTo || Date.parse(timeTo) <= Date.parse(timeFrom)))) return data({ intent, fieldError: "time" } as ExploreActionResult, { status: 400 });
  const [kind, id] = field(form, "target").split(":");
  const target = kind === "space" ? { spaceId: id } : kind === "device" ? { deviceId: id } : {};
  const result = await callApi(ctx, request, "/api/v1/core/annotations", { method: "POST", body: { timeFrom, ...(timeTo ? { timeTo } : {}), ...target, title } });
  return result.ok ? ({ intent, ok: true } as ExploreActionResult) : data({ intent, error: { code: result.code, message: result.message } } as ExploreActionResult, { status: result.status });
}

export default function Explore() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ExploreActionResult | undefined;
  const navigation = useNavigation();
  const [, setParams] = useSearchParams();
  return <ExploreView data={loaderData} actionResult={actionData} loading={navigation.state === "loading"} onNavigate={(state) => setParams({ q: encodeState(state) })} />;
}
