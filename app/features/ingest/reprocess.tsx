/**
 * 재처리 작업 화면 본문(UI-ING-05, ING-01.04, SCR-03.06): 새 작업 폼(기간 31일 이하, 소스 1개, 기기 선택, 메모) → [미리 보기](API-ING-09:
 * 대상 건수·상태별 분포·예상 시간·디코더·스크립트 버전) → [시작] 확인 대화상자 → 작업 생성(API-ING-10, 202). 작업 목록(API-ING-14)은
 * 진행 중 작업이 있으면 5초마다 다시 읽고(core에 재처리 실시간 토픽이 없음), 실행 중 작업은 [취소](API-ING-12, 확인 대화상자).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Badge, Button, Card, Dialog, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { clientIdempotencyKey } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { ReprocessApi } from "./m5-api";
import { REPROCESS_POLL_MS, checkReprocessForm, formatDuration, hasActiveJob, isoToZonedLocal, jobTone, progressOf, zonedLocalToIso, type ReprocessJob, type ReprocessPreview } from "./model/m5";

export interface ReprocessPrefill {
  sourceId?: string | null;
  deviceIds?: string[];
  from?: string | null;
  to?: string | null;
  memo?: string | null;
}

export interface ReprocessViewProps {
  sources: { id: string; name: string }[];
  devices: { id: string; name: string; sourceId?: string | null }[];
  jobs: ReprocessJob[];
  prefill: ReprocessPrefill;
  canWrite: boolean;
  timezone: string;
  /** 기본 기간(prefill이 없을 때): 최근 7일 */
  nowMs: number;
  api: ReprocessApi;
  pollMs?: number;
}

export function ReprocessView({ sources, devices, jobs: initialJobs, prefill, canWrite, timezone, nowMs, api, pollMs = REPROCESS_POLL_MS }: ReprocessViewProps) {
  const { t, i18n } = useTranslation();
  const [sourceId, setSourceId] = useState(prefill.sourceId ?? "");
  const [deviceIds, setDeviceIds] = useState<string[]>(prefill.deviceIds ?? []);
  const [from, setFrom] = useState(isoToZonedLocal(prefill.from ?? new Date(nowMs - 7 * 86_400_000).toISOString(), timezone));
  const [to, setTo] = useState(isoToZonedLocal(prefill.to ?? new Date(nowMs).toISOString(), timezone));
  const [memo, setMemo] = useState(prefill.memo ?? "");
  const [errors, setErrors] = useState<Partial<Record<"sourceId" | "period" | "memo", string>>>({});
  const [preview, setPreview] = useState<ReprocessPreview | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ReprocessJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<ReprocessJob[]>(initialJobs);
  const [idempotencyKey, setIdempotencyKey] = useState(clientIdempotencyKey);

  const sourceDevices = useMemo(() => devices.filter((d) => !sourceId || !d.sourceId || d.sourceId === sourceId), [devices, sourceId]);

  const body = () => {
    const checked = checkReprocessForm({ sourceId, deviceIds, from: zonedLocalToIso(from, timezone) ?? "", to: zonedLocalToIso(to, timezone) ?? "", memo });
    setErrors(checked.errors);
    return checked.body;
  };

  const reload = useCallback(async () => {
    const result = await api.list();
    if (result.ok) setJobs(result.data.responses ?? []);
  }, [api]);

  const active = hasActiveJob(jobs);
  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => void reload(), pollMs);
    return () => clearInterval(handle);
  }, [active, reload, pollMs]);

  const runPreview = async () => {
    const request = body();
    if (!request) return;
    setBusy(true);
    setNotice(null);
    const result = await api.preview(request);
    setBusy(false);
    if (!result.ok) {
      setPreview(null);
      return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    }
    setPreview(result.data);
  };

  const start = async () => {
    setConfirm(false);
    const request = body();
    if (!request) return;
    setBusy(true);
    const result = await api.create(request, idempotencyKey);
    setBusy(false);
    if (!result.ok) return setNotice({ tone: result.status === 409 ? "warning" : "danger", text: errorText(t, result) ?? "" });
    setNotice({ tone: "success", text: t("ingest.reprocess.started", { id: result.data.jobId, total: result.data.total.toLocaleString(i18n.language) }) });
    setPreview(null);
    setIdempotencyKey(clientIdempotencyKey());
    await reload();
  };

  const cancel = async () => {
    const job = cancelTarget;
    setCancelTarget(null);
    if (!job) return;
    const result = await api.cancel(job.jobId);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setNotice({ tone: "success", text: t("ingest.reprocess.cancelled", { id: job.jobId }) });
    await reload();
  };

  const touch = () => setPreview(null);
  const duration = formatDuration(preview?.estimatedSeconds);

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {canWrite && (
        <Card title={t("ingest.reprocess.new")}>
          <div className="flex flex-wrap items-end gap-2">
            <TextField label={t("ingest.reprocess.from")} type="datetime-local" value={from} onChange={(e) => {
                setFrom(e.target.value);
                touch();
              }} error={errors.period ? t(`ingest.reprocess.validation.${errors.period}`) : undefined} />
            <TextField label={t("ingest.reprocess.to")} type="datetime-local" value={to} onChange={(e) => {
                setTo(e.target.value);
                touch();
              }} />
            <SelectField label={t("ingest.reprocess.source")} value={sourceId} onChange={(e) => {
                setSourceId(e.target.value);
                setDeviceIds([]);
                touch();
              }} error={errors.sourceId ? t(`ingest.reprocess.validation.${errors.sourceId}`) : undefined}>
              <option value="">{t("ingest.reprocess.pickSource")}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
            <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
              {t("ingest.reprocess.devices")}
              <select
                aria-label={t("ingest.reprocess.devices")}
                multiple
                value={deviceIds}
                onChange={(e) => {
                  setDeviceIds([...e.target.selectedOptions].map((o) => o.value));
                  touch();
                }}
                className="min-w-48 rounded-md border border-line bg-panel p-1 text-[13px] text-text"
                size={Math.min(5, Math.max(2, sourceDevices.length))}
              >
                {sourceDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <span className="text-[11.5px]">{deviceIds.length === 0 ? t("ingest.reprocess.allDevices") : t("ingest.reprocess.selectedDevices", { n: deviceIds.length })}</span>
            </label>
            <TextField label={t("ingest.reprocess.memo")} value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} error={errors.memo ? t(`ingest.reprocess.validation.${errors.memo}`) : undefined} />
            <Button disabled={busy} onClick={() => void runPreview()}>
              {t("ingest.reprocess.preview")}
            </Button>
          </div>
          <p className="mt-1 text-[12px] text-muted">{t("ingest.reprocess.help")}</p>
          {preview && (
            <div className="mt-3 rounded-md border border-line p-3 text-[13px]" aria-label={t("ingest.reprocess.previewTitle")}>
              <p className="font-semibold">
                {t("ingest.reprocess.target", { n: preview.total.toLocaleString(i18n.language) })} · {t(`ingest.reprocess.eta.${duration.unit}`, { n: duration.n })}
              </p>
              {preview.byStatus && Object.keys(preview.byStatus).length > 0 && (
                <p className="text-muted">
                  {Object.entries(preview.byStatus)
                    .map(([status, n]) => `${status} ${n.toLocaleString(i18n.language)}`)
                    .join(" · ")}
                </p>
              )}
              {preview.decoder?.key && <p>{t("ingest.reprocess.decoder", { key: preview.decoder.key, version: preview.decoder.version ?? "–" })}</p>}
              {(preview.scripts ?? []).map((s, i) => (
                <p key={`${s.scriptId}-${i}`}>{t("ingest.reprocess.script", { scope: s.scope ?? "", name: s.name ?? s.scriptId ?? "", version: s.version ?? "–" })}</p>
              ))}
              {preview.total === 0 && <p className="text-warn">{t("ingest.reprocess.noTarget")}</p>}
              <div className="mt-2 flex justify-end">
                <Button variant="primary" disabled={busy || preview.total === 0} onClick={() => setConfirm(true)}>
                  {t("ingest.reprocess.start")}
                </Button>
              </div>
            </div>
          )}
          {!preview && <p className="mt-1 text-[12px] text-muted">{t("ingest.reprocess.previewFirst")}</p>}
        </Card>
      )}

      <Card title={t("ingest.reprocess.jobs")}>
        {jobs.length === 0 ? (
          <EmptyState title={t("ingest.reprocess.noJobs")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("ingest.reprocess.job")}</th>
                <th>{t("ingest.reprocess.targetCol")}</th>
                <th>{t("ingest.reprocess.status")}</th>
                <th>{t("ingest.reprocess.progress")}</th>
                <th>{t("ingest.reprocess.counts")}</th>
                <th>{t("ingest.reprocess.requestedBy")}</th>
                <th>{t("ingest.reprocess.time")}</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const pct = progressOf(job);
                return (
                  <tr key={job.jobId} data-testid={`job-${job.jobId}`}>
                    <td className="font-mono">{`RJ-${job.jobId}`}</td>
                    <td>
                      {job.sourceName ?? job.sourceId ?? "–"}
                      {(job.deviceIds ?? []).length > 0 && <span className="text-muted">{` · ${t("ingest.reprocess.selectedDevices", { n: job.deviceIds?.length ?? 0 })}`}</span>}
                      <div className="text-[11.5px] text-muted">{`${formatDateTime(job.from, timezone, i18n.language)} ~ ${formatDateTime(job.to, timezone, i18n.language)}`}</div>
                      {job.memo && <div className="text-[11.5px] text-muted">{job.memo}</div>}
                    </td>
                    <td>
                      <Badge tone={jobTone(job.status)}>{t(`ingest.reprocess.statuses.${job.status}`, { defaultValue: job.status })}</Badge>
                      {job.error && <div className="text-[11.5px] text-bad">{job.error}</div>}
                    </td>
                    <td>
                      <progress max={100} value={pct} aria-label={t("ingest.reprocess.progress")} /> <span className="font-mono text-[12px]">{`${pct}%`}</span>
                    </td>
                    <td className="font-mono text-[12px]">
                      {`${job.processed.toLocaleString(i18n.language)} / ${job.failed.toLocaleString(i18n.language)}`}
                      {job.status === "COMPLETED" && job.failed > 0 && (
                        <div>
                          <Link to="/ingest/failures" className="text-accent hover:underline">
                            {t("ingest.reprocess.failedLink")}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td>{job.requestedByName ?? job.requestedBy ?? "–"}</td>
                    <td className="text-[12px]">
                      {formatDateTime(job.startedAt ?? job.createdAt, timezone, i18n.language)}
                      {job.finishedAt && ` ~ ${formatDateTime(job.finishedAt, timezone, i18n.language)}`}
                    </td>
                    {canWrite && (
                      <td>
                        {(job.status === "RUNNING" || job.status === "PENDING" || job.status === "QUEUED") && (
                          <Button variant="danger" onClick={() => setCancelTarget(job)}>
                            {t("common.cancel")}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {active && <p className="mt-1 text-[12px] text-muted">{t("ingest.reprocess.polling")}</p>}
      </Card>

      <Dialog title={t("ingest.reprocess.confirmTitle")} open={confirm} onClose={() => setConfirm(false)}>
        <p className="text-[13px]">{t("ingest.reprocess.confirmBody")}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void start()}>
            {t("ingest.reprocess.start")}
          </Button>
        </div>
      </Dialog>
      <Dialog title={t("ingest.reprocess.cancelTitle")} open={cancelTarget !== null} onClose={() => setCancelTarget(null)}>
        <p className="text-[13px]">{t("ingest.reprocess.cancelBody", { id: cancelTarget?.jobId ?? "" })}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setCancelTarget(null)}>{t("common.no")}</Button>
          <Button variant="danger" onClick={() => void cancel()}>
            {t("ingest.reprocess.cancelJob")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
