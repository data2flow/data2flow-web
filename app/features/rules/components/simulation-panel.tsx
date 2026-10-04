/**
 * UI-RUL-03 규칙 시뮬레이션 결과(RUL-01.11, BR-RUL-23, TC-RUL-029 AT-RUL-03.1·03.2).
 * 기간(기본 7일, 최대 30일)을 골라 API-RUL-06을 부른다. 202면 작업을 2초마다 조회하며 진행률을 보여 준다.
 * 다시 실행하면 직전 결과를 "이전" 열로 나란히 비교한다. 데이터가 기간의 10% 미만이면 안내한다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Button, Card, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { isJob, type RulesApi } from "../api";
import { firstThreshold } from "../model/condition";
import { SIM_PERIODS, compareRows, heatmapOption, lowCoverage, simulationRange, sortedDevices, validRange } from "../model/simulation";
import type { RulePayload, SimulationResult } from "../model/types";
import { EChart } from "./echart";

export const POLL_MS = 2000;

interface Run {
  result: SimulationResult;
  label: string;
}

export function formatSeconds(seconds: number | null | undefined, t: (key: string, o?: Record<string, unknown>) => string): string {
  if (seconds == null) return "–";
  if (seconds >= 3600) return t("rules.sim.hours", { n: Math.round((seconds / 3600) * 10) / 10 });
  if (seconds >= 60) return t("rules.sim.minutes", { n: Math.round(seconds / 60) });
  return t("rules.sim.seconds", { n: Math.round(seconds) });
}

export function SimulationPanel({
  api,
  payload,
  ruleId,
  now = () => Date.now(),
  chartFactory,
  autoRun = false,
}: {
  api: RulesApi;
  /** 폼 검사를 통과하면 본문, 아니면 null */
  payload: () => RulePayload | null;
  ruleId?: string;
  now?: () => number;
  chartFactory?: ChartFactory;
  autoRun?: boolean;
}) {
  const { t } = useTranslation();
  const [days, setDays] = useState(7);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [previous, setPrevious] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRef = useRef<Run | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const finish = (result: SimulationResult, label: string) => {
    setRunning(false);
    setProgress(null);
    const next = { result, label };
    setPrevious(currentRef.current);
    currentRef.current = next;
    setCurrent(next);
  };

  const poll = (jobId: string, label: string) => {
    timer.current = setTimeout(async () => {
      const job = await api.simulationJob(jobId);
      if (!alive.current) return;
      if (!job.ok) {
        setRunning(false);
        setError(errorText(t, job) ?? null);
        return;
      }
      if (job.data.status === "SUCCEEDED" && job.data.result) return finish(job.data.result, label);
      if (job.data.status === "FAILED" || job.data.status === "CANCELLED") {
        setRunning(false);
        setError(errorText(t, job.data.error ?? { code: "UNKNOWN" }) ?? null);
        return;
      }
      setProgress(job.data.progress ?? null);
      poll(jobId, label);
    }, POLL_MS);
  };

  const run = async () => {
    setError(null);
    const body = payload();
    if (!body) {
      setError(t("rules.sim.fixForm"));
      return;
    }
    const range = simulationRange(days, now());
    if (!validRange(range.from, range.to)) {
      setError(t("errors.RULE_SIMULATION_RANGE_INVALID"));
      return;
    }
    const threshold = firstThreshold(body.condition);
    const label = threshold && typeof threshold.value === "number" ? t("rules.sim.basis", { value: threshold.value }) : t("rules.sim.run");
    setRunning(true);
    const response = await api.simulate({ rule: body, ...range }, ruleId);
    if (!alive.current) return;
    if (!response.ok) {
      setRunning(false);
      setError(errorText(t, response) ?? null);
      return;
    }
    if (isJob(response.data)) {
      setProgress({ processed: 0, total: 0 });
      poll(response.data.jobId, label);
      return;
    }
    finish(response.data, label);
  };

  const ranOnce = useRef(false);
  useEffect(() => {
    if (autoRun && !ranOnce.current) {
      ranOnce.current = true;
      void run();
    }
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  const dows = useMemo(() => [1, 2, 3, 4, 5, 6, 7].map((d) => t(`rules.dow.${d}`)), [t]);
  const option = useMemo(() => (current ? heatmapOption(current.result, dows) : null), [current, dows]);

  return (
    <Card title={t("rules.sim.title", { days })}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            {t("rules.sim.period")}
            <select className="rounded-md border border-line bg-panel px-2 py-1.5 text-[13px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {SIM_PERIODS.map((d) => (
                <option key={d} value={d}>
                  {t("rules.sim.days", { n: d })}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" onClick={() => void run()} disabled={running}>
            {current ? t("rules.sim.rerun") : t("rules.sim.run")}
          </Button>
        </div>
        {running && (
          <p role="status" className="text-[13px] text-muted">
            {progress && progress.total > 0 ? t("rules.sim.progress", { processed: progress.processed, total: progress.total }) : t("rules.sim.running")}
          </p>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        {current && (
          <>
            {lowCoverage(current.result) && <Alert tone="warning">{t("rules.sim.lowCoverage")}</Alert>}
            <Table>
              <thead>
                <tr>
                  <th scope="col">{t("rules.sim.metric")}</th>
                  <th scope="col">{t("rules.sim.current", { label: current.label })}</th>
                  {previous && <th scope="col">{t("rules.sim.previous", { label: previous.label })}</th>}
                </tr>
              </thead>
              <tbody>
                {compareRows(current.result, previous?.result).map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className="text-left font-normal">
                      {t(`rules.sim.rows.${row.key}`)}
                    </th>
                    <td className="font-mono">{row.key === "avgDurationSec" ? formatSeconds(row.current, t) : (row.current ?? "–")}</td>
                    {previous && <td className="font-mono">{row.key === "avgDurationSec" ? formatSeconds(row.previous, t) : (row.previous ?? "–")}</td>}
                  </tr>
                ))}
              </tbody>
            </Table>
            <section>
              <h3 className="mb-1 text-[13px] font-semibold">{t("rules.sim.byDevice")}</h3>
              {current.result.byDevice.length === 0 ? (
                <p className="text-[13px] text-muted">{t("rules.sim.noAlarms")}</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">{t("rules.sim.device")}</th>
                      <th scope="col">{t("rules.sim.count")}</th>
                      <th scope="col">{t("rules.sim.longest")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDevices(current.result).map((d) => (
                      <tr key={d.deviceId}>
                        <td>{d.name}</td>
                        <td className="font-mono">{d.count}</td>
                        <td className="font-mono">{formatSeconds(d.longestSec, t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </section>
            {option && current.result.heatmap.length > 0 && (
              <section>
                <h3 className="mb-1 text-[13px] font-semibold">{t("rules.sim.heatmap")}</h3>
                <EChart option={option} label={t("rules.sim.heatmap")} factory={chartFactory} />
              </section>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
