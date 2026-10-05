/**
 * 단계별 연결 테스트 패널(UI-DSC-09, DSC-02.05, DSC-09.11). 설정 폼 오른쪽에 붙는다(모달 아님).
 * 단계(DNS·TCP·TLS·인증·구독, 폴링형은 첫 폴링) 상태 아이콘(대기·진행·성공·실패·건너뜀)과 ms, 실패 원인 코드,
 * TLS 단계는 성공 시 버전·발급자·만료일, 실패 시 [서버 인증서 체인 보기]. 미리보기 메시지 최대 10건(원문 일부·디코딩 결과 펼침, [원문 복사]).
 * 제한 시간(기본 15초, 최대 30초)이 지나도 응답이 없으면 "시간 초과"로 끝난다(TC-DSC-302).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, cx } from "~/components/ui";
import { TEST_TIMEOUT_SEC, isFailedStep, testOutcome, type TestPreview, type TestResult, type TestStep } from "../model/source";

const ICON: Record<string, string> = { OK: "✓", FAILED: "✗", FAIL: "✗", SKIPPED: "–", PENDING: "○", RUNNING: "◌" };

/** 테스트 전·중 단계 목록: 폴링형은 구독 대신 첫 폴링(TC-DSC-301) */
export function plannedSteps(polling: boolean): string[] {
  return ["DNS", "TCP", "TLS", "AUTH", polling ? "POLL" : "SUBSCRIBE"];
}

export function ConnectionTestPanel({
  result,
  testing,
  error,
  onRetry,
  timeoutSec = TEST_TIMEOUT_SEC,
  timedOut = false,
  polling = false,
}: {
  result: TestResult | null;
  testing: boolean;
  error?: string | null;
  onRetry?: () => void;
  timeoutSec?: number;
  timedOut?: boolean;
  polling?: boolean;
}) {
  const { t } = useTranslation();
  const outcome = result ? testOutcome(result) : null;
  const idleSteps: TestStep[] = plannedSteps(polling).map((name, i) => ({ name, status: testing && i === 0 ? "RUNNING" : "PENDING" }));
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
          {t("sources.test.running", { seconds: timeoutSec })}
        </p>
      )}
      {!testing && timedOut && <Alert tone="danger">{t("sources.test.timedOut", { seconds: timeoutSec })}</Alert>}
      {!testing && error && <Alert tone="danger">{error}</Alert>}
      {!testing && !result && !error && !timedOut && <p className="text-[13px] text-muted">{t("sources.test.idle")}</p>}
      {(!result || testing) && <StepList steps={idleSteps} />}
      {!testing && result && (
        <div className="flex flex-col gap-3">
          {outcome === "success" && <Alert tone="success">{t("sources.test.success", { n: result.preview.length })}</Alert>}
          {outcome === "partial" && <Alert tone="warning">{t("sources.test.partial")}</Alert>}
          {outcome === "failed" && <Alert tone="danger">{t("sources.test.failed")}</Alert>}
          {result.lossPossible && <Alert tone="warning">{t("sources.test.lossPossible")}</Alert>}
          <StepList steps={result.steps} />
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

function StepList({ steps }: { steps: TestStep[] }) {
  const { t } = useTranslation();
  return (
    <ol className="flex flex-col gap-1 text-[13px]" aria-label={t("sources.test.steps")}>
      {steps.map((step) => (
        <StepRow key={step.name} step={step} />
      ))}
    </ol>
  );
}

function StepRow({ step }: { step: TestStep }) {
  const { t } = useTranslation();
  const [chainOpen, setChainOpen] = useState(false);
  const failed = isFailedStep(step.status);
  const chain = step.tlsChain ?? [];
  const leaf = chain[0];
  return (
    <li className={cx("flex flex-wrap items-baseline gap-2", failed && "text-bad-ink", (step.status === "PENDING" || step.status === "SKIPPED") && "text-muted")}>
      <span aria-hidden className="w-4 font-mono">
        {ICON[step.status] ?? "·"}
      </span>
      <span className="w-24 font-medium">{t(`sources.test.step.${step.name}`, { defaultValue: step.name })}</span>
      <span className="sr-only">{t(`sources.test.status.${step.status}`, { defaultValue: step.status })}</span>
      {step.ms !== undefined && step.ms !== null && <span className="font-mono text-muted">{step.ms}ms</span>}
      {step.code && <span className="font-mono">{t(`sources.test.code.${step.code}`, { defaultValue: step.code })}</span>}
      {step.detail && <span className="text-muted">{step.detail}</span>}
      {step.name === "TLS" && !failed && leaf && <span className="text-muted">{t("sources.test.tlsInfo", { issuer: leaf.issuer ?? "–", notAfter: leaf.notAfter ?? "–" })}</span>}
      {chain.length > 0 && failed && (
        <Button variant="ghost" aria-expanded={chainOpen} onClick={() => setChainOpen((v) => !v)}>
          {t("sources.test.showChain")}
        </Button>
      )}
      {chain.length > 0 && (!failed || chainOpen) && (
        <ul className="w-full pl-6 text-[12px] text-muted" aria-label={t("sources.test.chainLabel")}>
          {chain.map((c, i) => (
            <li key={i}>{t("sources.test.chain", { subject: c.subject ?? "–", issuer: c.issuer ?? "–", notAfter: c.notAfter ?? "–" })}</li>
          ))}
        </ul>
      )}
    </li>
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
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(preview.rawExcerpt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <li className="rounded border border-line px-2 py-1 text-[12px]">
      <button type="button" className="flex w-full flex-wrap gap-2 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="font-mono">{preview.topic}</span>
        <span className="text-muted">{preview.size}B</span>
        {preview.decoded && <span>→ {decodedText(preview.decoded)}</span>}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          <div className="grid gap-2 md:grid-cols-2">
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1 font-mono">{preview.rawExcerpt}</pre>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1 font-mono">{preview.decoded ? JSON.stringify(preview.decoded, null, 2) : t("sources.test.noDecoded")}</pre>
          </div>
          <div>
            <Button variant="ghost" onClick={copy}>
              {copied ? t("sources.test.copied") : t("sources.test.copyRaw")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
