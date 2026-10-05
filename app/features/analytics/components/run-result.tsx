/**
 * UI-ANA-05 실행 결과(ANA-04.02·04.04·05.01~05.07·07.01·08.02·08.05, AIA-01). 경로 `/analytics/{analysisId}/runs/{runId}`.
 * - 진행 중(QUEUED·PENDING·RUNNING)이면 상태 스트림(API-ANA-16 `/bff/stream/analytics/runs/{id}`)으로 진행률·단계·대기 순서를 갱신하고,
 *   끝나면 결과를 다시 읽는다. 연결이 끊기면 5초마다 다시 읽는다(TC-ANA-103)
 * - 핵심 수치 카드(추정치면 범위·배지, ANA-08.02), ChartSpec 차트(공통 렌더러), 표, 근거(evidence), 주의 문구(노란 띠, ANA-08.05)
 * - [다시 실행] [비교](API-ANA-13) [내보내기](CSV·PNG는 화면에서 바로, PDF는 API-ANA-12 비동기) [AI 해설] [대시보드에 고정](API-DSH-08)
 * - 오른쪽 탭: 결과 읽는 법(설명서) · AI 해설(조직 AI가 꺼져 있으면 탭 없음) · 메타정보(대상·기간·버전·포인트·누락률·시드, 모델 상태)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { LiveBanner, useLiveStream } from "~/components/live";
import { Alert, Badge, Button, Card, Dialog, SelectField, StatusDot, cx } from "~/components/ui";
import { downloadDataUrl, downloadText, nodeToPng } from "~/lib/download";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber } from "~/lib/format";
import type { EventSourceLike, StreamEvent } from "~/lib/event-stream";
import type { AiApi } from "~/features/ai/api";
import { CommentaryPanel } from "~/features/ai/components/commentary-panel";
import type { AiState, Commentary } from "~/features/ai/model/types";
import type { AnalyticsApi } from "../api";
import { chartTable, toCsv } from "../model/chartspec";
import { diffText, feedbackTarget, isActive, levelTone, metricText, resultBadges, statusTone } from "../model/result";
import type { Analysis, CompareResult, ModelItem, Run, RunStatusEvent, RunWithResult } from "../model/types";
import { ChartSpecView, SpecTable } from "./chart-spec-view";
import { PinDialog, type PinTarget } from "./pin-dialog";

export const POLL_MS = 5000;
const STAGES = ["LOAD", "COMPUTE", "SAVE"] as const;

export interface Exporter {
  text(text: string, fileName: string): void;
  png(node: HTMLElement, fileName: string): Promise<void>;
}

const defaultExporter: Exporter = {
  text: (text, name) => downloadText(text, name),
  png: async (node, name) => downloadDataUrl(await nodeToPng(node, getComputedStyle(document.body).backgroundColor || "#ffffff"), name),
};

export interface RunResultProps {
  analysis: Analysis;
  initial: RunWithResult;
  runs: Run[];
  howToRead?: string | null;
  models: ModelItem[];
  commentaries: Commentary[];
  aiState: AiState;
  perms: { canRun: boolean; canPin: boolean; canFeedback: boolean; canAi: boolean };
  api: AnalyticsApi;
  aiApi: AiApi;
  timezone: string;
  createSource?: (url: string) => EventSourceLike;
  checkSession?: () => Promise<boolean>;
  chartFactory?: ChartFactory;
  exporter?: Exporter;
  pollMs?: number;
}

type SideTab = "howToRead" | "ai" | "meta";

export function RunResult(props: RunResultProps) {
  const { analysis, initial, runs, howToRead, models, commentaries, perms, api, aiApi, timezone, createSource, checkSession, chartFactory, exporter = defaultExporter, pollMs = POLL_MS } = props;
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const analysisId = analysis.analysisId;
  const [state, setState] = useState<RunWithResult>(initial);
  const run = state.run;
  const result = state.result ?? null;
  const active = isActive(run.status);
  const [aiState, setAiState] = useState<AiState>(props.aiState);
  const [tab, setTab] = useState<SideTab>("howToRead");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "danger" | "warning"; text: string } | null>(null);
  const [confirmWarn, setConfirmWarn] = useState(false);
  const [compareBase, setCompareBase] = useState("");
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [showTech, setShowTech] = useState(false);
  const [asTable, setAsTable] = useState<Record<string, boolean>>({});
  const [pinTarget, setPinTarget] = useState<PinTarget | null>(null);
  const [feedbackDone, setFeedbackDone] = useState<Record<string, string>>({});
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => setState(initial), [initial]);

  const refresh = useCallback(async () => {
    const fresh = await api.getRun(analysisId, run.runId);
    if (fresh.ok) setState(fresh.data);
  }, [api, analysisId, run.runId]);

  const onEvent = useCallback(
    (event: StreamEvent) => {
      const data = event.data as RunStatusEvent;
      if (!data || typeof data !== "object") return;
      setState((s) => ({ ...s, run: { ...s.run, status: data.status ?? s.run.status, progress: data.progress ?? s.run.progress, stage: (data.stage as Run["stage"]) ?? s.run.stage, queuePosition: data.queuePosition ?? s.run.queuePosition } }));
      if (event.type === "run-done" || !isActive(data.status)) void refresh();
    },
    [refresh],
  );
  const streamStatus = useLiveStream(active ? `/bff/stream/analytics/runs/${encodeURIComponent(run.runId)}` : null, ["run-status", "run-done"], onEvent, { createSource, checkSession });

  // 연결이 끊긴 동안은 5초마다 다시 읽는다
  useEffect(() => {
    if (!active || streamStatus !== "retrying") return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [active, streamStatus, refresh, pollMs]);

  const cite = (anchor: string) => {
    setHighlight(anchor);
    if (typeof document !== "undefined") document.getElementById(anchor)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlight((h) => (h === anchor ? null : h)), 3000);
  };

  const rerun = async (ack: boolean) => {
    setConfirmWarn(false);
    const requested = await api.runAnalysis(analysisId, ack);
    if (!requested.ok) {
      if (requested.code === "ANALYSIS_WARNING_NOT_ACKNOWLEDGED") setConfirmWarn(true);
      else setNotice({ tone: "danger", text: errorText(t, requested) ?? "" });
      return;
    }
    const runId = requested.data.runId ?? requested.data.run?.runId;
    if (runId) navigate(`/analytics/${encodeURIComponent(analysisId)}/runs/${encodeURIComponent(runId)}`);
  };

  const cancel = async () => {
    const res = await api.cancelRun(analysisId, run.runId);
    if (res.ok) setState((s) => ({ ...s, run: { ...s.run, ...res.data } }));
    else {
      setNotice({ tone: "warning", text: res.code === "ANALYSIS_RUN_STATE_CONFLICT" ? t("analytics.result.alreadyDone") : (errorText(t, res) ?? "") });
      void refresh();
    }
  };

  const doCompare = async (base: string) => {
    setCompareBase(base);
    if (!base) {
      setCompare(null);
      return;
    }
    const res = await api.compare(analysisId, base, run.runId);
    if (res.ok) setCompare(res.data);
    else setNotice({ tone: "danger", text: errorText(t, res) ?? "" });
  };

  const fileBase = `${analysis.name.replace(/[\\/:*?"<>|\s]+/g, "_")}-${run.runId}`;
  const exportCsv = () => {
    const parts: string[] = [];
    const metrics = result?.summary?.metrics ?? [];
    if (metrics.length) parts.push(toCsv(["metric", "label", "value", "unit"], metrics.map((m) => [m.key, m.label ?? "", typeof m.value === "number" ? m.value : (m.value ?? ""), m.unit ?? ""])));
    for (const table of result?.tables ?? []) parts.push(`# ${table.title ?? table.id}\n${toCsv(table.columns.map((c) => c.key), table.rows.map((r) => table.columns.map((c) => r[c.key] as string | number | null)))}`);
    for (const chart of result?.charts ?? []) {
      const view = chartTable(chart);
      parts.push(`# ${chart.title ?? chart.id}\n${toCsv(view.columns, view.rows)}`);
    }
    exporter.text(`\uFEFF${parts.join("\n\n")}\n`, `${fileBase}.csv`);
  };
  const exportPng = async () => {
    if (content.current) await exporter.png(content.current, `${fileBase}.png`);
  };
  const exportPdf = async () => {
    const res = await api.exportRun(analysisId, run.runId, { format: "PDF" });
    setNotice(res.ok ? { tone: "info", text: t("analytics.result.pdfQueued") } : { tone: "danger", text: errorText(t, res) ?? "" });
  };

  const sendFeedback = async (key: string, target: { occurredAt: string; seriesKey: string }, verdict: "TRUE_POSITIVE" | "FALSE_POSITIVE") => {
    const res = await api.feedback({ runId: run.runId, ...target, verdict });
    if (res.ok) setFeedbackDone((d) => ({ ...d, [key]: verdict }));
    else setNotice({ tone: "danger", text: errorText(t, res) ?? "" });
  };

  const badges = resultBadges(analysis, run, result);
  const succeeded = run.status === "SUCCEEDED" && Boolean(result);
  const otherRuns = runs.filter((r) => r.runId !== run.runId && r.status === "SUCCEEDED");
  const myModels = models.filter((m) => m.analysisId === analysisId).sort((a, b) => b.version - a.version);
  const aiVisible = aiState !== "DISABLED";
  const sideTabs: SideTab[] = aiVisible ? ["howToRead", "ai", "meta"] : ["howToRead", "meta"];
  const compareByKey = useMemo(() => new Map((compare?.metrics ?? []).map((m) => [m.key, m])), [compare]);
  const prov = result?.provenance;
  const duration = run.startedAt && run.finishedAt ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000 : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <SelectField label={t("analytics.result.run")} value={run.runId} onChange={(e) => navigate(`/analytics/${encodeURIComponent(analysisId)}/runs/${encodeURIComponent(e.target.value)}`)}>
            {[run, ...runs.filter((r) => r.runId !== run.runId)].slice(0, 20).map((r) => (
              <option key={r.runId} value={r.runId}>
                {`#${r.runId} · ${t(`analytics.status.${r.status}`)}${r.finishedAt ? ` · ${formatDateTime(r.finishedAt, timezone, lang)}` : ""}`}
              </option>
            ))}
          </SelectField>
        </div>
        <span className="pt-5">
          <StatusDot tone={statusTone(run.status)} label={t(`analytics.status.${run.status}`)} />
        </span>
        <span className="flex flex-wrap gap-1 pt-5">
          {badges.virtual && <Badge tone="warning">{t("analytics.result.virtual")}</Badge>}
          {badges.versionMismatch && <Badge tone="warning">{t("analytics.result.versionMismatch")}</Badge>}
          {badges.estimate && <Badge tone="info">{t("analytics.result.estimate")}</Badge>}
        </span>
        <span className="ml-auto flex flex-wrap gap-2 pt-5">
          {perms.canRun && !active && <Button onClick={() => void rerun(false)}>{t("analytics.result.rerun")}</Button>}
          {succeeded && (
            <>
              <Button onClick={exportCsv}>{t("analytics.result.exportCsv")}</Button>
              <Button onClick={() => void exportPng()}>{t("analytics.result.exportPng")}</Button>
              {perms.canRun && <Button onClick={() => void exportPdf()}>{t("analytics.result.exportPdf")}</Button>}
            </>
          )}
          {succeeded && aiVisible && perms.canAi && (
            <Button variant="primary" onClick={() => setTab("ai")}>
              {t("analytics.result.aiButton")}
            </Button>
          )}
        </span>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <LiveBanner status={streamStatus} />

      {active && (
        <Card title={t("analytics.result.progressTitle")} actions={perms.canRun ? <Button variant="danger" onClick={() => void cancel()}>{t("common.cancel")}</Button> : undefined}>
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="h-2 w-full rounded bg-bg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={run.progress ?? 0} aria-label={t("analytics.result.progress")}>
              <div className="h-2 rounded bg-accent" style={{ width: `${Math.max(2, run.progress ?? 0)}%` }} />
            </div>
            <ol className="flex gap-3 text-[12.5px]">
              {STAGES.map((s) => (
                <li key={s} aria-current={run.stage === s ? "step" : undefined} className={run.stage === s ? "font-semibold text-accent" : "text-muted"}>
                  {t(`analytics.stage.${s}`)}
                </li>
              ))}
            </ol>
            {run.status === "QUEUED" && run.queuePosition != null && (
              <p>{t("analytics.result.queued", { n: run.queuePosition, at: run.estimatedStartAt ? formatDateTime(run.estimatedStartAt, timezone, lang) : "–" })}</p>
            )}
          </div>
        </Card>
      )}

      {(run.status === "FAILED" || run.status === "TIMEOUT") && (
        <Alert tone="danger">
          <strong>{t(`analytics.result.failed.${run.status}`)}</strong> {run.errorMessage ?? (run.errorCode ? errorText(t, { code: run.errorCode }) : "")}
          <span className="block text-[12px]">{t("analytics.result.failedHint")}</span>
          {run.errorDetail && (
            <Button variant="ghost" onClick={() => setShowTech((v) => !v)}>
              {t("analytics.result.techLog")}
            </Button>
          )}
          {showTech && run.errorDetail && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-panel p-2 font-mono text-[11.5px] text-text">{run.errorDetail}</pre>}
        </Alert>
      )}
      {run.status === "CANCELLED" && <Alert tone="info">{t("analytics.result.cancelled")}</Alert>}
      {state.resultExpired && <Alert tone="warning">{t("analytics.result.expired")}</Alert>}

      {succeeded && result && (
        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <div ref={content} className="flex min-w-0 flex-col gap-3">
            {result.summary?.headline && <p className="text-[15px] font-semibold">{result.summary.headline}</p>}
            {(result.caveats ?? []).map((c, i) => (
              <Alert key={i} tone="warning">
                {c}
              </Alert>
            ))}
            {(result.summary?.metrics?.length ?? 0) > 0 && (
              <section aria-label={t("analytics.result.metrics")}>
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-muted">{t("analytics.result.metrics")}</h2>
                  {perms.canPin && (
                    <Button variant="ghost" className="no-export" onClick={() => setPinTarget({ metricKeys: (result.summary?.metrics ?? []).slice(0, 6).map((m) => m.key), label: t("analytics.result.metrics") })}>
                      {t("analytics.result.pin")}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {(result.summary?.metrics ?? []).slice(0, 6).map((m) => {
                    const { value, range } = metricText(m, lang);
                    const diff = compareByKey.get(m.key);
                    const anchor = `result-metric-${m.key}`;
                    return (
                      <div key={m.key} id={anchor} className={cx("rounded-lg border border-line bg-panel p-3", highlight === anchor && "ring-2 ring-accent")}>
                        <p className="flex items-center gap-1 text-[12px] text-muted">
                          {m.label ?? m.key}
                          {m.level && m.level !== "INFO" && <Badge tone={levelTone(m.level)}>{t(`analytics.level.${m.level}`, { defaultValue: m.level })}</Badge>}
                        </p>
                        <p className="text-[20px] font-bold tabular-nums">{value}</p>
                        {range && <p className="text-[11.5px] text-muted">{t("analytics.result.range", { range })}</p>}
                        {diff && <p className="text-[12px] text-accent">{diffText(diff.diff, diff.diffPct, lang)}</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {compare && (
              <Card title={t("analytics.result.compareTitle", { base: compareBase })}>
                {compare.versionMismatch && <Alert tone="warning">{t("analytics.result.compareVersion")}</Alert>}
                {(compare.charts ?? []).map((c) => (
                  <ChartSpecView key={c.id} spec={c} timezone={timezone} factory={chartFactory} />
                ))}
              </Card>
            )}

            {(result.charts ?? []).map((chart) => {
              const anchor = `result-chart-${chart.id}`;
              return (
                <div key={chart.id} id={anchor} className={cx(highlight === anchor && "rounded-lg ring-2 ring-accent")}>
                  <Card
                    title={chart.title ?? chart.id}
                    actions={
                      <span className="no-export flex gap-1">
                        <Button variant="ghost" onClick={() => setAsTable((m) => ({ ...m, [chart.id]: !m[chart.id] }))}>
                          {asTable[chart.id] ? t("analytics.result.asChart") : t("analytics.result.asTable")}
                        </Button>
                        {perms.canPin && (
                          <Button variant="ghost" onClick={() => setPinTarget({ chartId: chart.id, label: chart.title ?? chart.id })}>
                            {t("analytics.result.pin")}
                          </Button>
                        )}
                      </span>
                    }
                  >
                    <ChartSpecView spec={chart} timezone={timezone} factory={chartFactory} asTable={asTable[chart.id]} />
                  </Card>
                </div>
              );
            })}

            {(result.tables ?? []).map((table) => {
              const feedback = perms.canFeedback && table.rows.some((r) => feedbackTarget(r));
              return (
                <Card key={table.id} title={table.title ?? table.id}>
                  <SpecTable
                    table={table}
                    timezone={timezone}
                    lang={lang}
                    highlight={highlight === `result-table-${table.id}`}
                    actionLabel={t("analytics.result.feedback")}
                    rowAction={
                      feedback
                        ? (row) => {
                            const target = feedbackTarget(row);
                            if (!target) return null;
                            const key = `${target.seriesKey}@${target.occurredAt}`;
                            if (feedbackDone[key]) return <Badge tone="neutral">{t(`analytics.result.verdict.${feedbackDone[key]}`)}</Badge>;
                            return (
                              <span className="flex gap-1">
                                <Button onClick={() => void sendFeedback(key, target, "TRUE_POSITIVE")}>{t("analytics.result.verdict.TRUE_POSITIVE")}</Button>
                                <Button onClick={() => void sendFeedback(key, target, "FALSE_POSITIVE")}>{t("analytics.result.verdict.FALSE_POSITIVE")}</Button>
                              </span>
                            );
                          }
                        : undefined
                    }
                  />
                </Card>
              );
            })}

            {result.evidence && (result.evidence.threshold != null || (result.evidence.contributors?.length ?? 0) > 0) && (
              <Card title={t("analytics.result.evidence")}>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                  {result.evidence.threshold != null && (
                    <>
                      <dt className="text-muted">{t("analytics.result.threshold")}</dt>
                      <dd>{formatNumber(result.evidence.threshold, lang)}</dd>
                    </>
                  )}
                  {(result.evidence.contributors ?? []).map((c) => (
                    <div key={c.seriesKey} className="contents">
                      <dt className="text-muted">{c.seriesKey}</dt>
                      <dd>{t("analytics.result.weight", { w: formatNumber(Math.round(c.weight * 100), lang) })}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
          </div>

          <aside className="flex flex-col gap-3">
            {perms.canRun || otherRuns.length > 0 ? (
              <Card title={t("analytics.result.compare")}>
                {otherRuns.length === 0 ? (
                  <p className="text-[12.5px] text-muted">{t("analytics.result.noCompare")}</p>
                ) : (
                  <SelectField label={t("analytics.result.compareWith")} value={compareBase} onChange={(e) => void doCompare(e.target.value)}>
                    <option value="">{t("analytics.result.compareNone")}</option>
                    {otherRuns.map((r) => (
                      <option key={r.runId} value={r.runId}>
                        {`#${r.runId}${r.finishedAt ? ` · ${formatDateTime(r.finishedAt, timezone, lang)}` : ""}`}
                      </option>
                    ))}
                  </SelectField>
                )}
              </Card>
            ) : null}
            <section className="rounded-lg border border-line bg-panel">
              <nav className="flex border-b border-line" role="tablist" aria-label={t("analytics.result.side")}>
                {sideTabs.map((key) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cx("-mb-px flex-1 border-b-2 px-2 py-2 text-[12.5px]", tab === key ? "border-accent font-semibold text-accent" : "border-transparent text-muted")}>
                    {t(`analytics.result.tabs.${key}`)}
                  </button>
                ))}
              </nav>
              <div className="p-3" role="tabpanel">
                {tab === "howToRead" && <p className="whitespace-pre-wrap text-[13px]">{howToRead || t("analytics.result.noGuide")}</p>}
                {tab === "ai" && aiVisible && (
                  <CommentaryPanel runId={run.runId} analysisId={analysisId} initial={commentaries} canGenerate={perms.canAi} api={aiApi} timezone={timezone} onCite={cite} onDisabled={() => setAiState("DISABLED")} />
                )}
                {(tab === "meta" || (tab === "ai" && !aiVisible)) && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                    <dt className="text-muted">{t("analytics.meta.targets")}</dt>
                    <dd>{(prov?.bindings ?? analysis.bindings ?? []).flatMap((b) => b.sources.map((s) => s.label)).join(", ") || "–"}</dd>
                    <dt className="text-muted">{t("analytics.meta.period")}</dt>
                    <dd>{`${formatDateTime(prov?.period?.from ?? run.periodFrom, timezone, lang)} – ${formatDateTime(prov?.period?.to ?? run.periodTo, timezone, lang)}`}</dd>
                    <dt className="text-muted">{t("analytics.meta.resolution")}</dt>
                    <dd>{prov?.resolution ?? analysis.resolution ?? "–"}</dd>
                    <dt className="text-muted">{t("analytics.meta.quality")}</dt>
                    <dd>{t(`analytics.quality.${prov?.qualityFilter ?? analysis.qualityFilter ?? "NORMAL_ONLY"}`)}</dd>
                    <dt className="text-muted">{t("analytics.meta.template")}</dt>
                    <dd>{prov?.template ?? `${analysis.templateKey}@${run.templateVersion ?? analysis.templateVersion ?? ""}`}</dd>
                    <dt className="text-muted">{t("analytics.meta.algorithm")}</dt>
                    <dd>{prov?.algorithm ?? "–"}</dd>
                    <dt className="text-muted">{t("analytics.meta.ranAt")}</dt>
                    <dd>{`${formatDateTime(run.finishedAt ?? run.startedAt, timezone, lang)}${duration !== null ? ` · ${t("analytics.meta.seconds", { n: formatNumber(duration, lang) })}` : ""}`}</dd>
                    <dt className="text-muted">{t("analytics.meta.points")}</dt>
                    <dd>{formatNumber(prov?.points, lang)}</dd>
                    <dt className="text-muted">{t("analytics.meta.missing")}</dt>
                    <dd>{prov?.missingRate != null ? `${formatNumber(Math.round(prov.missingRate * 1000) / 10, lang)}%` : "–"}</dd>
                    <dt className="text-muted">{t("analytics.meta.seed")}</dt>
                    <dd>{prov?.seed ?? "–"}</dd>
                    <dt className="text-muted">{t("analytics.meta.expires")}</dt>
                    <dd>{formatDateTime(result.expiresAt, timezone, lang)}</dd>
                    <dt className="text-muted">{t("analytics.meta.model")}</dt>
                    <dd>
                      {myModels.length === 0 ? (
                        t("analytics.meta.noModel")
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {myModels.slice(0, 3).map((m) => (
                            <li key={m.modelId}>
                              {`v${m.version} · ${t(`analytics.modelStatus.${m.status}`)}`}
                              {m.metrics && Object.entries(m.metrics).filter(([, v]) => v != null).slice(0, 2).map(([k, v]) => ` · ${k.toUpperCase()} ${formatNumber(v as number, lang)}`).join("")}
                              {m.drift && <Badge tone="warning">{t("analytics.models.drift")}</Badge>}
                            </li>
                          ))}
                        </ul>
                      )}{" "}
                      <Link to="/analytics/models" className="text-accent hover:underline">
                        {t("analytics.meta.models")}
                      </Link>
                    </dd>
                  </dl>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      <Dialog
        title={t("analytics.result.warnTitle")}
        open={confirmWarn}
        onClose={() => setConfirmWarn(false)}
        footer={
          <>
            <Button onClick={() => setConfirmWarn(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void rerun(true)}>
              {t("analytics.result.runAnyway")}
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{t("analytics.result.warnBody")}</p>
      </Dialog>
      <PinDialog analysisId={analysisId} target={pinTarget} api={api} onClose={() => setPinTarget(null)} />
    </div>
  );
}
