/**
 * 운영 탭(UI-SCR-05): 지표(SCR-03.05, API-SCR-12) — 기간 1시간·24시간·7일, 처리·오류·평균·p95 차트(배포 시점 세로선), 버전별 합계,
 * 경고 배지(오류율, 성능 p95 > 20ms와 원인 후보, SCR-05.03), 오류 스냅샷 최근 100건(SCR-05.01, API-SCR-13)과 [이 입력으로 테스트],
 * 운영 로그 수집 켜기·남은 시간·자동 꺼짐(SCR-05.02, API-SCR-14).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Badge, Button, Card, EmptyState, SelectField, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { ErrorSnapshot, LogLine, ScriptOpsApi } from "./m5-api";
import { KNOWN_HINTS, asPercent, STATS_PERIODS, effectiveWarnings, formatRemaining, remainingSeconds, statsByVersion, statsRange, statsSeries, type ScriptStats, type StatsPeriod } from "./model/m5";

export interface ScriptOpsProps {
  scriptId: string;
  canWrite: boolean;
  logCaptureUntil?: string | null;
  timezone: string;
  api: Pick<ScriptOpsApi, "stats" | "errors" | "logCapture" | "logs">;
  /** [이 입력으로 테스트]: 편집기 테스트 패널에 입력을 채운다 */
  onTestWithInput: (input: unknown) => void;
  now?: () => number;
  chartFactory?: ChartFactory;
}

export function ScriptOps({ scriptId, canWrite, logCaptureUntil, timezone, api, onTestWithInput, now = Date.now, chartFactory }: ScriptOpsProps) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<StatsPeriod>("24h");
  const [stats, setStats] = useState<ScriptStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ErrorSnapshot[] | null>(null);
  const [errorsTotal, setErrorsTotal] = useState(0);
  const [shown, setShown] = useState<string | null>(null);

  const load = useCallback(async () => {
    const range = statsRange(period, now());
    const [s, e] = await Promise.all([api.stats(scriptId, range), api.errors(scriptId, 1, 100)]);
    if (s.ok) {
      setStats({ points: s.data.points ?? [], warnings: s.data.warnings ?? [], deployMarks: s.data.deployMarks ?? [] });
      setStatsError(null);
    } else setStatsError(errorText(t, s) ?? "");
    if (e.ok) {
      setErrors(e.data.responses ?? []);
      setErrorsTotal(e.data.totalCount ?? e.data.responses?.length ?? 0);
    } else setErrors([]);
  }, [api, scriptId, period, now, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const versions = useMemo(() => statsByVersion(stats?.points ?? []), [stats]);
  const warnings = useMemo(() => (stats ? effectiveWarnings(stats) : []), [stats]);
  const series = useMemo(
    () => statsSeries(stats?.points ?? [], { processed: t("scripts.ops.processed"), errors: t("scripts.ops.errors"), avg: t("scripts.ops.avg"), p95: t("scripts.ops.p95") }),
    [stats, t],
  );
  const marks = useMemo(() => (stats?.deployMarks ?? []).map((m) => ({ timeFrom: m.at, type: "SCRIPT_DEPLOY", title: t("scripts.ops.deployMark", { n: m.versionNo }) })), [stats, t]);

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={t("scripts.ops.title")}
        actions={
          <SelectField label={t("scripts.ops.period")} value={period} onChange={(e) => setPeriod(e.target.value as StatsPeriod)}>
            {(Object.keys(STATS_PERIODS) as StatsPeriod[]).map((key) => (
              <option key={key} value={key}>
                {t(`scripts.ops.periods.${key}`)}
              </option>
            ))}
          </SelectField>
        }
      >
        {statsError && <Alert tone="warning">{statsError}</Alert>}
        {warnings.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1" aria-label={t("scripts.ops.warnings")}>
            {warnings.map((w, i) => (
              <li key={`${w.type}-${i}`} className="flex flex-wrap items-center gap-2 text-[13px]">
                <Badge tone={w.type === "SLOW" ? "warning" : "danger"}>
                  {w.type === "SLOW" ? `⚠ ${t("scripts.ops.slow", { ms: w.value ?? "–" })}` : w.type === "ERROR_RATE" ? `⚠ ${t("scripts.ops.errorRate", { pct: asPercent(w.value).toFixed(1) })}` : `⚠ ${w.type}`}
                </Badge>
                {(w.hints ?? []).length > 0 && (
                  <span className="text-muted">
                    {t("scripts.ops.hints")}: {(w.hints ?? []).map((h) => ((KNOWN_HINTS as readonly string[]).includes(h) ? t(`scripts.ops.hint.${h}`) : h)).join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {stats && stats.points.length === 0 ? (
          <EmptyState title={t("scripts.ops.noStats")} />
        ) : (
          <TimeseriesChart series={series} timezone={timezone} annotations={marks} loading={!stats} height={240} factory={chartFactory} title={t("scripts.ops.title")} />
        )}
        {versions.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>{t("scripts.ops.version")}</th>
                <th>{t("scripts.ops.processed")}</th>
                <th>{t("scripts.ops.errors")}</th>
                <th>{t("scripts.ops.errorRateCol")}</th>
                <th>{t("scripts.ops.avg")}</th>
                <th>{t("scripts.ops.p95")}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.versionNo}>
                  <td className="font-mono">{`v${v.versionNo}`}</td>
                  <td className="font-mono">{v.processed.toLocaleString(i18n.language)}</td>
                  <td className="font-mono">{v.errors.toLocaleString(i18n.language)}</td>
                  <td className={v.errorRate >= 0.1 ? "font-mono text-bad-ink" : "font-mono"}>{`${(v.errorRate * 100).toFixed(1)}%`}</td>
                  <td className="font-mono">{v.avgMs ?? "–"}</td>
                  <td className={v.p95Ms != null && v.p95Ms > 20 ? "font-mono text-fair-ink" : "font-mono"}>{v.p95Ms ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={t("scripts.ops.errorList", { n: errorsTotal })}>
        <p className="mb-2 text-[12px] text-muted">{t("scripts.ops.errorKeep")}</p>
        {errors && errors.length === 0 ? (
          <EmptyState title={t("scripts.ops.noErrors")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("scripts.ops.at")}</th>
                <th>{t("scripts.ops.version")}</th>
                <th>{t("scripts.ops.code")}</th>
                <th>{t("scripts.ops.message")}</th>
                <th>{t("scripts.ops.position")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(errors ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.occurredAt, timezone, i18n.language, true)}</td>
                  <td className="font-mono">{`v${e.versionNo}`}</td>
                  <td className="font-mono text-[12px]">{e.errorCode}</td>
                  <td>
                    {e.message}
                    {shown === e.id && e.inputSnapshot !== undefined && <pre className="mt-1 max-h-48 overflow-auto rounded border border-line p-1 font-mono text-[11.5px]">{JSON.stringify(e.inputSnapshot, null, 2)}</pre>}
                  </td>
                  <td className="font-mono">{e.line ? `${e.line}:${e.col ?? 1}` : "–"}</td>
                  <td className="whitespace-nowrap">
                    {e.inputSnapshot !== undefined && e.inputSnapshot !== null && (
                      <>
                        <Button onClick={() => setShown(shown === e.id ? null : e.id)}>{t("scripts.ops.showInput")}</Button>{" "}
                        {canWrite && (
                          <Button variant="primary" onClick={() => onTestWithInput(e.inputSnapshot)}>
                            {t("scripts.ops.testWithInput")}
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <LogCapture scriptId={scriptId} canWrite={canWrite} initialUntil={logCaptureUntil ?? null} timezone={timezone} api={api} now={now} />
    </div>
  );
}

/** 운영 로그 수집(SCR-05.02): 켜면 30분(켜져 있으면 연장), 남은 시간 1초마다 갱신, 끝나면 "자동으로 꺼졌습니다" */
export function LogCapture({
  scriptId,
  canWrite,
  initialUntil,
  timezone,
  api,
  now = Date.now,
}: {
  scriptId: string;
  canWrite: boolean;
  initialUntil: string | null;
  timezone: string;
  api: Pick<ScriptOpsApi, "logCapture" | "logs">;
  now?: () => number;
}) {
  const { t, i18n } = useTranslation();
  const [until, setUntil] = useState<string | null>(initialUntil);
  const [left, setLeft] = useState(() => remainingSeconds(initialUntil, now()));
  const [expired, setExpired] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.logs(scriptId).then((r) => {
      if (r.ok) setLogs(r.data.responses ?? []);
    });
  }, [api, scriptId]);

  useEffect(() => {
    if (!until) return;
    const tick = () => {
      const seconds = remainingSeconds(until, now());
      setLeft(seconds);
      if (seconds === 0) {
        setUntil(null);
        setExpired(true);
      }
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [until, now]);

  const toggle = async (enabled: boolean) => {
    setError(null);
    const result = await api.logCapture(scriptId, enabled);
    if (!result.ok) return setError(errorText(t, result) ?? "");
    setExpired(false);
    setUntil(result.data.enabled ? result.data.until : null);
    setLeft(result.data.enabled ? remainingSeconds(result.data.until, now()) : 0);
    const refreshed = await api.logs(scriptId);
    if (refreshed.ok) setLogs(refreshed.data.responses ?? []);
  };

  const on = Boolean(until) && left > 0;
  return (
    <Card
      title={t("scripts.ops.logs")}
      actions={
        canWrite && (
          <>
            <Button variant={on ? "secondary" : "primary"} onClick={() => void toggle(true)}>
              {on ? t("scripts.ops.logExtend") : t("scripts.ops.logOn")}
            </Button>
            {on && <Button onClick={() => void toggle(false)}>{t("scripts.ops.logOff")}</Button>}
          </>
        )
      }
    >
      <p className="mb-2 text-[13px]" role="status">
        {on ? t("scripts.ops.logRemaining", { time: formatRemaining(left) }) : expired ? t("scripts.ops.logExpired") : t("scripts.ops.logOffState")}
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {logs.length === 0 ? (
        <p className="text-[12.5px] text-muted">{t("scripts.ops.noLogs")}</p>
      ) : (
        <ul className="max-h-64 overflow-auto font-mono text-[12px]">
          {logs.map((log, i) => (
            <li key={`${log.at}-${i}`}>
              {`${formatDateTime(log.at, timezone, i18n.language, true)} v${log.versionNo}${log.deviceId ? ` #${log.deviceId}` : ""} ${log.message}`}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
