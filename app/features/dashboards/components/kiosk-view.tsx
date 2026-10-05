/**
 * 키오스크 화면(UI-DSH-06, DSH-06.02): 메뉴 없는 전체 화면, 대시보드 자동 순환(하단 진행 막대, "다음: …"),
 * 오른쪽 위 시계·마지막 갱신·연결 상태, 마우스를 움직이면 3초간 [⏸][⏭][나가기].
 * 지금 보이는 대시보드 하나만 그린다(순환하면 이전 부품을 내려 차트를 dispose, TC-DSH-062).
 * 세션 유지는 startKeepAlive(4분마다 BFF 요청) — 토큰 갱신은 BFF가 서버 쪽에서 하므로 화면은 다시 불러오지 않는다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Button } from "~/components/ui";
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import { formatDateTime } from "~/lib/format";
import { dashboardsApi, keepAlivePing } from "../api";
import { CONTROLS_VISIBLE_MS, initialRotation, progressOf, skip, startKeepAlive, tick, togglePause } from "../model/kiosk";
import type { Dashboard } from "../model/types";
import { DashboardView } from "./dashboard-view";
import type { WidgetFetcher } from "./use-dashboard-data";

export interface KioskProps {
  boards: string[];
  interval: number;
  timezone: string;
  loadDashboard?: (id: string) => Promise<BffJsonResult<Dashboard>>;
  fetcher?: (dashboardId: string) => WidgetFetcher;
  ping?: () => Promise<number>;
  onExit: () => void;
  onSessionEnded: () => void;
  now?: () => number;
  chartFactory?: ChartFactory;
}

const defaultLoad = (id: string) => bffJson<Dashboard>(`/bff/api/core/dashboards/${encodeURIComponent(id)}`);
const defaultFetcher = (dashboardId: string): WidgetFetcher => (widgetId, req, signal) => dashboardsApi.widgetData(dashboardId, widgetId, req, signal);

export function KioskView({ boards, interval, timezone, loadDashboard = defaultLoad, fetcher = defaultFetcher, ping = keepAlivePing, onExit, onSessionEnded, now = Date.now, chartFactory }: KioskProps) {
  const { t, i18n } = useTranslation();
  const [rotation, setRotation] = useState(() => initialRotation(interval));
  // 지금 대시보드 정의 하나와 이름(다음 안내용)만 둔다
  const [current, setCurrent] = useState<{ id: string; value: Dashboard | "failed" } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [clock, setClock] = useState(now());
  const [updatedAt, setUpdatedAt] = useState(now());
  const [controls, setControls] = useState(false);
  const [ended, setEnded] = useState(false);
  const currentId = boards[rotation.index];

  useEffect(() => {
    const timer = setInterval(() => {
      setRotation((r) => tick(r, boards.length, interval));
      setClock(now());
    }, 1000);
    return () => clearInterval(timer);
  }, [boards.length, interval, now]);

  useEffect(
    () =>
      startKeepAlive(ping, () => {
        setEnded(true);
        onSessionEnded();
      }),
    [ping, onSessionEnded],
  );

  // 지금 대시보드 정의만 불러온다(이미 받은 것은 다시 쓰지 않고 전환 때 새로 받아 바뀐 배치를 반영)
  useEffect(() => {
    if (!currentId) return;
    let alive = true;
    void loadDashboard(currentId).then((r) => {
      if (!alive) return;
      setCurrent({ id: currentId, value: r.ok ? r.data : "failed" });
      if (r.ok) setNames((n) => ({ ...n, [currentId]: r.data.name }));
      setUpdatedAt(now());
    });
    return () => {
      alive = false;
    };
  }, [currentId, loadDashboard, now]);

  useEffect(() => {
    if (!controls) return;
    const timer = setTimeout(() => setControls(false), CONTROLS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [controls]);

  const wrappedFetcher = useCallback<WidgetFetcher>(
    async (widgetId, req, signal) => {
      const result = await fetcher(currentId)(widgetId, req, signal);
      if (result.ok) setUpdatedAt(now());
      return result;
    },
    [fetcher, currentId, now],
  );

  const shown = current && current.id === currentId ? current.value : undefined;
  const nextId = boards[(rotation.index + 1) % Math.max(1, boards.length)];
  const nextName = names[nextId] ?? `#${nextId}`;

  if (ended) {
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
        <p className="text-[18px] font-semibold">{t("dashboards.kiosk.sessionEnded")}</p>
        <Button variant="primary" onClick={onExit}>
          {t("dashboards.kiosk.login")}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-bg p-3" onMouseMove={() => setControls(true)} data-testid="kiosk">
      <div className="absolute right-3 top-2 z-20 flex items-center gap-2 text-[12px] text-muted">
        <span aria-label={t("dashboards.kiosk.clock")} className="font-mono text-text">
          {formatDateTime(new Date(clock).toISOString(), timezone, i18n.language)}
        </span>
        <span>· {t("dashboards.kiosk.updated", { s: Math.max(0, Math.round((clock - updatedAt) / 1000)) })}</span>
      </div>
      {controls && (
        <div className="absolute left-3 top-2 z-30 flex gap-2" role="toolbar" aria-label={t("dashboards.kiosk.controls")}>
          <Button onClick={() => setRotation(togglePause)} aria-label={rotation.paused ? t("dashboards.kiosk.resume") : t("dashboards.kiosk.pause")}>
            {rotation.paused ? "▶" : "⏸"}
          </Button>
          <Button onClick={() => setRotation((r) => skip(r, boards.length, interval))} aria-label={t("dashboards.kiosk.next")}>
            ⏭
          </Button>
          <Button
            onClick={() => {
              void document.documentElement.requestFullscreen?.().catch(() => undefined);
            }}
          >
            {t("dashboards.widget.fullscreen")}
          </Button>
          <Button onClick={onExit}>{t("dashboards.kiosk.exit")}</Button>
        </div>
      )}
      <h1 className="mb-2 pr-48 text-[16px] font-semibold">{shown && shown !== "failed" ? shown.name : ""}</h1>
      {shown === "failed" && <p className="text-[13px] text-bad-ink">▲ {t("dashboards.kiosk.loadFailed")}</p>}
      {shown && shown !== "failed" && (
        <DashboardView
          key={shown.id}
          name={shown.name}
          widgets={shown.layout?.widgets ?? []}
          variables={shown.variables ?? []}
          timeRange={shown.timeRange}
          resolution={shown.resolution}
          refresh={shown.refresh}
          fetcher={wrappedFetcher}
          timezone={timezone}
          hideToolbar
          noExport
          chartFactory={chartFactory}
        />
      )}
      {boards.length > 1 && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-panel/90 px-3 py-1 text-[12px] text-muted">
          <div className="h-1 w-full bg-line" aria-hidden>
            <div className="h-1 bg-accent" style={{ width: `${Math.round(progressOf(rotation, interval) * 100)}%` }} />
          </div>
          <p role="status">{t("dashboards.kiosk.nextUp", { name: nextName, s: rotation.remaining })}</p>
        </div>
      )}
    </div>
  );
}
