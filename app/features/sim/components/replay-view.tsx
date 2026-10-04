/**
 * UI-SIM-11 실제 데이터 재생 — 파일 가져오기(SIM-06.03): CSV·JSON Lines 업로드(≤10MB, API-SIM-23) → 열 매핑(시각·기기·측정 열)
 * → 미리 보기 20행 → 대상 건수 확인(dryRun) → 재생 시작(API-SIM-22). 업로드는 같은 화면 action이 multipart로 중계하고,
 * 파일 오류(SIM_IMPORT_INVALID)는 문제 행 번호와 이유를 보인다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Alert, Button, Card, CsrfField, SelectField, Table, TextField } from "~/components/ui";
import { simErrorText } from "../model/sim-error";
import type { SimApi } from "../api";
import { checkMapping, checkReplayFile, guessMapping, replayBody, TIME_FORMATS, type ColumnMapping } from "../model/replay";
import type { Problem } from "../model/sim";
import type { ReplayFile } from "../model/types";
import { useProblemText } from "./common";

/** core가 재생 경로를 아직 열지 않았을 때(M3, M4에서 열림) 오는 상태 */
export const REPLAY_UNAVAILABLE = [404, 405, 501];

const failureText = (t: ReturnType<typeof useTranslation>["t"], result: { status: number; code: string; message?: string; errors?: { field: string; code: string; message: string }[] }) =>
  REPLAY_UNAVAILABLE.includes(result.status) && !result.code.startsWith("SIM_") ? t("errors.SIM_REPLAY_UNAVAILABLE") : simErrorText(t, result);

export interface UploadError {
  code: string;
  message?: string;
  row?: number | null;
  reason?: string | null;
}

export function ReplayView({
  uploaded,
  uploadError,
  spaces,
  canRun,
  api,
  navigate,
}: {
  uploaded?: ReplayFile | null;
  uploadError?: UploadError | null;
  spaces: { spaceId: string; name: string }[];
  canRun: boolean;
  api: Pick<SimApi, "replay">;
  navigate: (to: string) => void;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [fileProblem, setFileProblem] = useState<Problem | undefined>();
  const [mapping, setMapping] = useState<ColumnMapping>(() => guessMapping(uploaded?.columns ?? []));
  const [timeFormat, setTimeFormat] = useState<string>(TIME_FORMATS[0]);
  const [basis, setBasis] = useState<"NOW" | "AT">("NOW");
  const [at, setAt] = useState("");
  const [acceleration, setAcceleration] = useState("60");
  const [cloneSpaceId, setCloneSpaceId] = useState(spaces[0]?.spaceId ?? "");
  const [cloneSuffix, setCloneSuffix] = useState(t("sim.replay.defaultSuffix"));
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const build = () => {
    if (!uploaded) return undefined;
    const mapProblems = checkMapping(mapping, uploaded.columns);
    const built = replayBody({ fileId: uploaded.fileId, mapping, timeFormat, basis, at, acceleration: Number(acceleration), cloneSpaceId, cloneSuffix });
    const all = { ...mapProblems, ...built.problems };
    setProblems(all);
    return Object.keys(all).length ? undefined : built.body;
  };

  const dryRun = async () => {
    setError(null);
    const body = build();
    if (!body) return;
    const result = await api.replay(body, true);
    if (!result.ok) setError(failureText(t, result) ?? null);
    else setCount(result.data.total);
  };

  const start = async () => {
    setError(null);
    const body = build();
    if (!body) return;
    const result = await api.replay(body, false);
    if (!result.ok) setError(failureText(t, result) ?? null);
    else if (result.data.runId) navigate(`/sim/runs/${encodeURIComponent(result.data.runId)}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("sim.replay.uploadTitle")}>
        <Form method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
          <CsrfField />
          <input type="hidden" name="intent" value="upload" />
          <div className="flex flex-col gap-1">
            <label htmlFor="replay-file" className="text-[12.5px] font-medium text-muted">
              {t("sim.replay.file")}
            </label>
            <input
              id="replay-file"
              type="file"
              name="file"
              accept=".csv,.jsonl,.ndjson,.json"
              disabled={!canRun}
              onChange={(e) => {
                const file = e.target.files?.[0];
                setFileProblem(checkReplayFile(file ? { name: file.name, size: file.size } : null));
              }}
            />
          </div>
          <Button type="submit" variant="primary" disabled={!canRun || Boolean(fileProblem)}>
            {t("sim.replay.upload")}
          </Button>
          {fileProblem && (
            <p role="alert" className="w-full text-[12.5px] text-bad">
              {problemText(fileProblem)}
            </p>
          )}
        </Form>
        <p className="mt-2 text-[12px] text-muted">{t("sim.replay.uploadHint")}</p>
        {uploadError && (
          <div className="mt-3">
            <Alert tone="danger">
              {simErrorText(t, uploadError)}
              {uploadError.row ? ` ${t("sim.replay.errorRow", { row: uploadError.row, reason: uploadError.reason ?? "" })}` : ""}
            </Alert>
          </div>
        )}
      </Card>

      {uploaded && (
        <Card title={t("sim.replay.mappingTitle", { rows: uploaded.rows })}>
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField label={t("sim.replay.timeColumn")} value={mapping.time} onChange={(e) => setMapping({ ...mapping, time: e.target.value })} error={problemText(problems.time)}>
              <option value="">–</option>
              {uploaded.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("sim.replay.deviceColumn")} value={mapping.deviceId} onChange={(e) => setMapping({ ...mapping, deviceId: e.target.value })} error={problemText(problems.deviceId)}>
              <option value="">–</option>
              {uploaded.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("sim.replay.timeFormat")} value={timeFormat} onChange={(e) => setTimeFormat(e.target.value)}>
              {TIME_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </SelectField>
          </div>
          <fieldset className="mt-3 grid gap-2 md:grid-cols-3">
            <legend className="text-[12.5px] font-medium text-muted">{t("sim.replay.metricColumns")}</legend>
            {uploaded.columns
              .filter((c) => c !== mapping.time && c !== mapping.deviceId)
              .map((c) => (
                <TextField key={c} label={t("sim.replay.metricFor", { column: c })} value={mapping.metrics[c] ?? ""} onChange={(e) => setMapping({ ...mapping, metrics: { ...mapping.metrics, [c]: e.target.value } })} error={problemText(problems[`metric.${c}`])} />
              ))}
          </fieldset>
          {problems.metrics && (
            <p role="alert" className="mt-1 text-[12px] text-bad">
              {problemText(problems.metrics)}
            </p>
          )}
          <h3 className="mb-1 mt-4 text-[12.5px] font-semibold text-muted">{t("sim.replay.preview", { n: Math.min(20, uploaded.preview.length) })}</h3>
          <Table>
            <thead>
              <tr>
                {uploaded.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uploaded.preview.slice(0, 20).map((row, i) => (
                <tr key={i}>
                  {uploaded.columns.map((c) => (
                    <td key={c} className="font-mono">
                      {String(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {uploaded && (
        <Card title={t("sim.replay.optionsTitle")}>
          <div className="grid gap-3 md:grid-cols-3">
            <SelectField label={t("sim.replay.basis")} value={basis} onChange={(e) => setBasis(e.target.value as "NOW" | "AT")}>
              <option value="NOW">{t("sim.replay.basisNow")}</option>
              <option value="AT">{t("sim.replay.basisAt")}</option>
            </SelectField>
            {basis === "AT" && <TextField label={t("sim.replay.at")} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} error={problemText(problems.at)} />}
            <TextField label={t("sim.runOptions.acceleration")} inputMode="numeric" value={acceleration} onChange={(e) => setAcceleration(e.target.value)} error={problemText(problems.acceleration)} />
            <SelectField label={t("sim.replay.cloneSpace")} value={cloneSpaceId} onChange={(e) => setCloneSpaceId(e.target.value)} error={problemText(problems.cloneSpaceId)}>
              <option value="">–</option>
              {spaces.map((s) => (
                <option key={s.spaceId} value={s.spaceId}>
                  {s.name}
                </option>
              ))}
            </SelectField>
            <TextField label={t("sim.replay.cloneSuffix")} value={cloneSuffix} maxLength={40} onChange={(e) => setCloneSuffix(e.target.value)} />
          </div>
          {count !== null && <p className="mt-3 text-[13px]">{t("sim.replay.count", { n: count })}</p>}
          {error && (
            <p role="alert" className="mt-2 text-[12.5px] text-bad">
              {error}
            </p>
          )}
          {canRun && (
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={dryRun}>{t("sim.replay.dryRun")}</Button>
              <Button variant="primary" onClick={start}>
                {t("sim.replay.start")}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
