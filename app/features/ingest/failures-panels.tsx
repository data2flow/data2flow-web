/**
 * 실패 메시지 화면 부품(UI-ING-04, UI-ING-03): 재처리 결과 패널, 원본 메시지 상세 패널, 재처리 선택 막대.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, Table } from "~/components/ui";
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { MAX_REPROCESS, reprocessProblem, summarize, type ReprocessResult } from "./model/ingest";

export function ReprocessResultPanel({ result }: { result: ReprocessResult }) {
  const { t } = useTranslation();
  const counts = summarize(result);
  return (
    <Card title={t("ingest.failures.result.title")}>
      <p role="status" className="mb-2 flex flex-wrap gap-3 text-[13px]">
        {(["RESOLVED", "SAME_ERROR", "OTHER_ERROR", "LOCKED"] as const).map((k) => (
          <span key={k}>
            {t(`ingest.failures.outcome.${k}`)} <strong>{counts[k] ?? 0}</strong>
          </span>
        ))}
      </p>
      <Table>
        <thead>
          <tr>
            <th>ID</th>
            <th>{t("ingest.failures.result.outcome")}</th>
            <th>{t("ingest.failures.errorCode")}</th>
          </tr>
        </thead>
        <tbody>
          {result.results.map((r) => (
            <tr key={r.id}>
              <td className="font-mono">{r.id}</td>
              <td>
                <Badge tone={r.outcome === "RESOLVED" ? "success" : r.outcome === "LOCKED" ? "warning" : "danger"}>{t(`ingest.failures.outcome.${r.outcome}`, { defaultValue: r.outcome })}</Badge>
              </td>
              <td className="font-mono">{r.errorCode ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/** 선택 수에 따른 재처리 버튼 상태 문구(1~5,000건) */
export function SelectionNotice({ count }: { count: number }) {
  const { t } = useTranslation();
  const problem = reprocessProblem(count);
  if (problem === "tooMany") return <p role="alert" className="text-[12.5px] text-bad">{t("ingest.failures.tooMany", { max: MAX_REPROCESS.toLocaleString("en-US") })}</p>;
  return <span className="text-[12.5px] text-muted">{t("common.selectedCount", { n: count })}</span>;
}

export interface RawMessageDetail {
  id: string;
  receivedAt?: string;
  sourceId?: string;
  topic?: string;
  status?: string;
  errorCode?: string | null;
  errorDetail?: string | null;
  payload?: string | null;
  payloadEncoding?: string;
  trace?: { stage: string; ok: boolean; ms?: number; info?: string }[];
  canonical?: unknown;
  stored?: { metricKey: string; value: unknown; unit?: string | null; quality?: number; late?: boolean }[];
}

type Loader = (id: string) => Promise<BffJsonResult<RawMessageDetail>>;
const defaultLoader: Loader = (id) => bffJson<RawMessageDetail>(`/bff/api/core/ingest/raw-messages/${encodeURIComponent(id)}`);

/** 원본 메시지 상세(API-ING-06). payload는 INGEST_PAYLOAD_READ가 있을 때만 서버가 준다 */
export function RawMessagePanel({ rawMessageId, timezone, onClose, load = defaultLoader }: { rawMessageId: string; timezone: string; onClose: () => void; load?: Loader }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<{ id: string; result: BffJsonResult<RawMessageDetail> } | null>(null);
  useEffect(() => {
    let active = true;
    void load(rawMessageId).then((result) => {
      if (active) setState({ id: rawMessageId, result });
    });
    return () => {
      active = false;
    };
  }, [rawMessageId, load]);
  const result = state?.id === rawMessageId ? state.result : null;
  return (
    <Card title={t("ingest.raw.title", { id: rawMessageId })} actions={<Button onClick={onClose}>{t("common.close")}</Button>}>
      {!result && <p role="status" className="text-muted">{t("common.loading")}</p>}
      {result && !result.ok && <Alert tone="danger">{errorText(t, result)}</Alert>}
      {result?.ok && (
        <div className="flex flex-col gap-3 text-[13px]">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">{t("ingest.raw.receivedAt")}</dt>
            <dd className="font-mono">{formatDateTime(result.data.receivedAt, timezone, i18n.language, true)}</dd>
            <dt className="text-muted">{t("ingest.raw.topic")}</dt>
            <dd className="font-mono">{result.data.topic ?? "–"}</dd>
            <dt className="text-muted">{t("ingest.raw.status")}</dt>
            <dd>
              {result.data.status} {result.data.errorCode && <span className="font-mono text-bad">{result.data.errorCode}</span>} {result.data.errorDetail}
            </dd>
          </dl>
          {result.data.trace && (
            <ol aria-label={t("ingest.raw.trace")} className="flex flex-wrap gap-2">
              {result.data.trace.map((step) => (
                <li key={step.stage}>
                  <Badge tone={step.ok ? "success" : "danger"}>
                    {step.stage} {step.ms != null ? `${step.ms}ms` : ""} {step.info ?? ""}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-[11.5px] font-semibold text-muted">{t("ingest.stream.raw")}</p>
              {result.data.payload == null ? (
                <p className="text-muted">{t("ingest.stream.rawHidden")}</p>
              ) : (
                <pre className="max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-[12px]">{result.data.payload}</pre>
              )}
            </div>
            <div>
              <p className="text-[11.5px] font-semibold text-muted">{t("ingest.stream.canonical")}</p>
              <pre className="max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-[12px]">{result.data.canonical ? JSON.stringify(result.data.canonical, null, 2) : "–"}</pre>
            </div>
          </div>
          {result.data.stored && result.data.stored.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <th>{t("ingest.raw.metric")}</th>
                  <th>{t("ingest.raw.value")}</th>
                  <th>{t("ingest.raw.quality")}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.stored.map((s) => (
                  <tr key={s.metricKey}>
                    <td className="font-mono">{s.metricKey}</td>
                    <td className="font-mono">
                      {String(s.value)}
                      {s.unit ?? ""}
                    </td>
                    <td>{s.quality ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </Card>
  );
}
