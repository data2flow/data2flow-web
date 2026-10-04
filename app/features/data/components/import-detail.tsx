/**
 * UI-TSD-03 ③ 미리 실행 결과와 ④ 실행(TSD-04.02): 예상 행 수·중복 예상·실패 예시(API-TSD-31), [가져오기 실행](API-TSD-32),
 * 진행률·삽입·중복·실패 수, 오류 목록과 내려받기. 처리 중이면 3초마다 다시 읽는다.
 * 매핑 안 된 기기는 자동으로 만들지 않고 오류로 남는다(BR-TSD-16, AT-TSD-05.3).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber } from "~/lib/format";
import { browserDownload, defaultDataApi, type DataApi, type Downloader } from "../api";
import { canRun, errorsCsv, importPercent, importTone, isRunningImport, type ImportError, type ImportJob } from "../model/imports";

export const IMPORT_POLL_MS = 3000;

export interface ImportDetailProps {
  initial: ImportJob;
  errors: ImportError[];
  canImport: boolean;
  timezone: string;
  lang: string;
  api?: DataApi;
  download?: Downloader;
}

export function ImportDetail({ initial, errors: initialErrors, canImport, timezone, lang, api = defaultDataApi, download = browserDownload }: ImportDetailProps) {
  const { t } = useTranslation();
  const [job, setJob] = useState(initial);
  const [errors, setErrors] = useState(initialErrors);
  const [failure, setFailure] = useState<{ code: string; message?: string }>();
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [next, list] = await Promise.all([api.getImport(job.id), api.importErrors(job.id)]);
    if (next.ok) setJob(next.data);
    if (list.ok) setErrors(list.data.responses);
  }, [api, job.id]);

  const running = isRunningImport(job);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => void reload(), IMPORT_POLL_MS);
    return () => clearTimeout(timer);
  }, [running, job, reload]);

  const run = async () => {
    setBusy(true);
    setFailure(undefined);
    const result = await api.runImport(job.id);
    setBusy(false);
    if (result.ok) setJob(result.data);
    else setFailure({ code: result.code, message: result.message });
  };

  const saveErrors = () => {
    const href = URL.createObjectURL(new Blob(["\uFEFF", errorsCsv(errors)], { type: "text/csv;charset=utf-8" }));
    download(href, `import-${job.id}-errors.csv`);
    setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  const dryRunDone = job.status === "DRY_RUN_DONE";
  return (
    <div className="flex flex-col gap-4">
      <Card title={t(dryRunDone ? "data.imports.step.dryRun" : "data.imports.step.run")}>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge tone={importTone(job.status)}>{t(`data.imports.statuses.${job.status}`, { defaultValue: job.status })}</Badge>
          <span>{t(`data.imports.kinds.${job.sourceKind}`)}</span>
          {job.originLabel && <span className="text-muted">{t("data.imports.originOf", { label: job.originLabel })}</span>}
          {job.rangeFrom && job.rangeTo && <span className="text-muted">{`${formatDateTime(job.rangeFrom, timezone, lang)} ~ ${formatDateTime(job.rangeTo, timezone, lang)}`}</span>}
        </div>
        {!dryRunDone && <progress className="mt-3 w-full" max={100} value={importPercent(job)} aria-label={t("data.imports.progress")} />}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
          {(
            [
              ["total", job.total],
              ["inserted", job.inserted],
              ["skippedDuplicate", job.skippedDuplicate],
              ["failed", job.failed],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-md border border-line p-2">
              <dt className="text-[12px] text-muted">{t(dryRunDone ? `data.imports.counts.dry.${key}` : `data.imports.counts.${key}`)}</dt>
              <dd className="font-mono text-[15px]">{formatNumber(value ?? 0, lang)}</dd>
            </div>
          ))}
        </dl>
        {job.error && <Alert tone="danger">{job.error}</Alert>}
        {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
        {canImport && canRun(job) && (
          <div className="mt-3 flex justify-end">
            <Button variant="primary" disabled={busy} onClick={() => void run()}>
              {t("data.imports.run")}
            </Button>
          </div>
        )}
      </Card>
      {job.sample && job.sample.length > 0 && (
        <Card title={t("data.imports.sample")}>
          <pre className="overflow-x-auto font-mono text-[11.5px]">{job.sample.map((s) => JSON.stringify(s)).join("\n")}</pre>
        </Card>
      )}
      <Card title={t("data.imports.errorList", { n: errors.length })} actions={errors.length > 0 && <Button onClick={saveErrors}>{t("data.imports.downloadErrors")}</Button>}>
        {errors.length === 0 ? (
          <p className="text-[13px] text-muted">{t("data.imports.noErrors")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("data.imports.line")}</th>
                <th>{t("data.imports.code")}</th>
                <th>{t("data.imports.message")}</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={`${e.lineOrPoint}${i}`}>
                  <td className="font-mono">{e.lineOrPoint}</td>
                  <td className="font-mono">{e.errorCode}</td>
                  <td>{e.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
