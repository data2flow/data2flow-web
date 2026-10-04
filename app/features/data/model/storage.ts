/**
 * 저장 지표(UI-OPS-01 "저장 지표", OPS-01.03) 모델. API-OPS-03 `GET /core/ops/metrics/storage`
 * `{dbSizeBytes, tables[{schema, table, bytes, rows}], dailyGrowthBytes[{day, bytes, growthBytes}], diskFreePercent, diskCapacityBytes, checkedAt}`.
 * 디스크 여유가 20% 아래면(사용률 80% 초과) 경고색 + 아이콘(색만으로 구분하지 않음).
 */
import type { ChartSeries } from "~/lib/chart-model";

export interface StorageMetrics {
  dbSizeBytes: number;
  tables: { schema: string; table: string; bytes: number; rows: number }[];
  dailyGrowthBytes: { day: string; bytes: number; growthBytes?: number | null }[];
  diskFreePercent?: number | null;
  diskCapacityBytes?: number | null;
  checkedAt?: string | null;
}

/** OPS-01.03 기준(디스크 여유 20%) */
export const DISK_WARN_PERCENT = 20;
export const TOP_TABLES = 10;

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** 바이트를 1024 단위로(소수 한 자리) */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "–";
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${bytes < 0 ? "-" : ""}${text} ${UNITS[unit]}`;
}

export function diskLevel(freePercent: number | null | undefined): "unknown" | "ok" | "warn" {
  if (freePercent === null || freePercent === undefined) return "unknown";
  return freePercent < DISK_WARN_PERCENT ? "warn" : "ok";
}

/** 최근 7일 평균 하루 증가량 */
export function averageGrowth(metrics: Pick<StorageMetrics, "dailyGrowthBytes">): number | null {
  const values = metrics.dailyGrowthBytes.map((d) => d.growthBytes).filter((v): v is number => typeof v === "number").slice(-7);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** 하루 크기 추이를 공통 시계열 차트 계열(GB)로 */
export function growthSeries(metrics: Pick<StorageMetrics, "dailyGrowthBytes">, label: string): ChartSeries[] {
  return [
    {
      key: "db-size",
      label,
      unit: "GB",
      precision: 2,
      points: metrics.dailyGrowthBytes.map((d) => [`${d.day}T00:00:00Z`, Math.round((d.bytes / 1024 ** 3) * 100) / 100, null]),
    },
  ];
}

export function topTables(metrics: Pick<StorageMetrics, "tables">, n = TOP_TABLES) {
  return [...metrics.tables].sort((a, b) => b.bytes - a.bytes).slice(0, n);
}
