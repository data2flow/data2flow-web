/**
 * 라이브 뷰 부품(FLW-03.01~03.04, UI-FLW-02 실시간·하단 [디버그] 탭, UI-FLW-07 실행 추적).
 * - LiveBanner: 연결 상태(끊김 회색 띠 "다시 연결 중", 권한 없음), 처리 버전
 * - NodeInspector: 노드의 최근 메시지(입력·출력 나란히, 분기 포트, 가려진 메시지 "권한 밖 데이터"), 샘플 줄임 안내, [추적]
 * - TraceView: 노드 순서 타임라인(막대 길이 = 소요 시간), 오류 강조, 노드 누르면 캔버스에서 선택, 행동 노드 드라이런 표시
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, TextField, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { FlowApi } from "../api";
import type { LiveState, NodeSample } from "../model/live";
import type { Trace, TraceStep } from "../model/types";

export function LiveBanner({ live }: { live: LiveState }) {
  const { t } = useTranslation();
  if (live.connection === "reconnecting") {
    return (
      <div role="status" className="rounded-md border border-line bg-bg px-3 py-1.5 text-[12.5px] text-muted">
        {t("flows.live.reconnecting")}
      </div>
    );
  }
  if (live.connection === "denied") return <Alert tone="warning">{t("flows.live.denied")}</Alert>;
  if (live.connection === "ended") return <Alert tone="warning">{t("flows.live.ended")}</Alert>;
  return null;
}

export function LiveIndicator({ live }: { live: LiveState }) {
  const { t } = useTranslation();
  const on = live.connection === "open";
  return (
    <span className={cx("text-[12px]", on ? "text-good" : "text-muted")} title={live.version ? t("flows.live.version", { v: live.version }) : undefined}>
      ● {on ? t("flows.live.on") : t(`flows.live.state.${live.connection}`)}
    </span>
  );
}

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-40 overflow-auto rounded bg-bg p-1.5 font-mono text-[11px] leading-snug">{JSON.stringify(value, null, 2)}</pre>;
}

function SampleBody({ sample }: { sample: NodeSample | undefined }) {
  const { t } = useTranslation();
  if (!sample) return <p className="text-[11.5px] text-muted">–</p>;
  if (sample.masked) return <p className="text-[11.5px] italic text-muted">{t("flows.inspector.masked")}</p>;
  return <Json value={sample.payload} />;
}

/** 같은 메시지의 입력·출력을 한 줄로(최신이 위) */
export function pairSamples(samples: readonly NodeSample[]): { messageId: string; t: string; input?: NodeSample; outputs: NodeSample[] }[] {
  const rows = new Map<string, { messageId: string; t: string; input?: NodeSample; outputs: NodeSample[] }>();
  for (const s of samples) {
    const row = rows.get(s.messageId) ?? { messageId: s.messageId, t: s.t, outputs: [] };
    if (s.direction === "in") row.input = s;
    else row.outputs.push(s);
    rows.set(s.messageId, row);
  }
  return [...rows.values()];
}

export function NodeInspector({ nodeName, samples, skipped, droppedPerSec, timezone, onTrace }: { nodeName: string; samples: readonly NodeSample[]; skipped?: number; droppedPerSec?: number; timezone: string; onTrace?: (messageId: string) => void }) {
  const { t, i18n } = useTranslation();
  const rows = pairSamples(samples);
  return (
    <section aria-label={t("flows.inspector.label", { name: nodeName })} className="flex flex-col gap-2 text-[12.5px]">
      <p className="font-semibold">{t("flows.inspector.title", { name: nodeName })}</p>
      {(droppedPerSec ?? 0) > 0 && <p className="text-[11.5px] text-warn">{t("flows.inspector.sampling", { n: droppedPerSec })}</p>}
      {(skipped ?? 0) > 0 && <p className="text-[11.5px] text-muted">{t("flows.inspector.skipped", { n: skipped })}</p>}
      {rows.length === 0 ? (
        <p className="text-muted">{t("flows.inspector.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.messageId} className="rounded-md border border-line p-2">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                <span>{formatDateTime(row.t, timezone, i18n.language, true)}</span>
                <span className="font-mono">{row.messageId}</span>
                {row.outputs.map((o) => (
                  <span key={`${o.port}`} className={cx("rounded px-1 font-semibold", o.port === "error" ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent")}>
                    → {o.port ?? "out"}
                  </span>
                ))}
                {onTrace && (
                  <button type="button" className="ml-auto text-accent underline" onClick={() => onTrace(row.messageId)}>
                    {t("flows.inspector.trace")}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[11px] font-semibold text-muted">{t("flows.inspector.input")}</p>
                  <SampleBody sample={row.input} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-muted">{t("flows.inspector.output")}</p>
                  <SampleBody sample={row.outputs[0]} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 행동 노드 결과 문구: 드라이런·바이패스·아웃박스 기록 */
export function actionText(t: (key: string, options?: Record<string, unknown>) => string, step: TraceStep): string | undefined {
  const action = step.action;
  if (!action) return undefined;
  const kind = t(`flows.trace.kind.${action.kind}`, { defaultValue: action.kind });
  if (action.skipped) return t("flows.trace.skipped", { kind, reason: action.skipped });
  if (action.dryRun) return t("flows.trace.dryRun", { kind, summary: action.summary ?? "" }).trim();
  return t("flows.trace.recorded", { kind, key: action.idempotencyKey?.slice(0, 8) ?? "" });
}

export function TraceView({ trace, nameOf, timezone, onSelectNode }: { trace: Trace; nameOf: (id: string) => string; timezone: string; onSelectNode?: (nodeId: string) => void }) {
  const { t, i18n } = useTranslation();
  const max = Math.max(0.001, ...trace.steps.map((s) => s.durationMs ?? 0));
  const failedNode = trace.error?.nodeId;
  return (
    <section aria-label={t("flows.trace.label")} className="flex flex-col gap-2 text-[12.5px]">
      <p className="flex flex-wrap gap-2 text-muted">
        <span className="font-mono">{t("flows.trace.message", { id: trace.messageId })}</span>
        {trace.version !== undefined && <span>v{trace.version}</span>}
        {trace.startedAt && <span>{formatDateTime(trace.startedAt, timezone, i18n.language, true)}</span>}
        {trace.result && <span>{t(`flows.trace.result.${trace.result}`, { defaultValue: trace.result })}</span>}
      </p>
      {trace.steps.length === 0 && <p className="text-muted">{t("flows.trace.noSteps")}</p>}
      <ol className="flex flex-col gap-1">
        {trace.steps.map((step, i) => {
          const failed = Boolean(step.error) || step.nodeId === failedNode || step.outputs?.some((o) => o.port === "error");
          const ports = (step.outputs ?? []).map((o) => o.port).join(", ");
          const action = actionText(t, step);
          return (
            <li key={`${step.nodeId}-${i}`} data-testid="trace-step" className={cx("rounded-md border px-2 py-1", failed ? "border-bad bg-bad-soft" : "border-line")}>
              <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => onSelectNode?.(step.nodeId)}>
                <span className="w-40 truncate font-semibold">{nameOf(step.nodeId)}</span>
                <span className="relative h-2 w-40 rounded bg-bg" aria-hidden>
                  <span data-testid="trace-bar" className={cx("absolute inset-y-0 left-0 rounded", failed ? "bg-bad" : "bg-accent")} style={{ width: `${Math.max(2, Math.round(((step.durationMs ?? 0) / max) * 100))}%` }} />
                </span>
                <span className="font-mono text-[11.5px] text-muted">{t("flows.trace.ms", { ms: (step.durationMs ?? 0).toFixed(1) })}</span>
                {ports && <span className="text-[11.5px]">→ {ports}</span>}
                {action && <span className="text-[11.5px] text-accent">{action}</span>}
              </button>
              {step.error && (
                <p role="alert" className="text-[11.5px] text-bad">
                  {t("flows.trace.error", { code: step.error.code ?? step.error.errorType ?? "", message: step.error.message ?? "" })}
                  {step.error.line !== undefined ? ` ${t("flows.trace.line", { line: step.error.line })}` : ""}
                </p>
              )}
              <details className="text-[11.5px]">
                <summary className="cursor-pointer text-muted">{t("flows.trace.details")}</summary>
                <div className="grid grid-cols-2 gap-2">
                  <Json value={step.input ?? null} />
                  <Json value={step.outputs ?? []} />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      {trace.error && !trace.steps.some((s) => s.error) && (
        <p role="alert" className="text-bad">
          {t("flows.trace.error", { code: trace.error.code ?? trace.error.errorType ?? "", message: trace.error.message ?? "" })}
        </p>
      )}
    </section>
  );
}

/** 하단 [추적] 탭(UI-FLW-07): 메시지 ID로 추적을 불러온다(디버그 메시지에서 넘어오면 바로 불러옴) */
export function TracePanel({ flowId, api, initialMessageId, nameOf, timezone, onSelectNode }: { flowId: string; api: Pick<FlowApi, "trace">; initialMessageId?: string; nameOf: (id: string) => string; timezone: string; onSelectNode: (nodeId: string) => void }) {
  const { t } = useTranslation();
  const [messageId, setMessageId] = useState(initialMessageId ?? "");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (id: string) => {
      if (!id.trim()) return;
      setBusy(true);
      setError(undefined);
      const result = await api.trace(flowId, id.trim());
      setBusy(false);
      if (!result.ok) {
        setTrace(null);
        // 추적은 디버그를 켰거나 샘플된 메시지만 1시간 보관한다(API-FLW-41)
        setError(result.status === 404 ? t("flows.trace.notFound") : errorText(t, result));
        return;
      }
      setTrace(result.data);
    },
    [api, flowId, t],
  );
  useEffect(() => {
    if (initialMessageId) void load(initialMessageId);
  }, [initialMessageId, load]);
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(messageId);
        }}
      >
        <TextField label={t("flows.trace.messageId")} value={messageId} onChange={(e) => setMessageId(e.target.value)} hint={t("flows.trace.hint")} />
        <Button type="submit" disabled={busy || !messageId.trim()}>
          {busy ? t("common.processing") : t("flows.trace.load")}
        </Button>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      {trace && <TraceView trace={trace} nameOf={nameOf} timezone={timezone} onSelectNode={onSelectNode} />}
    </div>
  );
}
