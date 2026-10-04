/**
 * UI-OPS-01 "저장 지표"(OPS-01.03): DB 전체 용량, 테이블별 크기 상위 10, 일 증가량, 디스크 여유(%) 게이지.
 * 여유가 20% 미만이면 경고색 + 아이콘·문자(색만으로 구분하지 않음). 추이는 공통 시계열 차트(UI-TSD-07)로 그린다.
 */
import { useTranslation } from "react-i18next";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Card, Table, cx } from "~/components/ui";
import { formatDateTime, formatNumber } from "~/lib/format";
import { DISK_WARN_PERCENT, averageGrowth, diskLevel, formatBytes, growthSeries, topTables, type StorageMetrics } from "../model/storage";

export function StoragePanel({ metrics, timezone, lang, chartFactory }: { metrics: StorageMetrics | null; timezone: string; lang: string; chartFactory?: ChartFactory }) {
  const { t } = useTranslation();
  if (!metrics) {
    return (
      <Card title={t("data.storage.title")}>
        <Alert tone="warning">{t("data.storage.unavailable")}</Alert>
      </Card>
    );
  }
  const level = diskLevel(metrics.diskFreePercent);
  const growth = averageGrowth(metrics);
  return (
    <Card title={t("data.storage.title")} actions={metrics.checkedAt && <span className="text-[12px] text-muted">{formatDateTime(metrics.checkedAt, timezone, lang)}</span>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-line p-3">
          <p className="text-[12px] text-muted">{t("data.storage.dbSize")}</p>
          <p className="font-mono text-[18px]">{formatBytes(metrics.dbSizeBytes)}</p>
          {growth !== null && <p className="text-[12px] text-muted">{t("data.storage.perDay", { size: `${growth >= 0 ? "+" : ""}${formatBytes(growth)}` })}</p>}
        </div>
        <div className={cx("rounded-md border p-3 sm:col-span-2", level === "warn" ? "border-bad bg-bad-soft" : "border-line")}>
          <p className="text-[12px] text-muted">{t("data.storage.diskFree")}</p>
          {level === "unknown" ? (
            <p className="text-[13px] text-muted">{t("data.storage.diskUnknown")}</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <meter aria-label={t("data.storage.diskFree")} className="w-full" min={0} max={100} low={DISK_WARN_PERCENT} optimum={100} value={metrics.diskFreePercent ?? 0} />
                <span className={cx("font-mono text-[15px]", level === "warn" && "text-bad")}>{`${formatNumber(metrics.diskFreePercent ?? 0, lang, { precision: 0 })}%`}</span>
              </div>
              {level === "warn" && (
                <p role="alert" className="mt-1 text-[12.5px] text-bad">
                  {`⚠ ${t("data.storage.diskWarn", { n: DISK_WARN_PERCENT })}`}
                </p>
              )}
              {metrics.diskCapacityBytes ? <p className="text-[12px] text-muted">{t("data.storage.capacity", { size: formatBytes(metrics.diskCapacityBytes) })}</p> : null}
            </>
          )}
        </div>
      </div>
      <div className="mt-4">
        <TimeseriesChart series={growthSeries(metrics, t("data.storage.dbSize"))} timezone={timezone} height={200} factory={chartFactory} title={t("data.storage.trend")} />
      </div>
      <h3 className="mb-1 mt-4 text-[13px] font-semibold">{t("data.storage.topTables")}</h3>
      <Table>
        <thead>
          <tr>
            <th>{t("data.retention.table")}</th>
            <th>{t("data.jobs.rows")}</th>
            <th>{t("data.jobs.size")}</th>
          </tr>
        </thead>
        <tbody>
          {topTables(metrics).map((row) => (
            <tr key={`${row.schema}.${row.table}`}>
              <td className="font-mono">{`${row.schema}.${row.table}`}</td>
              <td className="font-mono">{formatNumber(row.rows, lang)}</td>
              <td className="font-mono">{formatBytes(row.bytes)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
