/**
 * JS 함수 노드 [노드 시험 실행](UI-FLW-02 설정 패널, FLW-03.05·FLW-07 transform.js, §5.2 코드 계약).
 * 예시 메시지(플로우 메시지 모양 §5.1)를 넣고 이 노드부터(startNodeId) 지금 편집 중인 정의로 드라이런한다(API-FLW-12).
 * 결과는 이 노드의 출력 포트별 메시지, 실패하면 오류 코드(SCRIPT_ERROR·SCRIPT_TIMEOUT 등)와 줄 번호. 코드가 64KB를 넘으면 실행하지 않는다(FLW-10.01).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, TextArea } from "~/components/ui";
import type { BffJsonResult } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { JS_CODE_LIMIT_BYTES } from "../model/validation";
import type { Trace } from "../model/types";

export type NodeTestRunner = (nodeId: string, message: Record<string, unknown>) => Promise<BffJsonResult<{ trace: Trace }>>;

export const JS_SAMPLE_MESSAGE = {
  messageId: "00000000-0000-4000-8000-000000000001",
  topic: "telemetry",
  deviceId: 15,
  spaceId: 31,
  measuredAt: "2026-10-03T01:12:00Z",
  payload: { temperature: 28.1, humidity: 41 },
  metrics: [
    { key: "temperature", value: 28.1, unit: "℃", quality: 0 },
    { key: "humidity", value: 41, unit: "%", quality: 0 },
  ],
};

export function JsTestRun({ nodeId, code, runner }: { nodeId: string; code: string; runner?: NodeTestRunner }) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(JS_SAMPLE_MESSAGE, null, 2));
  const [error, setError] = useState<string | undefined>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const tooLarge = new TextEncoder().encode(code).length > JS_CODE_LIMIT_BYTES;
  const run = async () => {
    if (!runner || tooLarge) return;
    setError(undefined);
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
      message = parsed as Record<string, unknown>;
    } catch {
      setError(t("flows.test.invalidJson"));
      return;
    }
    setBusy(true);
    const result = await runner(nodeId, message);
    setBusy(false);
    if (!result.ok) {
      setTrace(null);
      setError(errorText(t, result));
      return;
    }
    setTrace(result.data.trace);
  };
  const step = trace?.steps.find((s) => s.nodeId === nodeId);
  const failure = step?.error ?? (trace?.error && (!trace.error.nodeId || trace.error.nodeId === nodeId) ? trace.error : null);
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-line p-2">
      <legend className="text-[12.5px] font-medium text-muted">{t("flows.jsTest.title")}</legend>
      <TextArea label={t("flows.jsTest.message")} rows={6} className="font-mono text-[11px]" value={text} onChange={(e) => setText(e.target.value)} />
      {!runner && <p className="text-[11.5px] text-muted">{t("flows.jsTest.saveFirst")}</p>}
      {tooLarge && <p className="text-[11.5px] text-bad-ink">{t("flows.jsTest.tooLarge", { max: JS_CODE_LIMIT_BYTES })}</p>}
      <div>
        <Button onClick={() => void run()} disabled={!runner || busy || tooLarge}>
          {busy ? t("common.processing") : t("flows.jsTest.run")}
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {failure && (
        <p role="alert" className="text-[12px] text-bad-ink">
          {t("flows.trace.error", { code: failure.code ?? failure.errorType ?? "SCRIPT_ERROR", message: failure.message ?? "" })}
          {failure.line !== undefined ? ` ${t("flows.trace.line", { line: failure.line })}` : ""}
        </p>
      )}
      {trace && !failure && (
        <ul aria-label={t("flows.jsTest.outputs")} className="flex flex-col gap-1 text-[11.5px]">
          {(step?.outputs ?? []).length === 0 ? (
            <li className="text-muted">{t("flows.jsTest.noOutput")}</li>
          ) : (
            (step?.outputs ?? []).map((o, i) => (
              <li key={`${o.port}-${i}`}>
                <span className="rounded bg-accent-soft px-1 font-semibold text-accent">{o.port}</span>
                <pre className="mt-0.5 max-h-40 overflow-auto rounded bg-bg p-1 font-mono">{JSON.stringify(o.payload ?? null, null, 2)}</pre>
              </li>
            ))
          )}
        </ul>
      )}
    </fieldset>
  );
}
