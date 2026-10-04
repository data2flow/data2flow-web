/**
 * 평면도 보기(UI-DSH-02 평면도 탭, DSH-02.02·02.03·12.04): 평면도 이미지 위 기기 마커(현재값 라벨 + 상태 색·기호),
 * 마커를 누르면 기기 요약 팝업(현재값 전체, [기기 상세]). 값은 `space:{id}` 실시간 `device-update`로 3초 안에 바뀐다.
 * [히트 컬러]를 켜면 고른 측정 항목의 IDW 보간 그라데이션과 색 범례(최저~최고), "보간 추정" 문구(BR-DSH-05).
 * 확대·이동: [+]/[−]/[원래대로] 버튼과 끌기. 층을 바꾸면 부모가 key를 바꿔 확대 상태를 초기화한다(TC-DSH-109).
 */
import { useCallback, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Button, Card, EmptyState, SelectField, cx } from "~/components/ui";
import { browserImageUrl } from "~/features/spaces/model/space-forms";
import { applyDeviceUpdate, type DeviceUpdate, type OverviewDevice } from "~/features/spaces/model/live-devices";
import { liveUrl } from "~/lib/event-stream";
import { formatNumber, formatRelative } from "~/lib/format";
import { heatColor, idwGrid, legendGradient } from "../model/idw";
import { MARKER_LOOK, heatMetricOptions, heatPoints, liveMarkers, type DeviceAlarmSummary, type LiveMarker, type PlanMarker } from "../model/markers";

export interface FloorplanLiveView {
  imageUrl?: string | null;
  width?: number | null;
  height?: number | null;
  markers?: PlanMarker[];
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;
const HEAT_COLS = 40;

const TONE_CLASS: Record<string, string> = {
  bad: "border-bad bg-bad-soft text-bad",
  warn: "border-warn bg-warn-soft text-warn",
  good: "border-good bg-good-soft text-good",
  muted: "border-line bg-panel text-muted",
};

export function FloorplanLive({
  spaceId,
  view,
  devices: initial,
  alarms,
  now,
  lang,
  toolbar,
  emptyAction,
  streamOptions,
}: {
  spaceId: string;
  view: FloorplanLiveView | null;
  devices: OverviewDevice[];
  alarms?: DeviceAlarmSummary[];
  now: number;
  lang: string;
  toolbar?: ReactNode;
  emptyAction?: ReactNode;
  streamOptions?: UseLiveStreamOptions;
}) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [heatOn, setHeatOn] = useState(false);
  const markers = useMemo(() => liveMarkers(view?.markers, devices, alarms), [view?.markers, devices, alarms]);
  const options = useMemo(() => heatMetricOptions(markers), [markers]);
  const [heatMetric, setHeatMetric] = useState<string>("");
  const metric = options.some((o) => o.key === heatMetric) ? heatMetric : (options[0]?.key ?? "");
  const onEvent = useCallback((event: { data: unknown }) => setDevices((current) => applyDeviceUpdate(current, event.data as DeviceUpdate)), []);
  const status = useLiveStream(view?.imageUrl && markers.length ? liveUrl([`space:${spaceId}`]) : null, ["device-update"], onEvent, streamOptions);

  if (!view?.imageUrl) {
    return (
      <Card>
        {toolbar}
        <EmptyState title={t("floor.view.empty")} action={emptyAction} />
      </Card>
    );
  }
  const current = markers.find((m) => m.deviceId === selected) ?? null;
  return (
    <Card
      title={t("floor.view.title")}
      actions={
        <div className="flex flex-wrap items-end gap-2">
          <LiveDot status={status} />
          <Button aria-pressed={heatOn} onClick={() => setHeatOn((v) => !v)} disabled={options.length === 0}>
            {t("floor.heat.toggle")}
          </Button>
          {heatOn && options.length > 0 && (
            <SelectField label={t("floor.heat.metric")} value={metric} onChange={(e) => setHeatMetric(e.target.value)}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.key}
                </option>
              ))}
            </SelectField>
          )}
        </div>
      }
    >
      <LiveBanner status={status} />
      {toolbar}
      <ZoomPan aspect={view.width && view.height ? view.width / view.height : 1.5}>
        <img src={browserImageUrl(view.imageUrl) ?? undefined} alt={t("spaces.floorplan.alt")} className="block w-full select-none" draggable={false} />
        {heatOn && metric && <HeatLayer markers={markers} metric={metric} aspect={view.width && view.height ? view.width / view.height : 1.5} />}
        {markers.map((m) => (
          <MarkerChip key={m.deviceId} marker={m} lang={lang} selected={selected === m.deviceId} onSelect={() => setSelected((s) => (s === m.deviceId ? null : m.deviceId))} />
        ))}
      </ZoomPan>
      {heatOn && metric && <HeatLegend markers={markers} metric={metric} unit={options.find((o) => o.key === metric)?.unit} lang={lang} />}
      {markers.length === 0 && <p className="mt-2 text-[12.5px] text-muted">{t("floor.view.noMarkers")}</p>}
      {current && <MarkerPopup marker={current} lang={lang} now={now} onClose={() => setSelected(null)} />}
      <p className="sr-only">{t("floor.view.legend")}</p>
    </Card>
  );
}

function MarkerChip({ marker, lang, selected, onSelect }: { marker: LiveMarker; lang: string; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const look = MARKER_LOOK[marker.state];
  const first = marker.metrics[0];
  const stateText = t(`floor.state.${marker.state}`);
  return (
    <button
      type="button"
      data-marker={marker.deviceId}
      data-state={marker.state}
      aria-expanded={selected}
      aria-label={t("floor.view.markerLabel", { name: marker.name, state: stateText })}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={cx("absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11.5px] shadow", TONE_CLASS[look.tone])}
      style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
    >
      <span aria-hidden>{look.icon} </span>
      <span className="font-mono" data-metric={first ? `${marker.deviceId}.${first.key}` : undefined}>
        {first ? formatNumber(first.value, lang, { unit: first.unit }) : marker.name}
      </span>
    </button>
  );
}

function MarkerPopup({ marker, lang, now, onClose }: { marker: LiveMarker; lang: string; now: number; onClose: () => void }) {
  const { t } = useTranslation();
  const look = MARKER_LOOK[marker.state];
  return (
    <section role="dialog" aria-label={t("floor.popup.title", { name: marker.name })} className="mt-3 rounded-md border border-line bg-panel p-3 text-[13px]">
      <header className="mb-2 flex items-center justify-between gap-2">
        <strong>{marker.name}</strong>
        <span className={cx("rounded border px-1.5 text-[12px]", TONE_CLASS[look.tone])}>
          <span aria-hidden>{look.icon} </span>
          {t(`floor.state.${marker.state}`)}
          {marker.alarmSeverity ? ` · ${marker.alarmSeverity}` : ""}
        </span>
      </header>
      {marker.metrics.length === 0 ? (
        <p className="text-muted">{t("floor.popup.noValues")}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {marker.metrics.map((m) => (
            <div key={m.key}>
              <dt className="text-[11px] text-muted">{m.key}</dt>
              <dd className="font-mono">{formatNumber(m.value, lang, { unit: m.unit })}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-[12px] text-muted">{t("spaces.overview.lastSeen", { at: formatRelative(marker.lastSeenAt, now, lang) })}</p>
      <div className="mt-2 flex gap-2">
        <Link to={`/devices/${encodeURIComponent(marker.deviceId)}`} className="text-accent underline">
          {t("floor.popup.openDevice")}
        </Link>
        <Button onClick={onClose}>{t("floor.popup.close")}</Button>
      </div>
    </section>
  );
}

function HeatLayer({ markers, metric, aspect }: { markers: LiveMarker[]; metric: string; aspect: number }) {
  const rows = Math.max(10, Math.min(60, Math.round(HEAT_COLS / aspect)));
  const grid = idwGrid(heatPoints(markers, metric), HEAT_COLS, rows, { aspect });
  if (!grid) return null;
  return (
    <svg data-testid="heat-layer" aria-hidden viewBox={`0 0 ${grid.cols} ${grid.rows}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full opacity-55">
      {grid.cells.map((c) => (
        <rect key={`${c.col}-${c.row}`} x={c.col} y={c.row} width={1.02} height={1.02} fill={heatColor(c.value, grid.min, grid.max)} />
      ))}
    </svg>
  );
}

function HeatLegend({ markers, metric, unit, lang }: { markers: LiveMarker[]; metric: string; unit?: string | null; lang: string }) {
  const { t } = useTranslation();
  const values = heatPoints(markers, metric).map((p) => p.value);
  if (values.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]" aria-label={t("floor.heat.legend")} role="group">
      <span className="font-mono">{formatNumber(Math.min(...values), lang, { unit })}</span>
      <span aria-hidden className="inline-block h-2.5 w-40 rounded" style={{ background: legendGradient() }} />
      <span className="font-mono">{formatNumber(Math.max(...values), lang, { unit })}</span>
      <span className="text-muted">{t("floor.heat.estimated")}</span>
    </div>
  );
}

/** 확대(1~4배)·끌어 이동. 끌기는 확대했을 때만 */
export function ZoomPan({ aspect, children }: { aspect: number; children: ReactNode }) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const zoom = (next: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    setScale(clamped);
    if (clamped === ZOOM_MIN) setOffset({ x: 0, y: 0 });
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (scale === ZOOM_MIN) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setOffset({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y });
  };
  const onUp = () => {
    drag.current = null;
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-1" role="group" aria-label={t("floor.zoom.label")}>
        <Button onClick={() => zoom(scale + ZOOM_STEP)} disabled={scale >= ZOOM_MAX} aria-label={t("floor.zoom.in")}>
          +
        </Button>
        <Button onClick={() => zoom(scale - ZOOM_STEP)} disabled={scale <= ZOOM_MIN} aria-label={t("floor.zoom.out")}>
          −
        </Button>
        <Button onClick={() => zoom(ZOOM_MIN)} disabled={scale === ZOOM_MIN}>
          {t("floor.zoom.reset")}
        </Button>
        <span className="font-mono text-[12px] text-muted" data-testid="zoom-level">{`${Math.round(scale * 100)}%`}</span>
      </div>
      <div
        className={cx("relative overflow-hidden rounded border border-line", scale > ZOOM_MIN && "cursor-grab touch-none")}
        style={{ aspectRatio: String(aspect) }}
        data-testid="floorplan-viewport"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        <div className="relative origin-center" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} data-testid="floorplan-canvas">
          {children}
        </div>
      </div>
    </div>
  );
}
