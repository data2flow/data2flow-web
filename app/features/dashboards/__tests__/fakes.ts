/** 대시보드 부품 시험 도우미: 가짜 ECharts 손잡이(이벤트·옵션 기록), 위젯 데이터 응답, 가짜 EventSource */
import { vi } from "vitest";
import type { ChartFactory, ChartHandle } from "~/components/charts/timeseries-chart";
import type { BffJsonResult } from "~/lib/bff-client";
import type { EventSourceLike } from "~/lib/event-stream";
import type { Widget, WidgetData, WidgetDataRequest } from "../model/types";

export interface FakeChart extends ChartHandle {
  options: Record<string, unknown>[];
  handlers: Record<string, (e: unknown) => void>;
  actions: Record<string, unknown>[];
  disposed: boolean;
}

export function chartFactory() {
  const charts: FakeChart[] = [];
  const factory: ChartFactory = async () => {
    const chart: FakeChart = {
      options: [],
      handlers: {},
      actions: [],
      disposed: false,
      setOption: (o) => chart.options.push(o),
      resize: () => undefined,
      dispose: () => {
        chart.disposed = true;
      },
      on: (event, handler) => {
        chart.handlers[event] = handler;
      },
      dispatchAction: (a) => chart.actions.push(a),
    };
    charts.push(chart);
    return chart;
  };
  return { factory, charts };
}

export function payloadFor(widget: Pick<Widget, "type">, req: WidgetDataRequest): WidgetData {
  const space = req.variables?.space ?? "31";
  switch (widget.type) {
    case "line":
      return { type: "line", data: { series: [{ key: "a", label: "CO2", unit: "ppm", points: [["2026-10-04T00:00:00Z", 1000, 0]] }], annotations: [] } };
    case "gauge":
      return { type: "gauge", data: { value: 48, unit: "%", min: 0, max: 100 } };
    case "status-list":
      return { type: "status-list", data: { items: [{ deviceId: "1", name: "센서 A", connection: "OFFLINE", battery: 12.4, alarms: 2 }] } };
    case "alarm-list":
      return { type: "alarm-list", data: { items: [{ alarmId: "9", severity: "CRITICAL", title: `알람 ${space}`, state: "ACTIVE", at: "2026-10-04T00:00:00Z" }] } };
    case "table":
      return { type: "table", data: { columns: ["대상", "값"], rows: [["CO2", 1150]] } };
    case "heatmap":
      return { type: "heatmap", data: { xLabels: ["0"], yLabels: ["월"], values: [[1]] } };
    case "bar":
      return { type: "bar", data: { series: [{ key: "a", label: "A", points: [["t", 3, 0]] }] } };
    case "floorplan":
      return { type: "floorplan", data: { imageUrl: "/api/v1/core/spaces/31/floorplan", width: 800, height: 600, markers: [{ deviceId: "1", x: 0.5, y: 0.5, value: 24, unit: "℃", state: "ALARM" }] } };
    default:
      return { type: "stat", data: { value: space === "32" ? 640 : 1150, unit: "ppm", at: "2026-10-04T00:00:00Z", previous: 1100 } };
  }
}

/** 위젯 정의를 알고 응답하는 가짜 fetcher. 요청을 기록한다 */
export function fakeFetcher(widgets: Widget[], override?: (id: string) => BffJsonResult<WidgetData> | undefined) {
  const calls: { id: string; req: WidgetDataRequest }[] = [];
  const fetcher = vi.fn(async (id: string, req: WidgetDataRequest) => {
    calls.push({ id, req });
    const custom = override?.(id);
    if (custom) return custom;
    const widget = widgets.find((w) => w.id === id) ?? { type: "stat" };
    return { ok: true as const, status: 200, data: payloadFor(widget, req) };
  });
  return { fetcher, calls };
}

export class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent);
  }
}

export const liveOptions = { createSource: (url: string) => new FakeES(url), checkSession: async () => true };
