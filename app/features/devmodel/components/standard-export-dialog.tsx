/**
 * UI-DEV-20 표준 형식 내보내기 대화상자(DEV-13.04, API-DEV-135·136). 범위(선택한 기기·공간), 형식(DTDL v3 / NGSI-LD / Brick Turtle / Brick JSON-LD),
 * [현재값 포함], NGSI-LD 주기 전송(출력 연결·주기), 진행 표시, 결과 보고서(제외된 점 목록). 작업이 끝나지 않았으면 2초마다 다시 조회한다.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Dialog, SelectField, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { DevModelApi } from "../api";
import { STANDARD_FORMATS, jobFinished, toBffUrl, type ExportJob, type StandardFormat } from "../model/types";

export const JOB_POLL_MS = 2000;
const INTERVALS = [300, 900, 3600];

export interface StandardExportDialogProps {
  open: boolean;
  onClose: () => void;
  scope: { spaceIds: string[]; deviceIds: string[] };
  scopeLabel: string;
  api: DevModelApi;
}

export function StandardExportDialog({ open, onClose, scope, scopeLabel, api }: StandardExportDialogProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<StandardFormat>("DTDL");
  const [includeValues, setIncludeValues] = useState(true);
  const [periodic, setPeriodic] = useState(false);
  const [outputs, setOutputs] = useState<{ id: string; name: string }[] | null>(null);
  const [outputId, setOutputId] = useState("");
  const [intervalSec, setIntervalSec] = useState(300);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empty = scope.deviceIds.length === 0 && scope.spaceIds.length === 0;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open || format !== "NGSI_LD" || outputs !== null) return;
    void api.outputConnections().then((result) => setOutputs(result.ok ? (result.data.responses ?? []).map((o) => ({ id: String(o.id), name: o.name })) : []));
  }, [open, format, outputs, api]);

  const poll = (jobId: string) => {
    timer.current = setTimeout(async () => {
      const result = await api.exportJob(jobId);
      if (!result.ok) {
        setBusy(false);
        setError(errorText(t, result) ?? null);
        return;
      }
      setJob(result.data);
      if (jobFinished(result.data.status)) setBusy(false);
      else poll(jobId);
    }, JOB_POLL_MS);
  };

  const start = async () => {
    setError(null);
    setNotice(null);
    setJob(null);
    setBusy(true);
    const created = await api.exportStandard({ format, scope, includeValues: format === "NGSI_LD" ? includeValues : false });
    if (!created.ok) {
      setBusy(false);
      setError(errorText(t, created) ?? null);
      return;
    }
    const first = await api.exportJob(created.data.jobId);
    if (first.ok) {
      setJob(first.data);
      if (jobFinished(first.data.status)) setBusy(false);
      else poll(created.data.jobId);
    } else poll(created.data.jobId);
    if (format === "NGSI_LD" && periodic && outputId) {
      const push = await api.createNgsiPush({ outputConnectionId: outputId, scope, intervalSec });
      setNotice(push.ok ? t("devmodel.standard.pushCreated", { minutes: Math.round(intervalSec / 60) }) : errorText(t, push) ?? null);
    }
  };

  const skipped = job?.report?.skipped ?? [];
  const download = toBffUrl(job?.downloadUrl);
  return (
    <Dialog
      title={t("devmodel.standard.title")}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.close")}</Button>
          <Button variant="primary" onClick={() => void start()} disabled={busy || empty || (periodic && !outputId)}>
            {t("devmodel.standard.run")}
          </Button>
        </>
      }
    >
      <p className="text-[13px]">
        {t("devmodel.standard.scope")}: <strong>{scopeLabel}</strong>
      </p>
      {empty && <Alert tone="warning">{t("devmodel.standard.emptyScope")}</Alert>}
      <fieldset className="flex flex-wrap gap-3 text-[13px]">
        <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("devmodel.standard.format")}</legend>
        {STANDARD_FORMATS.map((f) => (
          <label key={f} className="flex items-center gap-1">
            <input type="radio" name="standard-format" value={f} checked={format === f} onChange={() => setFormat(f)} />
            {t(`devmodel.standard.formats.${f}`)}
          </label>
        ))}
      </fieldset>
      {format === "NGSI_LD" && (
        <>
          <Checkbox label={t("devmodel.standard.includeValues")} checked={includeValues} onChange={(e) => setIncludeValues(e.target.checked)} />
          <Checkbox label={t("devmodel.standard.periodic")} checked={periodic} onChange={(e) => setPeriodic(e.target.checked)} />
          {periodic && (
            <div className="flex flex-wrap gap-3">
              <SelectField label={t("devmodel.standard.output")} value={outputId} onChange={(e) => setOutputId(e.target.value)}>
                <option value="">{t("devmodel.standard.chooseOutput")}</option>
                {(outputs ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </SelectField>
              <SelectField label={t("devmodel.standard.interval")} value={String(intervalSec)} onChange={(e) => setIntervalSec(Number(e.target.value))}>
                {INTERVALS.map((sec) => (
                  <option key={sec} value={sec}>
                    {t("devmodel.standard.minutes", { n: sec / 60 })}
                  </option>
                ))}
              </SelectField>
              {outputs !== null && outputs.length === 0 && <p className="text-[12.5px] text-muted">{t("devmodel.standard.noOutputs")}</p>}
            </div>
          )}
        </>
      )}
      {busy && (
        <p role="status" className="text-[13px] text-muted">
          {t("devmodel.standard.running")}
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}
      {job && jobFinished(job.status) && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <Alert tone={job.status === "FAILED" ? "danger" : skipped.length ? "warning" : "success"}>
            {job.status === "FAILED" ? t("devmodel.standard.failed") : t("devmodel.standard.done", { exported: job.report?.exported ?? 0, skipped: skipped.length })}
          </Alert>
          {download && job.status !== "FAILED" && (
            <a className="text-accent hover:underline" href={download}>
              {t("devmodel.standard.download")}
            </a>
          )}
          {skipped.length > 0 && (
            <Table>
              <caption className="text-left text-[12.5px] text-muted">{t("devmodel.standard.skippedTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("devmodel.standard.device")}</th>
                  <th scope="col">{t("devmodel.standard.type")}</th>
                  <th scope="col">{t("devmodel.standard.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {skipped.map((s, i) => (
                  <tr key={`${s.deviceId}-${i}`}>
                    <td className="font-mono">{s.deviceId ?? "–"}</td>
                    <td>{s.type ?? "–"}</td>
                    <td>{s.reason ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </Dialog>
  );
}
