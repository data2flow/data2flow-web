/**
 * 위젯 데이터 불러오기(API-DSH-09, NFR-01.09). 위젯마다 따로 요청해 한 위젯 오류가 다른 위젯을 막지 않는다(UI-DSH-04 "위젯 오류").
 * - 서버에서 미리 받은 데이터(SSR)는 다시 요청하지 않는다
 * - 시간 범위·집계가 바뀌면 모두, 변수가 바뀌면 그 변수를 쓰는 위젯만 다시 요청한다(TC-DSH-043)
 * - 위젯 정의(종류·대상·옵션)가 바뀐 위젯만 다시 요청한다(편집 중 배치 이동은 요청 없음)
 * - 같은 위젯의 이전 요청은 취소한다. 새로고침 주기(30s/1m/5m)는 setInterval 하나
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BffJsonResult } from "~/lib/bff-client";
import { stateFromResult } from "../model/data";
import { refreshIntervalMs } from "../model/time";
import { changedVariables, dependsOn } from "../model/variables";
import type { TimeRange, Widget, WidgetData, WidgetDataRequest, WidgetState } from "../model/types";

export type WidgetFetcher = (widgetId: string, req: WidgetDataRequest, signal: AbortSignal) => Promise<BffJsonResult<WidgetData>>;

/** 데이터가 필요 없는 위젯 */
const STATIC_TYPES = new Set(["markdown"]);


const signature = (w: Widget) => JSON.stringify([w.type, w.targets ?? [], w.options ?? {}]);

export interface DashboardDataOptions {
  widgets: Widget[];
  timeRange: TimeRange;
  resolution: string;
  values: Record<string, string>;
  fetcher: WidgetFetcher;
  initial?: Record<string, WidgetState>;
  refresh?: string;
}

export function useDashboardData({ widgets, timeRange, resolution, values, fetcher, initial, refresh = "OFF" }: DashboardDataOptions) {
  const [states, setStates] = useState<Record<string, WidgetState>>(() => initial ?? {});
  const controllers = useRef(new Map<string, AbortController>());
  const request = useRef<WidgetDataRequest>({ timeRange, resolution, variables: values });
  const fetcherRef = useRef(fetcher);
  // 아래 effect보다 먼저 돌아 최신 요청 값을 둔다
  useEffect(() => {
    request.current = { timeRange, resolution, variables: values };
    fetcherRef.current = fetcher;
  });

  const load = useCallback((ids: string[]) => {
    for (const id of ids) {
      controllers.current.get(id)?.abort();
      const controller = new AbortController();
      controllers.current.set(id, controller);
      setStates((s) => ({ ...s, [id]: { status: "loading", data: (s[id] as { data?: WidgetData | null } | undefined)?.data ?? null } }));
      fetcherRef.current(id, request.current, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          controllers.current.delete(id);
          setStates((s) => ({ ...s, [id]: stateFromResult(result) }));
        })
        .catch(() => {
          if (!controller.signal.aborted) setStates((s) => ({ ...s, [id]: { status: "error", code: "SERVICE_UNAVAILABLE" } }));
        });
    }
  }, []);

  const loadable = useCallback((list: Widget[]) => list.filter((w) => !STATIC_TYPES.has(w.type)).map((w) => w.id), []);

  const previous = useRef<{ range: string; values: Record<string, string>; signatures: Map<string, string> } | null>(null);
  const rangeKey = JSON.stringify([timeRange, resolution]);
  const valuesKey = JSON.stringify(values);
  const widgetsKey = widgets.map((w) => `${w.id}:${signature(w)}`).join("|");
  useEffect(() => {
    const signatures = new Map(widgets.map((w) => [w.id, signature(w)]));
    const prev = previous.current;
    previous.current = { range: rangeKey, values, signatures };
    if (!prev) {
      load(loadable(widgets.filter((w) => !initial?.[w.id])));
      return;
    }
    if (prev.range !== rangeKey) {
      load(loadable(widgets));
      return;
    }
    const changed = changedVariables(prev.values, values);
    const targets = widgets.filter((w) => prev.signatures.get(w.id) !== signatures.get(w.id) || (changed.length > 0 && dependsOn(w, changed)));
    if (targets.length) load(loadable(targets));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 키 문자열로 바뀐 것만 본다
  }, [rangeKey, valuesKey, widgetsKey, load, loadable]);

  useEffect(() => {
    const every = refreshIntervalMs(refresh);
    if (!every) return;
    const timer = setInterval(() => load(loadable(widgets)), every);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 위젯 목록은 키로 본다
  }, [refresh, widgetsKey, load, loadable]);

  useEffect(() => {
    const all = controllers.current;
    return () => {
      for (const c of all.values()) c.abort();
      all.clear();
    };
  }, []);

  return { states, reload: load };
}
