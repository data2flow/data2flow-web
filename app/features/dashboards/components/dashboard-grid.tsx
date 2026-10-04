/**
 * 대시보드 격자(UI-DSH-04): 24열·한 줄 40px. 보기 모드는 위젯 메뉴(데이터 표로 보기·PNG·CSV·전체 화면),
 * 편집 모드는 끌어 놓기(머리글 잡고 이동)·크기 조정(오른쪽 아래 손잡이)·복제·삭제와 키보드 대체 조작
 * (화살표 이동, Shift+화살표 크기, Delete 삭제)을 둔다(DSH-04.01, TC-DSH-031·100). 모바일 폭에서는 1열로 쌓는다.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Button, cx } from "~/components/ui";
import { downloadDataUrl, downloadText, nodeToPng } from "~/lib/download";
import { exportFileName, toCsv, widgetTable, type TableLabels } from "../model/data";
import { COLUMNS, ROW_HEIGHT, duplicateWidget, keyboardDelta, moveWidget, pixelsToCells, readingOrder, removeWidget, resizeWidget } from "../model/layout";
import type { ZoomWindow } from "../model/time";
import type { Widget, WidgetState } from "../model/types";
import { WidgetBody } from "./widget-body";

const GAP = 12;
const HEADER = 40;

export function widgetPixelHeight(h: number): number {
  return h * ROW_HEIGHT + (h - 1) * GAP;
}

export function useTableLabels(): TableLabels {
  const { t } = useTranslation();
  const k = (key: string) => t(`dashboards.table.columns.${key}`);
  return {
    time: k("time"),
    value: k("value"),
    unit: k("unit"),
    name: k("name"),
    connection: k("connection"),
    battery: k("battery"),
    rssi: k("rssi"),
    alarms: k("alarms"),
    severity: k("severity"),
    title: k("title"),
    state: k("state"),
    device: k("device"),
    x: "x",
    y: "y",
    min: k("min"),
    max: k("max"),
    content: k("content"),
  };
}

export interface GridProps {
  widgets: Widget[];
  states: Record<string, WidgetState>;
  timezone: string;
  /** 편집 모드: 배치를 바꾸면 새 위젯 목록을 알린다 */
  editing?: boolean;
  onChange?: (widgets: Widget[]) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  zoom?: ZoomWindow | null;
  onZoom?: (window: ZoomWindow) => void;
  /** 내보내기 메뉴(PNG·CSV)를 숨긴다(공유 링크, UI-DSH-07) */
  noExport?: boolean;
  dashboardName?: string;
  chartFactory?: ChartFactory;
  onRetry?: (widgetId: string) => void;
}

interface DragState {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  origin: Widget;
  preview: Widget[] | null;
}

export function DashboardGrid({ widgets, states, timezone, editing, onChange, selectedId, onSelect, zoom, onZoom, noExport, dashboardName = "", chartFactory, onRetry }: GridProps) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announce, setAnnounce] = useState("");
  const shown = drag?.preview ?? widgets;

  useEffect(() => {
    if (!drag) return;
    const cellWidth = ((container.current?.clientWidth || 960) + GAP) / COLUMNS;
    const onMove = (e: PointerEvent) => {
      const cells = pixelsToCells(e.clientX - drag.startX, e.clientY - drag.startY, cellWidth, ROW_HEIGHT + GAP);
      const next =
        drag.mode === "move"
          ? moveWidget(widgets, drag.id, drag.origin.x + cells.dx, drag.origin.y + cells.dy)
          : resizeWidget(widgets, drag.id, drag.origin.w + cells.dx, drag.origin.h + cells.dy);
      if (next) setDrag((d) => (d ? { ...d, preview: next } : d));
    };
    const onUp = () => {
      if (drag.preview) onChange?.(drag.preview);
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, widgets, onChange]);

  const begin = (w: Widget, mode: DragState["mode"]) => (e: ReactPointerEvent) => {
    if (!editing) return;
    e.preventDefault();
    onSelect?.(w.id);
    setDrag({ id: w.id, mode, startX: e.clientX, startY: e.clientY, origin: w, preview: null });
  };

  const onKey = (w: Widget) => (e: KeyboardEvent) => {
    if (!editing || e.target !== e.currentTarget) return;
    if (e.key === "Delete") {
      e.preventDefault();
      onChange?.(removeWidget(widgets, w.id));
      setAnnounce(t("dashboards.edit.removed", { title: w.title || w.id }));
      return;
    }
    const delta = keyboardDelta(e.key, e.shiftKey);
    if (!delta) return;
    e.preventDefault();
    const next = delta.dw || delta.dh ? resizeWidget(widgets, w.id, w.w + delta.dw, w.h + delta.dh) : moveWidget(widgets, w.id, w.x + delta.dx, w.y + delta.dy);
    if (next) {
      onChange?.(next);
      const moved = next.find((x) => x.id === w.id) as Widget;
      setAnnounce(t("dashboards.edit.position", { x: moved.x, y: moved.y, w: moved.w, h: moved.h }));
    } else setAnnounce(t("dashboards.edit.blocked"));
  };

  return (
    <>
      <div ref={container} data-testid="dashboard-grid" className={cx("grid grid-cols-1 gap-3 md:auto-rows-[40px] md:grid-cols-24", editing && "min-h-40 rounded-md p-1 outline-dashed outline-1 outline-line")}>
        {readingOrder(shown).map((w) => (
          <WidgetFrame
            key={w.id}
            widget={w}
            state={states[w.id]}
            timezone={timezone}
            editing={editing}
            selected={selectedId === w.id}
            dragging={drag?.id === w.id}
            onSelect={() => onSelect?.(w.id)}
            onKeyDown={onKey(w)}
            onMoveStart={begin(w, "move")}
            onResizeStart={begin(w, "resize")}
            onDuplicate={() => {
              const next = duplicateWidget(widgets, w.id);
              if (next) onChange?.(next);
              else setAnnounce(t("dashboards.errors.tooMany"));
            }}
            onRemove={() => onChange?.(removeWidget(widgets, w.id))}
            zoom={zoom}
            onZoom={onZoom}
            noExport={noExport}
            dashboardName={dashboardName}
            chartFactory={chartFactory}
            onRetry={onRetry}
          />
        ))}
      </div>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </>
  );
}

interface FrameProps {
  widget: Widget;
  state: WidgetState | undefined;
  timezone: string;
  editing?: boolean;
  selected?: boolean;
  dragging?: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onMoveStart: (e: ReactPointerEvent) => void;
  onResizeStart: (e: ReactPointerEvent) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  zoom?: ZoomWindow | null;
  onZoom?: (window: ZoomWindow) => void;
  noExport?: boolean;
  dashboardName: string;
  chartFactory?: ChartFactory;
  onRetry?: (widgetId: string) => void;
}

function WidgetFrame(props: FrameProps) {
  const { widget: w, state, timezone, editing, selected, dragging } = props;
  const { t, i18n } = useTranslation();
  const labels = useTableLabels();
  const frame = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [full, setFull] = useState(false);
  const title = w.title || t(`dashboards.types.${w.type}`, { defaultValue: w.type });
  const data = state && "data" in state ? state.data : null;
  const table = widgetTable(w, data, labels, timezone, i18n.language);
  const pixelHeight = widgetPixelHeight(w.h);
  const style = { "--gc": `${w.x + 1} / span ${w.w}`, "--gr": `${w.y + 1} / span ${w.h}`, "--wh": `${pixelHeight}px` } as CSSProperties;
  const bodyHeight = full ? 480 : Math.max(80, pixelHeight - HEADER - 16);

  const exportCsv = () => {
    downloadText(toCsv(table), exportFileName(`${props.dashboardName}_${title}`, "csv"));
    setMenu(false);
  };
  const exportPng = async () => {
    setMenu(false);
    if (!frame.current) return;
    const background = getComputedStyle(document.documentElement).getPropertyValue("--d2f-panel").trim() || "#ffffff";
    try {
      downloadDataUrl(await nodeToPng(frame.current, background), exportFileName(`${props.dashboardName}_${title}`, "png"));
    } catch {
      // 그리기 실패는 조용히 넘긴다(브라우저 제한)
    }
  };

  let body: ReactNode;
  if (!state || state.status === "idle" || (state.status === "loading" && !state.data)) {
    body = w.type === "markdown" ? <WidgetBody widget={w} data={{ type: "markdown", data: null }} timezone={timezone} height={bodyHeight} tableOpen={false} table={table} /> : <div className="h-full animate-pulse rounded bg-bg" role="status" aria-label={t("dashboards.widget.loading")} />;
  } else if (state.status === "forbidden") {
    body = <p className="flex h-full items-center justify-center rounded bg-bg text-[13px] text-muted">🔒 {t("dashboards.widget.forbidden")}</p>;
  } else if (state.status === "error") {
    body = (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-bad">
        <span>▲ {t("dashboards.widget.error", { code: state.code })}</span>
        {props.onRetry && (
          <Button onClick={() => props.onRetry?.(w.id)} className="no-export">
            {t("dashboards.widget.retry")}
          </Button>
        )}
      </div>
    );
  } else {
    body = <WidgetBody widget={w} data={state.data as NonNullable<typeof state.data>} timezone={timezone} height={bodyHeight} zoom={props.zoom} onZoom={props.onZoom} tableOpen={tableOpen} table={table} chartFactory={props.chartFactory} loading={state.status === "loading"} />;
  }

  return (
    <section
      ref={frame}
      aria-label={title}
      data-widget-id={w.id}
      tabIndex={editing ? 0 : undefined}
      onKeyDown={props.onKeyDown}
      onClick={editing ? props.onSelect : undefined}
      style={style}
      className={cx(
        "relative flex min-w-0 flex-col rounded-lg border bg-panel p-2 h-[var(--wh)] md:h-auto md:[grid-column:var(--gc)] md:[grid-row:var(--gr)]",
        full && "fixed inset-4 z-40 h-auto overflow-auto shadow-xl md:[grid-column:auto] md:[grid-row:auto]",
        selected ? "border-accent ring-2 ring-accent/30" : "border-line",
        dragging && "opacity-80",
      )}
    >
      <header className={cx("flex h-8 items-center justify-between gap-2", editing && "cursor-move touch-none")} onPointerDown={editing ? props.onMoveStart : undefined}>
        <h3 className="truncate text-[13px] font-semibold">{title}</h3>
        <div className="no-export relative flex items-center gap-1">
          {editing ? (
            <>
              <Button variant="ghost" onPointerDown={(e) => e.stopPropagation()} onClick={props.onDuplicate} aria-label={t("dashboards.edit.duplicate", { title })}>
                ⧉
              </Button>
              <Button variant="ghost" onPointerDown={(e) => e.stopPropagation()} onClick={props.onRemove} aria-label={t("dashboards.edit.remove", { title })}>
                ✕
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" aria-haspopup="menu" aria-expanded={menu} aria-label={t("dashboards.widget.menu", { title })} onClick={() => setMenu((m) => !m)}>
                ⋯
              </Button>
              {menu && (
                <div role="menu" className="absolute right-0 top-8 z-30 flex w-40 flex-col rounded-md border border-line bg-panel p-1 text-[13px] shadow">
                  <button
                    role="menuitem"
                    type="button"
                    className="rounded px-2 py-1 text-left hover:bg-bg"
                    onClick={() => {
                      setTableOpen((v) => !v);
                      setMenu(false);
                    }}
                  >
                    {tableOpen ? t("dashboards.widget.hideTable") : t("dashboards.widget.showTable")}
                  </button>
                  {!props.noExport && (
                    <>
                      <button role="menuitem" type="button" className="rounded px-2 py-1 text-left hover:bg-bg" onClick={exportPng}>
                        PNG
                      </button>
                      <button role="menuitem" type="button" className="rounded px-2 py-1 text-left hover:bg-bg" onClick={exportCsv}>
                        CSV
                      </button>
                    </>
                  )}
                  <button
                    role="menuitem"
                    type="button"
                    className="rounded px-2 py-1 text-left hover:bg-bg"
                    onClick={() => {
                      setFull((v) => !v);
                      setMenu(false);
                    }}
                  >
                    {full ? t("dashboards.widget.exitFullscreen") : t("dashboards.widget.fullscreen")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      {editing && (
        <span
          role="presentation"
          data-testid={`resize-${w.id}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            props.onResizeStart(e);
          }}
          className="no-export absolute bottom-0.5 right-0.5 h-3 w-3 cursor-se-resize touch-none border-b-2 border-r-2 border-muted"
        />
      )}
    </section>
  );
}
