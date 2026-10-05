/**
 * UI-AIA-02 스크립트 작성 도우미 패널(AIA-04.01~04.03, SCR-03.07, API-AIA-03). 스크립트 편집기 오른쪽에 붙는다(SCRIPT_WRITE + AI_USE).
 * 원본 샘플(최근 원본 메시지 또는 붙여넣기)과 요구사항으로 초안을 만들면 ai가 정적 검사 → 시험 실행까지 한 결과를 함께 준다.
 * 시험이 실패하면 [오류로 고쳐 달라고 하기]로 이어서 요청한다(이전 시도 ID, 시도 5회까지 — 6번째는 서버가 400 ATTEMPT_LIMIT).
 * [편집기에 넣기]는 편집기 내용만 바꾼다. 저장·배포는 사람이 기존 버튼으로 한다(BR-AIA-07a).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, SelectField, TextArea } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { AiApi } from "../api";
import { MAX_ASSIST_ATTEMPTS, type ScriptAssist } from "../model/types";

export interface RawSampleOption {
  id: string;
  receivedAt?: string;
  topic?: string;
  deviceName?: string | null;
}

const REQUIREMENT_MAX = 1000;

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** 시험 오류가 정적 검사 문제({severity, code, message, line, col})인가 */
function staticProblem(error: unknown): { code?: string; message?: string; line?: number; col?: number } | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const e = error as Record<string, unknown>;
  return "severity" in e || "line" in e ? { code: e.code as string, message: e.message as string, line: e.line as number, col: e.col as number } : null;
}

export function ScriptAssistPanel({ scriptId, kind, recent, api, onInsert }: { scriptId: string; kind: "DECODE" | "TRANSFORM"; recent: RawSampleOption[]; api: AiApi; onInsert: (code: string) => void }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<"DECODE" | "TRANSFORM">(kind);
  const [sampleId, setSampleId] = useState(recent[0]?.id ?? "");
  const [pasted, setPasted] = useState("");
  const [requirement, setRequirement] = useState("");
  const [busy, setBusy] = useState(false);
  const [assist, setAssist] = useState<ScriptAssist | null>(null);
  const [error, setError] = useState<{ code: string; message?: string } | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [inserted, setInserted] = useState(false);

  const sample = () => {
    if (sampleId) return { rawMessageId: sampleId };
    try {
      return { payload: pasted.trim() ? JSON.parse(pasted) : null };
    } catch {
      return { payload: pasted };
    }
  };

  const request = async (previous: ScriptAssist | null) => {
    const text = requirement.trim();
    if (!text || text.length > REQUIREMENT_MAX) {
      setInputError(t("ai.script.requirementRule", { max: REQUIREMENT_MAX }));
      return;
    }
    if (!sampleId && !pasted.trim()) {
      setInputError(t("ai.script.sampleRequired"));
      return;
    }
    setInputError(null);
    setBusy(true);
    setError(null);
    setInserted(false);
    const res = await api.scriptAssist({ scriptId, stage, sample: sample(), requirement: text, ...(previous ? { previousAttemptId: previous.assistId } : {}) });
    setBusy(false);
    if (res.ok) setAssist(res.data);
    else if (res.errors?.some((e) => e.code === "ATTEMPT_LIMIT")) setError({ code: "ATTEMPT_LIMIT" });
    else setError({ code: res.code, message: res.message });
  };

  const attempt = assist?.attempt ?? 0;
  const failed = assist?.test?.status === "FAIL";
  const exhausted = attempt >= MAX_ASSIST_ATTEMPTS || error?.code === "ATTEMPT_LIMIT";
  const problem = staticProblem(assist?.test?.error);
  const unavailable = error?.code === "AI_PROVIDER_UNAVAILABLE" || error?.code === "AI_DISABLED";

  return (
    <Card title={t("ai.script.title")}>
      <div className="flex flex-col gap-2">
        <SelectField label={t("ai.script.sample")} value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
          <option value="">{t("ai.script.paste")}</option>
          {recent.slice(0, 10).map((r) => (
            <option key={r.id} value={r.id}>
              {[`#${r.id}`, r.deviceName, r.topic].filter(Boolean).join(" · ")}
            </option>
          ))}
        </SelectField>
        {!sampleId && <TextArea label={t("ai.script.pasteLabel")} rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} />}
        <SelectField label={t("ai.script.stage")} value={stage} onChange={(e) => setStage(e.target.value as "DECODE")}>
          <option value="DECODE">DECODE</option>
          <option value="TRANSFORM">TRANSFORM</option>
        </SelectField>
        <TextArea label={t("ai.script.requirement")} rows={3} maxLength={REQUIREMENT_MAX} value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder={t("ai.script.requirementPlaceholder")} error={inputError ?? undefined} />
        <div className="flex justify-end">
          <Button variant="primary" disabled={busy} onClick={() => void request(null)}>
            {busy && !assist ? t("ai.script.generating") : t("ai.script.draft")}
          </Button>
        </div>
        {unavailable && (
          <Alert tone="info">
            <strong>{t("ai.unavailable.title")}</strong> {error?.code === "AI_DISABLED" ? t("ai.unavailable.disabled") : t("ai.unavailable.script")}
          </Alert>
        )}
        {error && !unavailable && error.code !== "ATTEMPT_LIMIT" && <Alert tone="danger">{errorText(t, error)}</Alert>}
        {assist && (
          <section aria-label={t("ai.script.result")} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone="info">{t("ai.script.aiWritten")}</Badge>
              <span className="text-muted">{t("ai.script.attempt", { n: attempt, max: MAX_ASSIST_ATTEMPTS })}</span>
              {assist.test && (
                <Badge tone={assist.test.status === "PASS" ? "success" : "danger"}>
                  {t(`ai.script.test.${assist.test.status}`)}
                  {assist.test.durationMs != null ? ` ${Math.round(assist.test.durationMs * 10) / 10}ms` : ""}
                </Badge>
              )}
            </div>
            {assist.explanation && <p className="text-[12.5px] text-muted">{assist.explanation}</p>}
            <pre aria-label={t("ai.script.code")} className="max-h-60 overflow-auto rounded border border-line bg-bg p-2 font-mono text-[11.5px]">
              {assist.code}
            </pre>
            {problem && (
              <Alert tone="danger">
                {t("ai.script.staticProblem", { line: problem.line ?? "–", col: problem.col ?? "–" })} {problem.message ?? problem.code}
              </Alert>
            )}
            {assist.test && !problem && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[12px]">
                {(["input", "output", "diff", "error"] as const).map((k) =>
                  assist.test?.[k] !== undefined && assist.test?.[k] !== null ? (
                    <div key={k} className="contents">
                      <dt className="text-muted">{t(`ai.script.testField.${k}`)}</dt>
                      <dd>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{pretty(assist.test[k])}</pre>
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {failed && !exhausted && (
                <Button disabled={busy} onClick={() => void request(assist)}>
                  {t("ai.script.fix", { n: attempt, max: MAX_ASSIST_ATTEMPTS })}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => {
                  onInsert(assist.code);
                  setInserted(true);
                }}
              >
                {t("ai.script.insert")}
              </Button>
            </div>
            {failed && exhausted && <Alert tone="warning">{t("ai.script.exhausted")}</Alert>}
            {inserted && <Alert tone="success">{t("ai.script.inserted")}</Alert>}
          </section>
        )}
        {!assist && error?.code === "ATTEMPT_LIMIT" && <Alert tone="warning">{t("ai.script.exhausted")}</Alert>}
      </div>
    </Card>
  );
}
