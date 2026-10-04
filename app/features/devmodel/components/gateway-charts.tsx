/**
 * UI-DEV-10 게이트웨이 상세 차트: 시간대별 업링크 막대와 rssi 분포 히스토그램(DEV-05.02). 같은 값을 표로도 볼 수 있다(접근성).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Button, Table } from "~/components/ui";
import { EChart } from "~/features/rules/components/echart";
import { formatDateTime } from "~/lib/format";
import { rssiChartOption, uplinkChartOption, type GatewayStats } from "../model/gateways";

export function GatewayCharts({ stats, timezone, lang, factory }: { stats: GatewayStats; timezone: string; lang: string; factory?: ChartFactory }) {
  const { t } = useTranslation();
  const [table, setTable] = useState(false);
  const hour = useMemo(() => (iso: string) => formatDateTime(iso, timezone, lang), [timezone, lang]);
  const uplinks = useMemo(() => uplinkChartOption(stats, { uplinks: t("devmodel.gateways.uplinks") }, hour), [stats, t, hour]);
  const rssi = useMemo(() => rssiChartOption(stats, { devices: t("devmodel.gateways.device") }), [stats, t]);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <figure className="m-0">
        <figcaption className="text-[12.5px] text-muted">{t("devmodel.gateways.uplinksByHour")}</figcaption>
        <EChart option={uplinks} label={t("devmodel.gateways.uplinksByHour")} factory={factory} />
      </figure>
      <figure className="m-0">
        <figcaption className="text-[12.5px] text-muted">{t("devmodel.gateways.rssiHistogram")}</figcaption>
        <EChart option={rssi} label={t("devmodel.gateways.rssiHistogram")} factory={factory} />
      </figure>
      <div className="md:col-span-2">
        <Button variant="ghost" onClick={() => setTable((v) => !v)} aria-expanded={table}>
          {table ? t("chart.hideTable") : t("chart.showTable")}
        </Button>
        {table && (
          <div className="grid gap-3 md:grid-cols-2">
            <Table>
              <caption className="sr-only">{t("devmodel.gateways.uplinksByHour")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("chart.time")}</th>
                  <th scope="col">{t("devmodel.gateways.uplinks")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.uplinksByHour.map((h) => (
                  <tr key={h.t}>
                    <td className="font-mono">{hour(h.t)}</td>
                    <td className="font-mono">{h.count}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Table>
              <caption className="sr-only">{t("devmodel.gateways.rssiHistogram")}</caption>
              <thead>
                <tr>
                  <th scope="col">dBm</th>
                  <th scope="col">{t("devmodel.gateways.device")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.rssiHistogram.map((b) => (
                  <tr key={b.fromDbm}>
                    <td className="font-mono">{`${b.fromDbm}~${b.toDbm}`}</td>
                    <td className="font-mono">{b.count}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
