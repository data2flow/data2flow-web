/**
 * UI-TSD-02 내보내기 대화상자(TSD-04.01): 조회 조건 요약, 형식(CSV/Excel), 열 형태(긴/넓은 + 예시 3행), 품질 포함, 시간대, 예상 행 수.
 * [내보내기] → API-TSD-20: 동기면 바로 내려받고(BFF 주소), 비동기면 "완료되면 알려 드립니다"와 작업 목록 링크.
 * 진행 중인 비동기 작업이 3개면 새로 만들 수 없다(UI-TSD-02 입력 검증). [정기 내보내기로 저장]은 같은 조건으로 정기 설정을 연다.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Button, Checkbox, Dialog, SelectField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { COMMON_TIMEZONES, formatDateTime, formatNumber } from "~/lib/format";
import { browserDownload, defaultDataApi, type DataApi, type Downloader } from "../api";
import {
  EXPORT_COLUMNS,
  EXPORT_FORMATS,
  MAX_ACTIVE_JOBS,
  SYNC_ROW_LIMIT,
  activeJobCount,
  bffDownloadUrl,
  estimateRows,
  exportBody,
  previewLines,
  type ExportOptions,
  type TelemetryQuery,
} from "../model/exports";
import { ScheduleEditor } from "./schedule-editor";

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  query: TelemetryQuery;
  /** 미리 보기용 계열 이름(조회 순서) */
  labels: { id: string; label: string; metric: string; unit?: string | null }[];
  resolutionUsed?: string;
  timezone: string;
  lang?: string;
  api?: DataApi;
  download?: Downloader;
}

export function ExportDialog({ open, onClose, query, labels, resolutionUsed, timezone, lang = "ko", api = defaultDataApi, download = browserDownload }: ExportDialogProps) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ExportOptions>({ format: "CSV", columns: "LONG", includeQuality: true, tz: timezone });
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message?: string }>();
  const [queued, setQueued] = useState<string>();
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQueued(undefined);
    setFailure(undefined);
    setScheduled(false);
    void api.listExports(1).then((result) => {
      if (!cancelled && result.ok) setActive(activeJobCount(result.data.responses));
    });
    return () => {
      cancelled = true;
    };
  }, [open, api]);

  const estimate = estimateRows(query, options.columns, resolutionUsed);
  const sync = estimate <= SYNC_ROW_LIMIT;
  const full = active >= MAX_ACTIVE_JOBS;
  const set = (patch: Partial<ExportOptions>) => setOptions((o) => ({ ...o, ...patch }));

  const submit = async () => {
    setBusy(true);
    setFailure(undefined);
    const result = await api.createExport(exportBody(query, options));
    setBusy(false);
    if (!result.ok) {
      setFailure({ code: result.code, message: result.message });
      return;
    }
    const href = bffDownloadUrl(result.data.downloadUrl);
    if (result.data.mode === "SYNC" && href) {
      download(href);
      onClose();
      return;
    }
    setActive((n) => n + 1);
    setQueued(result.data.jobId ?? "");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("data.export.title")}
      footer={
        !scheduling && (
          <>
            <Button onClick={() => setScheduling(true)}>{t("data.export.saveSchedule")}</Button>
            <Button variant="primary" disabled={busy || full || query.series.length === 0} onClick={() => void submit()}>
              {t("data.export.submit")}
            </Button>
          </>
        )
      }
    >
      <p className="text-[13px]">
        {t("data.export.summary", {
          n: query.series.length,
          from: formatDateTime(query.from, timezone, lang),
          to: formatDateTime(query.to, timezone, lang),
          resolution: t(`explore.resolution.${resolutionUsed ?? query.resolution ?? "auto"}`, { defaultValue: resolutionUsed ?? query.resolution ?? "" }),
        })}
      </p>
      {scheduling ? (
        <ScheduleEditor
          query={query}
          api={api}
          onCancel={() => setScheduling(false)}
          onSaved={() => {
            setScheduling(false);
            setScheduled(true);
          }}
        />
      ) : (
        <>
          <fieldset className="flex flex-wrap gap-4 text-[13px]">
            <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("data.export.format")}</legend>
            {EXPORT_FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-1.5">
                <input type="radio" name="export-format" value={f} checked={options.format === f} onChange={() => set({ format: f })} />
                {t(`data.export.formats.${f}`)}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-wrap gap-4 text-[13px]">
            <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("data.export.columns")}</legend>
            {EXPORT_COLUMNS.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="radio" name="export-columns" value={c} checked={options.columns === c} onChange={() => set({ columns: c })} />
                {t(`data.export.columnKinds.${c}`)}
              </label>
            ))}
          </fieldset>
          <pre aria-label={t("data.export.preview")} className="overflow-x-auto rounded-md border border-line bg-bg p-2 font-mono text-[11.5px]">
            {previewLines(options.columns, options.includeQuality, labels).join("\n")}
          </pre>
          <div className="flex flex-wrap items-end gap-3">
            <Checkbox label={t("data.export.includeQuality")} checked={options.includeQuality} onChange={(e) => set({ includeQuality: e.target.checked })} />
            <SelectField label={t("data.export.timezone")} value={options.tz} onChange={(e) => set({ tz: e.target.value })}>
              {[...new Set([timezone, ...COMMON_TIMEZONES])].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="text-[12.5px] text-muted">{t(sync ? "data.export.estimateSync" : "data.export.estimateAsync", { rows: formatNumber(estimate, lang) })}</p>
          {full && <Alert tone="warning">{t("data.export.tooManyActive", { n: MAX_ACTIVE_JOBS })}</Alert>}
          {queued !== undefined && (
            <Alert tone="success">
              {t("data.export.queued")}{" "}
              <Link to="/exports" className="underline">
                {t("data.export.openJobs")}
              </Link>
            </Alert>
          )}
        </>
      )}
      {scheduled && <Alert tone="success">{t("data.schedule.saved")}</Alert>}
      {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
    </Dialog>
  );
}
