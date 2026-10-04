/**
 * UI-SCR-08 사용처(SCR-04.04): 연결 대상 표(유형, 이름, 기기 수, 24시간 처리량, 실패 정책), 플로우 노드 참조(플로우 이름·노드·버전),
 * [비활성화](영향 범위 확인 — API-SCR-04 usage로 먼저 보여 준다)·[활성화](API-SCR-17), [삭제](사용처 0일 때만, API-SCR-02).
 * 버튼은 SCRIPT_WRITE만. 처리는 이 화면 action이 한다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Alert, Badge, Button, Card, CsrfField, Dialog, Table } from "~/components/ui";
import { formatNumber } from "~/lib/format";
import type { ScriptDetail } from "./api";
import { inUse, usageImpact } from "./model/usage";

export interface UsageActionResult {
  intent?: string;
  ok?: boolean;
  error?: { code: string; message?: string };
  impact?: { bindings?: number; deviceCount?: number; processed24h?: number } | null;
}

export function ScriptUsageTab({ script, canWrite, lang, result }: { script: ScriptDetail; canWrite: boolean; lang: string; result?: UsageActionResult }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const usage = script.usage;
  const impact = usageImpact(usage);
  const used = inUse(usage);
  const disabled = script.status !== "ENABLED";
  return (
    <div className="flex flex-col gap-4">
      {result?.error && <Alert tone="danger">{t(`errors.${result.error.code}`, { defaultValue: result.error.message || t("errors.UNKNOWN") })}</Alert>}
      {result?.ok && result.intent === "disable" && <Alert tone="success">{t("scripts.usageTab.disabled", { devices: result.impact?.deviceCount ?? impact.deviceCount, n: formatNumber(result.impact?.processed24h ?? impact.processed24h, lang) })}</Alert>}
      {result?.ok && result.intent === "enable" && <Alert tone="success">{t("scripts.usageTab.enabled")}</Alert>}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            {t("scripts.usageTab.title")}
            <Badge tone={disabled ? "warning" : "success"}>{t(`scripts.usageTab.status.${script.status}`, { defaultValue: script.status })}</Badge>
          </span>
        }
        actions={
          canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              {disabled ? (
                <Form method="post">
                  <CsrfField />
                  <input type="hidden" name="intent" value="enable" />
                  <Button type="submit">{t("scripts.usageTab.enable")}</Button>
                </Form>
              ) : (
                <Button onClick={() => setConfirm(true)}>{t("scripts.usageTab.disable")}</Button>
              )}
              <Form method="post">
                <CsrfField />
                <input type="hidden" name="intent" value="delete" />
                <Button type="submit" variant="danger" disabled={used} aria-describedby={used ? "script-delete-reason" : undefined}>
                  {t("scripts.usageTab.delete")}
                </Button>
              </Form>
            </div>
          )
        }
      >
        {canWrite && used && (
          <p id="script-delete-reason" className="mb-2 text-[12.5px] text-muted">
            {t("scripts.usageTab.deleteBlocked")}
          </p>
        )}
        {(usage?.bindings ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">{t("scripts.usageTab.noBindings")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">{t("scripts.usageTab.type")}</th>
                <th scope="col">{t("scripts.usageTab.name")}</th>
                <th scope="col">{t("scripts.usageTab.devices")}</th>
                <th scope="col">{t("scripts.usageTab.processed24h")}</th>
                <th scope="col">{t("scripts.usageTab.failurePolicy")}</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.bindings ?? []).map((b, i) => (
                <tr key={`${b.targetType}:${b.targetId}:${i}`}>
                  <td>{t(`scripts.usageTab.target.${b.targetType}`, { defaultValue: b.targetType ?? "" })}</td>
                  <td>{b.name ?? b.targetId}</td>
                  <td className="font-mono">{b.deviceCount ?? "–"}</td>
                  <td className="font-mono">{b.processed24h === null || b.processed24h === undefined ? "–" : formatNumber(b.processed24h, lang)}</td>
                  <td>{b.failurePolicy ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <h3 className="mb-1 mt-4 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{t("scripts.usageTab.flowNodes")}</h3>
        {(usage?.flowNodes ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">{t("scripts.usageTab.noFlowNodes")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {(usage?.flowNodes ?? []).map((n) => (
              <li key={`${n.flowId}:${n.nodeId}`}>
                <Link to={`/automation/flows/${encodeURIComponent(n.flowId)}`} className="text-accent hover:underline">
                  {n.flowName ?? n.flowId}
                </Link>
                <span className="font-mono text-[12.5px]">{` / ${n.nodeId}${n.flowVersion ? ` (v${n.flowVersion})` : ""}`}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        title={t("scripts.usageTab.disableTitle")}
        open={confirm}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
            <Form method="post" onSubmit={() => setConfirm(false)}>
              <CsrfField />
              <input type="hidden" name="intent" value="disable" />
              <Button type="submit" variant="danger">
                {t("scripts.usageTab.disable")}
              </Button>
            </Form>
          </>
        }
      >
        <p className="text-[13px]">{t("scripts.usageTab.disableImpact", { bindings: impact.bindings, devices: impact.deviceCount, n: formatNumber(impact.processed24h, lang) })}</p>
        {impact.flowNodes > 0 && <p className="mt-1 text-[13px]">{t("scripts.usageTab.disableFlows", { n: impact.flowNodes })}</p>}
        <p className="mt-1 text-[12.5px] text-muted">{t("scripts.usageTab.disableNote")}</p>
      </Dialog>
    </div>
  );
}
