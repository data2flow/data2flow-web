/**
 * UI-ACT-11 장비 가동·효과 현황(ACT-08.01·08.02, API-ACT-35). 기기 상세 [가동] 탭.
 * 기간별 가동 시간, 켜고 끈 횟수, 추정 에너지(kWh, 전력 보고가 없으면 정격 × 가동 시간 = RATED), 제어 효과 없음 이벤트(명령, 기대 효과, 실제 변화).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Card, EmptyState, SelectField, Table } from "~/components/ui";
import { formatDate, formatDateTime } from "~/lib/format";
import { controlAdminApi, type ControlAdminApi } from "./admin-api";
import { effectText, monthlyRuntime, runtimeTotals, type RuntimeReport } from "./model/admin";

const PERIODS = { "7d": { days: 7, step: "day" }, "30d": { days: 30, step: "day" }, "12m": { days: 365, step: "month" } } as const;
type Period = keyof typeof PERIODS;

export function OperationTab({ deviceId, timezone, lang, now = Date.now, api = controlAdminApi }: { deviceId: string; timezone: string; lang: string; now?: () => number; api?: ControlAdminApi }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>("7d");
  const [report, setReport] = useState<RuntimeReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const end = now();
    const { days, step } = PERIODS[period];
    // API-ACT-35 from·to는 날짜(양 끝 포함), 항목은 일별이다. 12개월은 화면에서 월로 묶는다
    const from = new Date(end - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(end).toISOString().slice(0, 10);
    void api.runtime(deviceId, from, to).then((result) => {
      if (cancelled) return;
      setFailed(!result.ok);
      if (!result.ok) {
        setReport(null);
        return;
      }
      const items = result.data.items ?? [];
      setReport({ items: step === "month" ? monthlyRuntime(items) : items, noEffectEvents: result.data.noEffectEvents ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, [api, deviceId, period, now]);

  const totals = report ? runtimeTotals(report) : null;
  return (
    <div className="grid gap-4">
      <Card
        title={t("control.operation.title")}
        actions={
          <SelectField label={t("control.operation.period")} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {t(`control.operation.periods.${p}`)}
              </option>
            ))}
          </SelectField>
        }
      >
        {failed && <Alert tone="warning">{t("control.operation.unavailable")}</Alert>}
        {totals && (
          <dl className="mb-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md border border-line p-3">
              <dt className="text-[12px] text-muted">{t("control.operation.onHours")}</dt>
              <dd className="font-mono text-[20px] font-semibold">{t("control.operation.hours", { n: Math.round(totals.onHours * 10) / 10 })}</dd>
            </div>
            <div className="rounded-md border border-line p-3">
              <dt className="text-[12px] text-muted">{t("control.operation.cycles")}</dt>
              <dd className="font-mono text-[20px] font-semibold">{totals.cycles}</dd>
            </div>
            <div className="rounded-md border border-line p-3">
              <dt className="text-[12px] text-muted">{t("control.operation.energy")}</dt>
              <dd className="font-mono text-[20px] font-semibold">{`${Math.round(totals.energyKwh * 10) / 10} kWh`}</dd>
            </div>
          </dl>
        )}
        {report && report.items.length === 0 ? (
          <EmptyState title={t("control.operation.empty")} />
        ) : (
          report && (
            <Table>
              <thead>
                <tr>
                  <th>{t("control.operation.date")}</th>
                  <th>{t("control.operation.onHours")}</th>
                  <th>{t("control.operation.cycles")}</th>
                  <th>{t("control.operation.energy")}</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((i) => (
                  <tr key={i.date}>
                    <td>{i.date.length > 10 ? formatDate(i.date, timezone, lang) : i.date}</td>
                    <td className="font-mono">{t("control.operation.hours", { n: Math.round((i.onSeconds / 3600) * 10) / 10 })}</td>
                    <td className="font-mono">{i.cycles}</td>
                    <td className="font-mono">
                      {i.energyWh != null ? `${Math.round(i.energyWh / 100) / 10} kWh` : "–"}
                      {i.energySource && <span className="ml-1 text-[11px] text-muted">{t(`control.operation.source.${i.energySource}`, { defaultValue: i.energySource })}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        )}
      </Card>
      <Card title={t("control.operation.noEffectTitle", { n: report?.noEffectEvents.length ?? 0 })}>
        {!report || report.noEffectEvents.length === 0 ? (
          <EmptyState title={t("control.operation.noEffectEmpty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("control.history.col.time")}</th>
                <th>{t("control.history.col.command")}</th>
                <th>{t("control.operation.metric")}</th>
                <th>{t("control.operation.expected")}</th>
                <th>{t("control.operation.observed")}</th>
              </tr>
            </thead>
            <tbody>
              {report.noEffectEvents.map((e) => (
                <tr key={`${e.at}-${e.commandId ?? ""}`}>
                  <td>{formatDateTime(e.at, timezone, lang, true)}</td>
                  <td className="font-mono text-[12px]">{e.commandId ?? "–"}</td>
                  <td className="font-mono">{e.metric}</td>
                  <td className="font-mono">{effectText(e.expected)}</td>
                  <td>
                    <Badge tone="warning">{effectText(e.observed)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
