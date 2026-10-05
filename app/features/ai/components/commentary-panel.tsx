/**
 * 결과 화면의 AI 해설 패널(UI-ANA-05 오른쪽 "AI 해설", ANA-05.04, AIA-01.01~01.03, AIA-07.01).
 * - [AI 해설 만들기]·[다시 만들기](regenerate=true)는 API-AIA-01 스트림: 숫자 검증을 마친 문장만 `delta`로 오고, `verification`·`done`이 잇는다
 * - 검증 상태: VERIFIED "숫자 확인됨", UNVERIFIED는 경고 띠와 불일치 숫자 강조(1회 재생성 뒤에도 틀린 숫자, BR-AIA-02)
 * - 본문 숫자는 근거(핵심 수치 카드·표·차트)로 옮겨 가는 링크, 아래 "근거" 목록에도 같은 링크(AIA-01.02)
 * - 이전 판은 접어서 보여 준다(AIA-01.03). AI가 조직에서 꺼져 있으면 부모가 이 패널을 그리지 않는다(TC-AIA-066)
 * - 제공자가 없거나(NONE) 연결이 안 되면 503 AI_PROVIDER_UNAVAILABLE → "AI 사용 불가"로 안내하고 결과는 그대로 둔다(NFR-02.07)
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AiMark, Alert, Badge, Button } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { AiApi } from "../api";
import type { Citation, Commentary, Mismatch } from "../model/types";
import { AiMarkdown, type CiteHandler } from "./ai-markdown";

export function VerificationBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone = status === "VERIFIED" ? "success" : status === "UNVERIFIED" ? "warning" : status === "FAILED" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(`ai.verification.${status}`, { defaultValue: status })}</Badge>;
}

function citationsFrom(content: string): Citation[] {
  const out: Citation[] = [];
  for (const m of content.matchAll(/\[([^\]]+)\]\(#result-(metric|table|chart)-([^)\s]+)\)/g)) out.push({ text: m[1], target: { type: m[2].toUpperCase(), id: m[3] } });
  return out;
}

function CommentaryBody({ commentary, citations, onCite }: { commentary: Pick<Commentary, "status" | "contentMd" | "mismatches">; citations: Citation[]; onCite: CiteHandler }) {
  const { t } = useTranslation();
  const mismatches = (commentary.mismatches ?? []).map((m) => m.value).filter(Boolean);
  return (
    <div className="flex flex-col gap-2">
      {commentary.status === "UNVERIFIED" && (
        <Alert tone="warning">
          {t("ai.commentary.unverified")}
          {mismatches.length > 0 && <span className="block text-[12px]">{t("ai.commentary.mismatches", { values: mismatches.join(", ") })}</span>}
        </Alert>
      )}
      <AiMarkdown text={commentary.contentMd} onCite={onCite} mismatches={commentary.status === "UNVERIFIED" ? mismatches : []} />
      {citations.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-muted">{t("ai.commentary.evidence")}</p>
          <ul className="flex flex-col gap-0.5 text-[12.5px]">
            {citations.map((c, i) => (
              <li key={i}>
                <button type="button" onClick={() => onCite(`result-${c.target.type.toLowerCase()}-${c.target.id}`)} className="text-accent hover:underline">
                  {t("ai.commentary.cite", { text: c.text, target: t(`ai.commentary.target.${c.target.type}`, { defaultValue: c.target.type }), id: c.target.id })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface CommentaryPanelProps {
  runId: string;
  analysisId: string;
  initial: Commentary[];
  /** 해설을 만들 수 있는가(SUCCEEDED 실행, ANALYTICS_RUN + AI_USE) */
  canGenerate: boolean;
  api: AiApi;
  timezone: string;
  onCite: CiteHandler;
  /** 조직 AI가 꺼진 것을 알게 되면(409 AI_DISABLED) 부모에 알린다 */
  onDisabled?: () => void;
}

export function CommentaryPanel({ runId, analysisId, initial, canGenerate, api, timezone, onCite, onDisabled }: CommentaryPanelProps) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Commentary[]>(initial);
  const [streaming, setStreaming] = useState<{ text: string; status?: string; mismatches?: Mismatch[] } | null>(null);
  const [lastCitations, setLastCitations] = useState<Citation[] | null>(null);
  const [error, setError] = useState<{ code: string; message?: string } | null>(null);
  const latest = items[0];
  const older = items.slice(1);

  const generate = async (regenerate: boolean) => {
    setError(null);
    setStreaming({ text: "" });
    let text = "";
    let verification: { status?: string; mismatches?: Mismatch[] } = {};
    let done: { commentaryId?: string; model?: string; citations?: Citation[] } = {};
    const outcome = await api.streamCommentary({ subjectType: "ANALYSIS_RUN", subjectId: runId, analysisId, regenerate }, (e) => {
      if (e.event === "delta") {
        text += String((e.data as { text?: string })?.text ?? "");
        setStreaming((s) => ({ ...s, text }));
      } else if (e.event === "verification") {
        verification = e.data as typeof verification;
        setStreaming((s) => ({ text: s?.text ?? text, ...verification }));
      } else if (e.event === "done") done = e.data as typeof done;
    });
    setStreaming(null);
    if (!outcome.ok) {
      if (outcome.code === "AI_DISABLED") onDisabled?.();
      setError({ code: outcome.code, message: outcome.message });
      return;
    }
    // 저장된 판을 다시 읽는다(이전 판 보존·supersededBy). 못 읽으면 스트림 내용으로 맨 앞에 둔다
    const fresh = await api.listCommentaries(runId);
    if (fresh.ok && fresh.data.responses.length > 0) setItems(fresh.data.responses);
    else
      setItems((list) => [
        { commentaryId: done.commentaryId ?? `local-${list.length}`, subjectType: "ANALYSIS_RUN", subjectId: runId, status: (verification.status as Commentary["status"]) ?? "VERIFIED", contentMd: text, model: done.model ?? null, mismatches: verification.mismatches ?? [], createdAt: new Date().toISOString() },
        ...list,
      ]);
    setLastCitations(done.citations ?? null);
  };

  const unavailable = error?.code === "AI_PROVIDER_UNAVAILABLE";
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {canGenerate && (
        <div className="flex flex-wrap gap-2">
          <Button variant="ai" disabled={streaming !== null} onClick={() => void generate(Boolean(latest))}>
            {streaming ? t("ai.commentary.generating") : latest ? t("ai.commentary.regenerate") : t("ai.commentary.generate")}
          </Button>
        </div>
      )}
      {unavailable && (
        <Alert tone="info">
          <strong>{t("ai.unavailable.title")}</strong> {t("ai.unavailable.commentary")}
        </Alert>
      )}
      {error && !unavailable && <Alert tone={error.code === "AI_QUOTA_EXCEEDED" ? "warning" : "danger"}>{errorText(t, error)}</Alert>}
      {streaming && (
        <div data-testid="commentary-streaming" className="rounded-md border border-line p-3">
          <AiMarkdown text={streaming.text || "…"} />
          <span aria-hidden className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent align-middle" />
        </div>
      )}
      {!streaming && latest && (
        <section className="rounded-lg border border-line bg-panel p-3 shadow-[inset_3px_0_0_var(--d2f-accent)]" aria-label={t("ai.commentary.latest")}>
          <header className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <AiMark />
            <VerificationBadge status={latest.status} />
            {latest.model && <span>{latest.model}</span>}
            {latest.createdAt && <span>{formatDateTime(latest.createdAt, timezone, i18n.language)}</span>}
            <span className="ml-auto">{t("ai.commentary.aiNote")}</span>
          </header>
          <CommentaryBody commentary={latest} citations={lastCitations ?? citationsFrom(latest.contentMd)} onCite={onCite} />
        </section>
      )}
      {!streaming && !latest && !error && <p className="text-[13px] text-muted">{canGenerate ? t("ai.commentary.none") : t("ai.commentary.noneReadOnly")}</p>}
      {older.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[12.5px] text-muted">{t("ai.commentary.older", { n: older.length })}</summary>
          <ol className="mt-2 flex flex-col gap-2">
            {older.map((c) => (
              <li key={c.commentaryId} className="rounded-md border border-line p-2 opacity-90">
                <p className="mb-1 flex items-center gap-2 text-[12px] text-muted">
                  <VerificationBadge status={c.status} />
                  {c.createdAt && formatDateTime(c.createdAt, timezone, i18n.language)}
                </p>
                <AiMarkdown text={c.contentMd} onCite={onCite} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
