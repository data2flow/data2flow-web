/**
 * 적용 확인 대화상자(UI-FLW-03): 검증 오류(적용 불가)·경고(적용 가능), 변경 요약(노드별 KEEP/RESET/MIGRATE, 삭제 노드 상태 24시간 보관),
 * 위험 변경(제어 노드·실행 모드)은 "이해했습니다" 체크 필수, 배포 메모 0~500자.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Dialog, TextArea } from "~/components/ui";
import type { ValidateResponse, ValidationIssue } from "../model/types";
import { issueNodeIds } from "../model/validation";

export const MEMO_MAX = 500;

export function issueText(t: (key: string, options?: Record<string, unknown>) => string, issue: ValidationIssue, nameOf: (id: string) => string): string {
  const nodes = issueNodeIds(issue).map(nameOf).join(", ");
  const label = t(`flows.issue.${issue.code}`, { defaultValue: issue.code });
  const detail = issue.path ? ` · ${issue.path}` : "";
  return nodes ? `${nodes}: ${label}${detail}` : `${label}${detail}`;
}

export function ApplyDialog({
  open,
  title,
  result,
  busy,
  error,
  nameOf,
  onCancel,
  onApply,
  onFocusNode,
}: {
  open: boolean;
  title: string;
  result: ValidateResponse | null;
  busy: boolean;
  error?: string;
  nameOf: (id: string) => string;
  onCancel: () => void;
  onApply: (memo: string, acknowledgedRisks: boolean) => void;
  onFocusNode: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [memo, setMemo] = useState("");
  const [ack, setAck] = useState(false);
  if (!result) return null;
  const risky = Boolean(result.risky?.controlNodesChanged || result.risky?.executionModeChanged);
  const memoTooLong = memo.length > MEMO_MAX;
  const blocked = result.errors.length > 0 || (risky && !ack) || memoTooLong || busy;
  const summary = result.changeSummary;
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={blocked} onClick={() => onApply(memo.trim(), ack)}>
            {busy ? t("common.processing") : t("flows.apply.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-[13px]">{t("flows.apply.counts", { errors: result.errors.length, warnings: result.warnings.length })}</p>
      {result.errors.length > 0 && (
        <ul aria-label={t("flows.apply.errors")} className="flex flex-col gap-1 text-[12.5px] text-bad">
          {result.errors.map((issue, i) => (
            <li key={`e${i}`}>
              <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => issueNodeIds(issue)[0] && onFocusNode(issueNodeIds(issue)[0])}>
                {issueText(t, issue, nameOf)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul aria-label={t("flows.apply.warnings")} className="flex flex-col gap-1 text-[12.5px] text-warn">
          {result.warnings.map((issue, i) => (
            <li key={`w${i}`}>{issueText(t, issue, nameOf)}</li>
          ))}
        </ul>
      )}
      {summary && (
        <div className="text-[12.5px]">
          <p className="font-semibold">{t("flows.apply.changes")}</p>
          <ul className="flex flex-col gap-0.5">
            {(summary.added ?? []).map((id) => (
              <li key={`a${id}`}>{t("flows.apply.added", { name: nameOf(id) })}</li>
            ))}
            {(summary.changed ?? []).map((c) => (
              <li key={`c${c.nodeId}`}>{t("flows.apply.changed", { name: nameOf(c.nodeId), policy: t(`flows.statePolicy.${c.statePolicy}`, { defaultValue: c.statePolicy }) })}</li>
            ))}
            {(summary.removed ?? []).map((r) => (
              <li key={`r${r.nodeId}`}>{t(r.retainedState ? "flows.apply.removedRetained" : "flows.apply.removed", { name: nameOf(r.nodeId) })}</li>
            ))}
            {!summary.added?.length && !summary.changed?.length && !summary.removed?.length && <li>{t("flows.apply.noChanges")}</li>}
          </ul>
        </div>
      )}
      {result.approvalRequired && <Alert tone="info">{t("flows.apply.approvalRequired")}</Alert>}
      {risky && (
        <div className="flex flex-col gap-1 rounded-md border border-warn/40 p-2">
          <p className="text-[12.5px] text-warn">{result.risky?.controlNodesChanged ? t("flows.apply.riskControl") : t("flows.apply.riskMode")}</p>
          <Checkbox label={t("flows.apply.acknowledge")} checked={ack} onChange={(e) => setAck(e.target.checked)} />
        </div>
      )}
      <TextArea label={t("flows.apply.memo")} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} error={memoTooLong ? t("flows.apply.memoTooLong", { max: MEMO_MAX }) : undefined} />
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
