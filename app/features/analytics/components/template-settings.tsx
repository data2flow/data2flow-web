/**
 * UI-ANA-07 분석 템플릿 설정(`/settings/analytics-templates`, UC-ANA-07, ANA-01.03·05.08). 권한 ADMIN.
 * 템플릿 표(이름·키·현재 버전·사용 중인 분석·일정·실시간 수·활성 스위치)와 조직 설정(결과 보관 기간 30~1,095일, 기본 365).
 * 끌 때는 "일정 N건, 실시간 M건이 중지됩니다" 확인을 받는다(BR-ANA-17, 다시 켜도 자동 재개 없음).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { analyticsAdminApi, type AnalyticsAdminApi, type TemplateSetting } from "../admin-api";

export const RETENTION_RANGE = [30, 1095] as const;

export function retentionProblem(value: string): boolean {
  return !/^\d+$/.test(value.trim()) || Number(value) < RETENTION_RANGE[0] || Number(value) > RETENTION_RANGE[1];
}

export interface TemplateSettingsProps {
  initial: TemplateSetting[];
  failed?: { code: string; message?: string } | null;
  retentionDays: number | null;
  api?: AnalyticsAdminApi;
}

export function TemplateSettings({ initial, failed, retentionDays, api = analyticsAdminApi }: TemplateSettingsProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const [confirm, setConfirm] = useState<TemplateSetting | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [days, setDays] = useState(retentionDays == null ? "" : String(retentionDays));
  const [daysSubmitted, setDaysSubmitted] = useState(false);

  const toggle = async (row: TemplateSetting, enabled: boolean) => {
    setConfirm(null);
    setNotice(null);
    const result = await api.setTemplateEnabled(row.key, enabled);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setRows((list) => list.map((r) => (r.key === row.key ? { ...r, enabled: result.data.enabled } : r)));
    setNotice({ tone: "success", text: t(enabled ? "analytics.templateSettings.enabledDone" : "analytics.templateSettings.disabledDone", { name: row.name, n: result.data.pausedAnalysisIds?.length ?? 0 }) });
  };

  const saveDays = async () => {
    setDaysSubmitted(true);
    setNotice(null);
    if (retentionProblem(days)) return;
    const result = await api.saveSettings(Number(days));
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setDays(String(result.data.resultRetentionDays));
    setDaysSubmitted(false);
    setNotice({ tone: "success", text: t("analytics.templateSettings.retentionSaved") });
  };

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card title={t("analytics.templateSettings.templates")}>
        {failed && <Alert tone="danger">{errorText(t, failed)}</Alert>}
        {rows.length === 0 && !failed ? (
          <EmptyState title={t("analytics.templateSettings.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("analytics.templateSettings.name")}</th>
                <th>{t("analytics.templateSettings.key")}</th>
                <th>{t("analytics.templateSettings.version")}</th>
                <th>{t("analytics.templateSettings.analyses")}</th>
                <th>{t("analytics.templateSettings.schedules")}</th>
                <th>{t("analytics.templateSettings.realtime")}</th>
                <th>{t("analytics.templateSettings.enabled")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  <td className="font-mono text-[12px]">{r.key}</td>
                  <td className="font-mono text-[12px]">{r.version}</td>
                  <td className="font-mono">{r.analysisCount}</td>
                  <td className="font-mono">{r.scheduleCount}</td>
                  <td className="font-mono">{r.realtimeCount}</td>
                  <td>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        role="switch"
                        className="h-4 w-4 accent-[var(--d2f-accent)]"
                        aria-label={t("analytics.templateSettings.toggle", { name: r.name })}
                        checked={r.enabled}
                        onChange={(e) => (e.target.checked ? void toggle(r, true) : r.scheduleCount + r.realtimeCount > 0 ? setConfirm(r) : void toggle(r, false))}
                      />
                      {r.enabled ? <Badge tone="success">{t("analytics.templateSettings.on")}</Badge> : <Badge tone="neutral">{t("analytics.templateSettings.off")}</Badge>}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={t("analytics.templateSettings.org")}>
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label={t("analytics.templateSettings.retention")}
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            hint={t("analytics.templateSettings.retentionHint")}
            error={daysSubmitted && retentionProblem(days) ? t("analytics.templateSettings.retentionProblem") : undefined}
          />
          <Button variant="primary" onClick={() => void saveDays()}>
            {t("common.save")}
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t("analytics.templateSettings.confirmTitle", { name: confirm?.name ?? "" })}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t("common.no")}</Button>
            <Button variant="danger" onClick={() => confirm && void toggle(confirm, false)}>
              {t("analytics.templateSettings.disable")}
            </Button>
          </>
        }
      >
        <p>{t("analytics.templateSettings.confirmBody", { schedules: confirm?.scheduleCount ?? 0, realtime: confirm?.realtimeCount ?? 0 })}</p>
      </Dialog>
    </div>
  );
}
