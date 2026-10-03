/**
 * 단계별 연결 테스트 패널(UI-DSC-09, DSC-02.05, DSC-09.11). 설정 폼 오른쪽에 붙는다(모달 아님).
 * 단계(DNS·TCP·TLS·인증·구독) 상태와 ms, 실패 원인, 미리보기 메시지 최대 10건(원문 일부·디코딩 결과 펼침).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, cx } from "~/components/ui";
import { testOutcome, type TestPreview, type TestResult } from "../model/source";

const ICON: Record<string, string> = { OK: "✓", FAIL: "✗", SKIPPED: "–" };

export function ConnectionTestPanel({ result, testing, error, onRetry }: { result: TestResult | null; testing: boolean; error?: string | null; onRetry?: () => void }) {
  const { t } = useTranslation();
  const outcome = result ? testOutcome(result) : null;
  return (
    <Card
      title={t("sources.test.title")}
      actions={
        onRetry && (
          <Button onClick={onRetry} disabled={testing}>
            {t("sources.test.retry")}
          </Button>
        )
      }
    >
      {testing && (
        <p role="status" className="text-[13px] text-muted">
          {t("sources.test.running")}
        </p>
      )}
      {!testing && error && <Alert tone="danger">{error}</Alert>}
      {!testing && !result && !error && <p className="text-[13px] text-muted">{t("sources.test.idle")}</p>}
      {!testing && result && (
        <div className="flex flex-col gap-3">
          {outcome === "success" && <Alert tone="success">{t("sources.test.success", { n: result.preview.length })}</Alert>}
          {outcome === "partial" && <Alert tone="warning">{t("sources.test.partial")}</Alert>}
          {outcome === "failed" && <Alert tone="danger">{t("sources.test.failed")}</Alert>}
          {result.lossPossible && <Alert tone="warning">{t("sources.test.lossPossible")}</Alert>}
          <ol className="flex flex-col gap-1 text-[13px]" aria-label={t("sources.test.steps")}>
            {result.steps.map((step) => (
              <li key={step.name} className={cx("flex flex-wrap items-baseline gap-2", step.status === "FAIL" && "text-bad")}>
                <span aria-hidden className="w-4 font-mono">
                  {ICON[step.status] ?? "·"}
                </span>
                <span className="w-24 font-medium">{t(`sources.test.step.${step.name}`, { defaultValue: step.name })}</span>
                <span className="sr-only">{t(`sources.test.status.${step.status}`, { defaultValue: step.status })}</span>
                {step.ms !== undefined && step.ms !== null && <span className="font-mono text-muted">{step.ms}ms</span>}
                {step.code && <span className="font-mono">{step.code}</span>}
                {step.detail && <span className="text-muted">{step.detail}</span>}
                {step.tlsChain && step.tlsChain.length > 0 && (
                  <ul className="w-full pl-6 text-[12px] text-muted">
                    {step.tlsChain.map((c, i) => (
                      <li key={i}>{t("sources.test.chain", { subject: c.subject ?? "–", issuer: c.issuer ?? "–", notAfter: c.notAfter ?? "–" })}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {result.preview.length > 0 && (
            <div>
              <p className="mb-1 text-[12px] font-semibold text-muted">{t("sources.test.preview", { n: Math.min(10, result.preview.length) })}</p>
              <ul className="flex flex-col gap-1">
                {result.preview.slice(0, 10).map((p, i) => (
                  <PreviewRow key={i} preview={p} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function decodedText(decoded: TestPreview["decoded"]): string {
  if (!decoded) return "";
  const d = decoded as { externalId?: string | null; metrics?: { key: string; value: unknown; unit?: string | null }[] };
  if (Array.isArray(d.metrics)) return [d.externalId ?? "", ...d.metrics.map((m) => `${m.key} ${String(m.value)}${m.unit ?? ""}`)].filter(Boolean).join(" · ");
  return JSON.stringify(decoded);
}

function PreviewRow({ preview }: { preview: TestPreview }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded border border-line px-2 py-1 text-[12px]">
      <button type="button" className="flex w-full flex-wrap gap-2 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="font-mono">{preview.topic}</span>
        <span className="text-muted">{preview.size}B</span>
        {preview.decoded && <span>→ {decodedText(preview.decoded)}</span>}
      </button>
      {open && (
        <div className="mt-1 grid gap-2 md:grid-cols-2">
          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1 font-mono">{preview.rawExcerpt}</pre>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1 font-mono">{preview.decoded ? JSON.stringify(preview.decoded, null, 2) : t("sources.test.noDecoded")}</pre>
        </div>
      )}
    </li>
  );
}
