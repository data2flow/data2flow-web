/**
 * `/exports` 탭 내용(UI-TSD-02 작업 목록, UI-TSD-08 정기 내보내기·데이터 사전).
 * - 작업: 시각, 조건 요약, 형식, 행 수, 크기, 상태(진행률), 만료일, [다운로드] [취소]. 진행 중인 작업이 있으면 5초마다 다시 읽는다
 *   (명세의 SSE EVT-TSD-01 대신 조회 — core 실시간 토픽에 내보내기 완료가 아직 없다)
 * - 정기: 이름, 범위, 형식, 주기, 전달, 마지막 결과(실패는 빨간 배지와 사유), [켜기/끄기] [편집] [삭제]
 * - 데이터 사전: 판 번호, 측정 항목 표, 품질 코드, 공간 계층, [HTML]·[JSON] 내려받기(API-TSD-59)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, EmptyState, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber } from "~/lib/format";
import { browserDownload, defaultDataApi, type DataApi, type Downloader } from "../api";
import { dictionaryFileName, spaceDepths, type DataDictionary } from "../model/dictionary";
import { bffDownloadUrl, isActiveJob, querySummary, repeatOf, statusTone, type ExportJob, type ExportSchedule } from "../model/exports";
import { formatBytes } from "../model/storage";
import { ScheduleEditor } from "./schedule-editor";

export const POLL_MS = 5000;

interface Common {
  timezone: string;
  lang: string;
  api?: DataApi;
}

/** `only`가 있으면 그 작업 하나만 다시 읽는다(메일 링크 `/data/exports/{jobId}`, API-TSD-21 단건) */
export function ExportJobsPanel({ initial, failed, timezone, lang, api = defaultDataApi, download = browserDownload, only }: Common & { initial: ExportJob[]; failed?: boolean; download?: Downloader; only?: string }) {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState(initial);
  const [failure, setFailure] = useState<{ code: string; message?: string }>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setJobs(initial), [initial]);

  const refresh = useCallback(async () => {
    if (only) {
      const one = await api.getExport(only);
      if (one.ok) setJobs([one.data]);
      return;
    }
    const result = await api.listExports(1);
    if (result.ok) setJobs(result.data.responses);
  }, [api, only]);

  const polling = jobs.some(isActiveJob);
  useEffect(() => {
    if (!polling) return;
    timer.current = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer.current);
  }, [polling, jobs, refresh]);

  const cancel = async (job: ExportJob) => {
    setFailure(undefined);
    const result = await api.cancelExport(job.id);
    if (result.ok) setJobs((list) => list.map((j) => (j.id === job.id ? result.data : j)));
    else setFailure({ code: result.code, message: result.message });
  };

  return (
    <Card>
      {failed && <Alert tone="warning">{t("data.common.loadFailed")}</Alert>}
      {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
      {jobs.length === 0 && !failed ? (
        <EmptyState title={t("data.jobs.empty")} body={t("data.jobs.emptyBody")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("data.jobs.createdAt")}</th>
              <th>{t("data.jobs.query")}</th>
              <th>{t("data.export.format")}</th>
              <th>{t("data.jobs.rows")}</th>
              <th>{t("data.jobs.size")}</th>
              <th>{t("data.common.status")}</th>
              <th>{t("data.jobs.expiresAt")}</th>
              <th>
                <span className="sr-only">{t("data.common.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const q = querySummary(job.query);
              const href = job.status === "SUCCEEDED" ? bffDownloadUrl(job.downloadUrl) : undefined;
              return (
                <tr key={job.id}>
                  <td>{formatDateTime(job.createdAt, timezone, lang)}</td>
                  <td>
                    {t("data.jobs.querySummary", { n: q.series, from: q.from ? formatDateTime(q.from, timezone, lang) : "–", to: q.to ? formatDateTime(q.to, timezone, lang) : "–" })}
                    {job.scheduleId && <span className="ml-1 text-muted">{t("data.jobs.fromSchedule")}</span>}
                  </td>
                  <td>{job.format}</td>
                  <td className="font-mono">{formatNumber(job.rows ?? job.estimatedRows ?? null, lang)}</td>
                  <td className="font-mono">{formatBytes(job.bytes)}</td>
                  <td>
                    <Badge tone={statusTone(job.status)}>{t(`data.jobs.statuses.${job.status}`, { defaultValue: job.status })}</Badge>
                    {job.error && <p className="text-[12px] text-bad-ink">{job.error}</p>}
                  </td>
                  <td>{job.expiresAt ? formatDateTime(job.expiresAt, timezone, lang) : "–"}</td>
                  <td className="whitespace-nowrap">
                    {href && (
                      <Button variant="ghost" onClick={() => download(href)}>
                        {t("data.jobs.download")}
                      </Button>
                    )}
                    {isActiveJob(job) && (
                      <Button variant="ghost" onClick={() => void cancel(job)}>
                        {t("common.cancel")}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function SchedulesPanel({ initial, failed, timezone, lang, api = defaultDataApi }: Common & { initial: ExportSchedule[]; failed?: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<ExportSchedule | null>(null);
  const [failure, setFailure] = useState<{ code: string; message?: string }>();
  useEffect(() => setItems(initial), [initial]);

  const replace = (s: ExportSchedule) => setItems((list) => list.map((x) => (x.id === s.id ? s : x)));
  const toggle = async (s: ExportSchedule) => {
    setFailure(undefined);
    const result = await api.updateSchedule(s.id, { enabled: !s.enabled, baseVersion: s.version });
    if (result.ok) replace(result.data);
    else setFailure({ code: result.code, message: result.message });
  };
  const remove = async (s: ExportSchedule) => {
    setFailure(undefined);
    const result = await api.deleteSchedule(s.id);
    if (result.ok) setItems((list) => list.filter((x) => x.id !== s.id));
    else setFailure({ code: result.code, message: result.message });
  };
  const repeatText = (cron: string) => {
    const r = repeatOf(cron);
    if (!r || !r.kind) return cron;
    if (r.kind === "WEEKLY") return t("data.schedule.repeatWeekly", { day: t(`data.schedule.weekdays.${r.weekday}`), time: r.time });
    if (r.kind === "MONTHLY") return t("data.schedule.repeatMonthly", { day: r.day, time: r.time });
    return t("data.schedule.repeatDaily", { time: r.time });
  };

  return (
    <Card>
      {failed && <Alert tone="warning">{t("data.common.loadFailed")}</Alert>}
      {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
      {editing && (
        <div className="mb-4 rounded-md border border-line p-3">
          <ScheduleEditor
            schedule={editing}
            api={api}
            onCancel={() => setEditing(null)}
            onSaved={(s) => {
              replace(s);
              setEditing(null);
            }}
          />
        </div>
      )}
      <Alert tone="info">{t("data.schedule.addHint")}</Alert>
      {items.length === 0 && !failed ? (
        <div className="mt-3">
          <EmptyState title={t("data.schedule.empty")} />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("data.schedule.name")}</th>
              <th>{t("data.jobs.query")}</th>
              <th>{t("data.export.format")}</th>
              <th>{t("data.schedule.repeat")}</th>
              <th>{t("data.schedule.delivery")}</th>
              <th>{t("data.schedule.last")}</th>
              <th>
                <span className="sr-only">{t("data.common.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td>
                <td>{t("data.schedule.scope", { n: querySummary(s.query).series, period: t(`data.schedule.periods.${s.relativePeriod}`, { defaultValue: s.relativePeriod }) })}</td>
                <td>{s.format}</td>
                <td>
                  {repeatText(s.cron)}
                  {s.enabled && s.nextRunAt && <p className="text-[12px] text-muted">{t("data.schedule.next", { at: formatDateTime(s.nextRunAt, timezone, lang) })}</p>}
                </td>
                <td>{s.delivery === "EMAIL" ? t("data.schedule.deliveries.EMAIL") : (s.targetType ?? t("data.schedule.deliveries.STORAGE"))}</td>
                <td>
                  {!s.lastStatus ? (
                    <span className="text-muted">–</span>
                  ) : (
                    <>
                      <Badge tone={s.lastStatus === "SUCCEEDED" ? "success" : s.lastStatus === "FAILED" ? "danger" : "info"}>
                        {`${s.lastStatus === "SUCCEEDED" ? "✔" : s.lastStatus === "FAILED" ? "✖" : "…"} ${t(`data.jobs.statuses.${s.lastStatus}`, { defaultValue: s.lastStatus })}${s.lastFileVersion ? ` v${s.lastFileVersion}` : ""}`}
                      </Badge>
                      {s.lastStatus === "FAILED" && s.lastError && <p className="text-[12px] text-bad-ink">{s.lastError}</p>}
                      {s.lastRunAt && <p className="text-[12px] text-muted">{formatDateTime(s.lastRunAt, timezone, lang)}</p>}
                    </>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  <Button variant="ghost" onClick={() => void toggle(s)}>
                    {s.enabled ? t("data.schedule.disable") : t("data.schedule.enable")}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(s)}>
                    {t("common.edit")}
                  </Button>
                  <Button variant="ghost" aria-label={t("data.schedule.deleteOf", { name: s.name })} onClick={() => void remove(s)}>
                    {t("common.delete")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function DictionaryPanel({ dictionary, failed, timezone, lang, download = browserDownload }: { dictionary: DataDictionary | null; failed?: boolean; timezone: string; lang: string; download?: Downloader }) {
  const { t } = useTranslation();
  if (!dictionary) return <Card>{failed ? <Alert tone="warning">{t("data.common.loadFailed")}</Alert> : <EmptyState title={t("data.dictionary.empty")} />}</Card>;
  const depths = spaceDepths(dictionary.spaces ?? []);
  const saveJson = () => {
    const blob = new Blob([JSON.stringify(dictionary, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    download(href, dictionaryFileName(dictionary, "json"));
    setTimeout(() => URL.revokeObjectURL(href), 0);
  };
  return (
    <div className="flex flex-col gap-4">
      <Card
        title={t("data.dictionary.version", { v: dictionary.version })}
        actions={
          <>
            <Button onClick={() => download(`/bff/api/core/data-dictionary?format=html&version=${dictionary.version}`, dictionaryFileName(dictionary, "html"))}>{t("data.dictionary.html")}</Button>
            <Button onClick={saveJson}>{t("data.dictionary.json")}</Button>
          </>
        }
      >
        <p className="text-[12.5px] text-muted">{t("data.dictionary.generatedAt", { at: formatDateTime(dictionary.generatedAt, timezone, lang) })}</p>
        <Table>
          <caption className="sr-only">{t("data.dictionary.metrics")}</caption>
          <thead>
            <tr>
              <th>{t("data.dictionary.key")}</th>
              <th>{t("data.dictionary.name")}</th>
              <th>{t("data.dictionary.unit")}</th>
              <th>{t("data.dictionary.agg")}</th>
              <th>{t("data.dictionary.validRange")}</th>
            </tr>
          </thead>
          <tbody>
            {dictionary.metrics.map((m) => (
              <tr key={m.key}>
                <td className="font-mono">{m.key}</td>
                <td>{m.displayName ?? "–"}</td>
                <td>{m.unit ?? "–"}</td>
                <td>{m.aggDefault ?? "–"}</td>
                <td className="font-mono">{m.validMin == null && m.validMax == null ? "–" : `${m.validMin ?? ""} ~ ${m.validMax ?? ""}`}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t("data.dictionary.quality")}>
          <Table>
            <thead>
              <tr>
                <th>{t("data.dictionary.code")}</th>
                <th>{t("data.dictionary.meaning")}</th>
                <th>{t("data.dictionary.inAggregates")}</th>
              </tr>
            </thead>
            <tbody>
              {(dictionary.qualityCodes ?? []).map((q) => (
                <tr key={q.code}>
                  <td className="font-mono">{q.code}</td>
                  <td>{q.meaning ?? "–"}</td>
                  <td>{q.includedInAggregates ? t("data.common.yes") : t("data.common.no")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={t("data.dictionary.spaces")}>
          <ul className="text-[13px]">
            {(dictionary.spaces ?? []).map((s) => (
              <li key={s.id} style={{ paddingLeft: `${(depths.get(s.id) ?? 0) * 16}px` }}>
                {`${s.name} `}
                <span className="text-[11.5px] text-muted">{s.type}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
