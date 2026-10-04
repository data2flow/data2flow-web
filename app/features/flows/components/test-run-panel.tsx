/**
 * 하단 [시험 실행] 탭(UI-FLW-06, FLW-03.05·03.06).
 * - 시험 실행(API-FLW-12): 최근 원본 메시지(API-ING-05, 최근 24시간) 또는 직접 입력한 표준 메시지로 지금 편집 중인 정의를 끝까지 실행.
 *   행동 노드는 "드라이런(실행 안 함)"으로만 보인다(BR-FLW-11)
 * - 과거 재생(API-FLW-13): 기간 최대 7일, 대상 기기 선택 → 202 jobId → 2초마다 진행률 → 실행 수·분기별 건수·제어·알림·Sink·오류.
 *   분기별 건수는 캔버스 노드 포트 옆에 겹쳐 보인다
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, SelectField, TextArea, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime, zonedDate } from "~/lib/format";
import type { FlowApi, TestRunInput } from "../api";
import { REPLAY_POLL_MS, checkTestMessage, replayDone, replayPercent, replayRange, sampleMessage, toCanonicalTelemetry } from "../model/test-run";
import type { FlowDefinition, RawMessageRow, ReplayJob, Trace } from "../model/types";
import type { TargetDevice } from "./target-field";
import { TraceView } from "./live-panels";

export interface TestRunPanelProps {
  flowId: string;
  /** 재생할 저장 버전(초안 → 실행 버전) */
  version: number | null;
  dirty: boolean;
  definition: () => FlowDefinition;
  api: Pick<FlowApi, "testRun" | "replay" | "replayJob" | "cancelReplay" | "rawMessages">;
  devices: TargetDevice[];
  timezone: string;
  now?: () => number;
  nameOf: (id: string) => string;
  onSelectNode: (nodeId: string) => void;
  onReplayCounts: (counts: Record<string, Record<string, number>> | null) => void;
}

export function TestRunPanel(props: TestRunPanelProps) {
  const { t, i18n } = useTranslation();
  const { flowId, api, timezone } = props;
  const now = props.now ?? Date.now;
  const [mode, setMode] = useState<"recent" | "custom">("recent");
  const [recent, setRecent] = useState<RawMessageRow[] | null>(null);
  const [rawId, setRawId] = useState("");
  const [text, setText] = useState(() => JSON.stringify(sampleMessage(new Date(now()).toISOString(), props.devices[0]?.id, props.devices[0]?.spaceId), null, 2));
  const [inputError, setInputError] = useState<string | undefined>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [runError, setRunError] = useState<string | undefined>();
  const [running, setRunning] = useState(false);

  const [fromDate, setFromDate] = useState(() => zonedDate(now(), timezone, -6));
  const [toDate, setToDate] = useState(() => zonedDate(now(), timezone));
  const [deviceId, setDeviceId] = useState("");
  const [rangeError, setRangeError] = useState<string | undefined>();
  const [job, setJob] = useState<ReplayJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "recent" || recent !== null) return;
    let cancelled = false;
    const to = new Date(now()).toISOString();
    const from = new Date(now() - 86_400_000).toISOString();
    void api.rawMessages({ from, to }).then((result) => {
      if (cancelled) return;
      const rows = result.ok ? (result.data.responses ?? []) : [];
      setRecent(rows);
      if (rows[0]) setRawId(String(rows[0].id));
    });
    return () => {
      cancelled = true;
    };
  }, [mode, recent, api, now]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const run = async () => {
    setInputError(undefined);
    setRunError(undefined);
    let input: TestRunInput;
    if (mode === "recent") {
      if (!rawId) {
        setInputError(t("flows.test.pickMessage"));
        return;
      }
      input = { rawMessageId: rawId };
    } else {
      const checked = checkTestMessage(text);
      if (!checked.ok) {
        setInputError(checked.error === "json" ? t("flows.test.invalidJson") : t("flows.test.invalidSchema", { field: checked.field ?? "" }));
        return;
      }
      input = { message: toCanonicalTelemetry(checked.message, new Date(now()).toISOString()) };
    }
    setRunning(true);
    const result = await api.testRun(flowId, { definition: props.definition(), input });
    setRunning(false);
    if (!result.ok) {
      setTrace(null);
      setRunError(errorText(t, result));
      return;
    }
    setTrace(result.data.trace);
  };

  const poll = (id: string) => {
    timer.current = setTimeout(async () => {
      timer.current = null;
      const result = await api.replayJob(id);
      if (!result.ok) {
        setReplayError(errorText(t, result));
        return;
      }
      setJob(result.data);
      if (result.data.status === "SUCCEEDED") props.onReplayCounts(result.data.result?.branchCounts ?? null);
      if (!replayDone(result.data)) poll(id);
    }, REPLAY_POLL_MS);
  };

  const startReplay = async () => {
    setRangeError(undefined);
    setReplayError(undefined);
    const range = replayRange(fromDate, toDate, timezone);
    if (!range.ok) {
      setRangeError(t(`flows.replay.range.${range.error}`, { days: 7 }));
      return;
    }
    if (props.version === null) {
      setReplayError(t("flows.replay.notSaved"));
      return;
    }
    props.onReplayCounts(null);
    const result = await api.replay(flowId, { version: props.version, from: range.from, to: range.to, deviceIds: deviceId ? [deviceId] : undefined });
    if (!result.ok) {
      setReplayError(result.code === "FLOW_REPLAY_TOO_LARGE" ? t("flows.replay.tooLarge") : errorText(t, result));
      return;
    }
    setJobId(result.data.jobId);
    setJob({ jobId: result.data.jobId, status: result.data.status ?? "QUEUED" });
    poll(result.data.jobId);
  };

  const cancelReplay = async () => {
    if (!jobId) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const result = await api.cancelReplay(jobId);
    if (!result.ok) {
      setReplayError(errorText(t, result));
      return;
    }
    setJob(result.data);
    if (!replayDone(result.data)) poll(jobId);
  };

  const outcome = job?.result;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-label={t("flows.test.title")} className="flex flex-col gap-2 text-[12.5px]">
        <p className="font-semibold">{t("flows.test.title")}</p>
        <div role="radiogroup" aria-label={t("flows.test.inputMode")} className="flex gap-3">
          {(["recent", "custom"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="radio" name="test-input-mode" checked={mode === m} onChange={() => setMode(m)} />
              {t(`flows.test.mode.${m}`)}
            </label>
          ))}
        </div>
        {mode === "recent" ? (
          recent && recent.length === 0 ? (
            <p className="text-muted">{t("flows.test.noRecent")}</p>
          ) : (
            <SelectField label={t("flows.test.recent")} value={rawId} onChange={(e) => setRawId(e.target.value)}>
              {(recent ?? []).map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {`${r.deviceName ?? r.deviceId ?? r.topic ?? ""} · ${formatDateTime(r.receivedAt, timezone, i18n.language, true)}`}
                </option>
              ))}
            </SelectField>
          )
        ) : (
          <TextArea label={t("flows.test.message")} rows={10} className="font-mono text-[11.5px]" value={text} onChange={(e) => setText(e.target.value)} />
        )}
        {inputError && (
          <p role="alert" className="text-bad">
            {inputError}
          </p>
        )}
        <p className="text-muted">{props.dirty ? t("flows.test.usesEdits") : t("flows.test.dryRunNote")}</p>
        <div>
          <Button variant="primary" onClick={() => void run()} disabled={running}>
            {running ? t("common.processing") : t("flows.test.run")}
          </Button>
        </div>
        {runError && <Alert tone="danger">{runError}</Alert>}
        {trace && <TraceView trace={trace} nameOf={props.nameOf} timezone={timezone} onSelectNode={props.onSelectNode} />}
      </section>
      <section aria-label={t("flows.replay.title")} className="flex flex-col gap-2 text-[12.5px]">
        <p className="font-semibold">{t("flows.replay.title")}</p>
        <div className="flex flex-wrap gap-2">
          <TextField label={t("flows.replay.from")} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <TextField label={t("flows.replay.to")} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <SelectField label={t("flows.replay.device")} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">{t("flows.replay.allDevices")}</option>
            {props.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        </div>
        {rangeError && (
          <p role="alert" className="text-bad">
            {rangeError}
          </p>
        )}
        {props.dirty && <p className="text-muted">{t("flows.replay.savedOnly", { v: props.version ?? "–" })}</p>}
        <div>
          <Button onClick={() => void startReplay()} disabled={Boolean(job && !replayDone(job))}>
            {t("flows.replay.start")}
          </Button>
          {job && !replayDone(job) && (
            <Button className="ml-2" onClick={() => void cancelReplay()}>
              {t("flows.replay.cancel")}
            </Button>
          )}
        </div>
        {replayError && <Alert tone="danger">{replayError}</Alert>}
        {job && (
          <div className="flex flex-col gap-1" data-job-id={jobId ?? undefined}>
            <p>{t(`flows.replay.status.${job.status}`)}</p>
            <div role="progressbar" aria-label={t("flows.replay.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={replayPercent(job)} className="h-2 w-full rounded bg-bg">
              <div className="h-2 rounded bg-accent" style={{ width: `${replayPercent(job)}%` }} />
            </div>
            {job.progress && (
              <p className="text-muted">
                {job.progress.total == null ? t("flows.replay.processedSoFar", { processed: job.progress.processed }) : t("flows.replay.processed", { processed: job.progress.processed, total: job.progress.total })}
              </p>
            )}
            {job.status === "FAILED" && job.error && <Alert tone="danger">{job.error}</Alert>}
            {outcome && (
              <>
                <p className="font-semibold">{t("flows.replay.summary", { executions: outcome.executions, command: outcome.actions.command, notify: outcome.actions.notify, sink: outcome.actions.sink, errors: outcome.errors })}</p>
                <ul className="flex flex-col gap-0.5">
                  {Object.entries(outcome.branchCounts ?? {}).map(([nodeId, ports]) => (
                    <li key={nodeId}>
                      {props.nameOf(nodeId)}:{" "}
                      {Object.entries(ports)
                        .map(([port, n]) => `${port} ${n}`)
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
                <p className="text-muted">{t("flows.replay.noRealActions")}</p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
