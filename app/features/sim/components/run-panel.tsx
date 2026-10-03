/**
 * UI-SIM-09 실행 제어 패널(SIM-04.02, SIM-04.03, SIM-11.02): 상태 바(상태·실제 가속·시뮬레이션 시각·실제 시각·경과·진행률),
 * 제어(일시정지·재개·정지·초기화·가속 변경, 상태별 활성), 속도 제한 띠, 실시간 차트(SSE `sim.tick` 1초),
 * 이벤트 로그(`sim.event`), 기대 결과, [장애 주입](UI-SIM-10), 끝나면 리포트 바로가기.
 */
import { useCallback, useEffect, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { TimeseriesChart } from "~/components/charts/timeseries-chart";
import { LiveBanner, useLiveStream } from "~/components/live";
import { Alert, Badge, Button, Card, SelectField, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { EventSourceLike, StreamEvent } from "~/lib/event-stream";
import { formatDateTime } from "~/lib/format";
import type { SimApi } from "../api";
import { actuatorSummary, initialRunView, runChartSeries, runReducer } from "../model/run";
import { ACCELERATION_CHOICES, FINISHED, allowedControls, formatElapsed } from "../model/sim";
import type { SimRun } from "../model/types";
import { Clocks, RunStatusBadge } from "./common";
import { FaultDialog, type FaultTarget } from "./fault-dialog";

const EVENTS = ["sim.tick", "sim.event", "sim.status", "sim.throttle"];

export interface RunPanelProps {
  run: SimRun;
  title: string;
  spaceNames: Record<string, string>;
  actuatorNames: Record<string, string>;
  targets: FaultTarget[];
  canRun: boolean;
  timezone: string;
  api: SimApi;
  now?: () => number;
  createSource?: (url: string) => EventSourceLike;
  checkSession?: () => Promise<boolean>;
  chartFactory?: ChartFactory;
}

export function RunPanel({ run, title, spaceNames, actuatorNames, targets, canRun, timezone, api, now = Date.now, createSource, checkSession, chartFactory }: RunPanelProps) {
  const { t, i18n } = useTranslation();
  const [state, dispatch] = useReducer(runReducer, run, initialRunView);
  const [wall, setWall] = useState(() => now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [faultOpen, setFaultOpen] = useState(false);
  const status = state.run.status;
  const controls = allowedControls(status);

  useEffect(() => {
    const timer = setInterval(() => setWall(now()), 1000);
    return () => clearInterval(timer);
  }, [now]);

  const onEvent = useCallback(
    (event: StreamEvent) => {
      const data = event.data as never;
      if (event.type === "sim.tick") dispatch({ type: "sim.tick", data, at: now() });
      else dispatch({ type: event.type as "sim.event", data });
    },
    [now],
  );
  const live = useLiveStream(FINISHED.includes(status) ? null : `/bff/stream/sim/runs/${encodeURIComponent(run.runId)}`, EVENTS, onEvent, { createSource, checkSession });

  const act = async (action: "pause" | "resume" | "stop" | "reset") => {
    setBusy(true);
    setError(null);
    const result = await api.control(run.runId, action);
    setBusy(false);
    if (!result.ok) setError(errorText(t, result) ?? null);
    else dispatch({ type: "patch", data: result.data });
  };

  const accelerate = async (value: number) => {
    setError(null);
    const result = await api.accelerate(run.runId, value);
    if (!result.ok) setError(errorText(t, result) ?? null);
    else dispatch({ type: "patch", data: result.data });
  };

  const series = runChartSeries(state, spaceNames, (m) => t(`sim.metric.${m}`));
  const finished = FINISHED.includes(status) || status === "EVALUATING";

  return (
    <div className="flex flex-col gap-4">
      <LiveBanner status={live} />
      <Card>
        <div className="flex flex-wrap items-center gap-3" aria-label={t("sim.run.statusBar")} role="group">
          <span className="font-semibold">{title}</span>
          <RunStatusBadge status={status} />
          <span className="font-mono text-[13px]">{t("sim.run.accelerationValue", { n: state.run.accelerationEffective })}</span>
          <Clocks simClock={state.run.simClock} now={wall} timezone={timezone} lang={i18n.language} />
          <span className="text-[12.5px]">
            <span className="text-muted">{t("sim.run.elapsed")}</span> <span className="font-mono">{formatElapsed(state.run.elapsedSec)}</span>
          </span>
          <span className="text-[12.5px]">
            <span className="text-muted">{t("sim.run.progress")}</span> <span className="font-mono">{Math.round(state.run.progressPct)}%</span>
          </span>
          <progress aria-label={t("sim.run.progress")} max={100} value={state.run.progressPct} className="h-2 w-40" />
        </div>
        {canRun && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Button onClick={() => act("pause")} disabled={busy || !controls.pause}>
              {t("sim.run.pause")}
            </Button>
            <Button onClick={() => act("resume")} disabled={busy || !controls.resume}>
              {t("sim.run.resume")}
            </Button>
            <Button onClick={() => act("stop")} disabled={busy || !controls.stop}>
              {t("sim.run.stop")}
            </Button>
            <Button onClick={() => act("reset")} disabled={busy || !controls.reset}>
              {t("sim.run.reset")}
            </Button>
            <SelectField label={t("sim.run.acceleration")} value={String(state.run.accelerationRequested)} disabled={!controls.accelerate} onChange={(e) => accelerate(Number(e.target.value))}>
              {[...new Set([...ACCELERATION_CHOICES, state.run.accelerationRequested])].sort((a, b) => a - b).map((n) => (
                <option key={n} value={n}>{`x${n}`}</option>
              ))}
            </SelectField>
            <Button onClick={() => setFaultOpen(true)} disabled={!controls.inject}>
              {t("sim.run.injectFault")}
            </Button>
          </div>
        )}
        {state.throttle && (
          <div className="mt-3">
            <Alert tone="warning">{t("sim.run.throttled", { from: state.throttle.from, to: state.throttle.to })}</Alert>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-[12.5px] text-bad">
            {error}
          </p>
        )}
        {status === "FAILED" && (
          <div className="mt-3">
            <Alert tone="danger">{t("sim.run.failed", { reason: state.run.failureReason ?? "–" })}</Alert>
          </div>
        )}
        {finished && (
          <p className="mt-3 text-[13px]">
            <Link className="text-accent hover:underline" to={`/sim/runs/${encodeURIComponent(run.runId)}/report`}>
              {t("sim.run.openReport")}
            </Link>
          </p>
        )}
      </Card>
      <Card title={t("sim.run.chart")}>
        {series.length === 0 ? <p className="text-[12.5px] text-muted">{t("sim.run.waitingTick")}</p> : <TimeseriesChart series={series} timezone={timezone} height={260} factory={chartFactory} title={t("sim.run.chart")} />}
        {Object.keys(state.actuators).length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-[12.5px]" aria-label={t("sim.run.actuators")}>
            {Object.entries(state.actuators).map(([id, s]) => (
              <li key={id}>
                <span className="font-semibold">{actuatorNames[id] ?? id}</span> <span className="font-mono text-muted">{actuatorSummary(s)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t("sim.run.log")}>
          {state.log.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("sim.run.noEvents")}</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto text-[12.5px]">
              {state.log.map((e, i) => (
                <li key={`${e.simAt}-${i}`}>
                  <span className="font-mono text-muted">{formatDateTime(e.simAt, timezone, i18n.language, true).slice(11)}</span> <Badge tone="neutral">{t(`sim.run.eventType.${e.type}`, { defaultValue: e.type })}</Badge> {e.message}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("sim.run.expectations")}>
          {(state.run.expectations ?? []).length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("sim.run.noExpectations")}</p>
          ) : (
            <Table>
              <tbody>
                {(state.run.expectations ?? []).map((x) => (
                  <tr key={x.id}>
                    <td className="font-mono">{x.id}</td>
                    <td>
                      <Badge tone={x.state === "PASSED" ? "success" : x.state === "FAILED" ? "danger" : "neutral"}>{t(`sim.expectationState.${x.state}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
      {canRun && <FaultDialog open={faultOpen} onClose={() => setFaultOpen(false)} runId={run.runId} targets={targets} api={api} />}
    </div>
  );
}
