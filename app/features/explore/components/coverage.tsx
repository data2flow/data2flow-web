/**
 * UI-TSD-06 데이터 완전성(`/explore/coverage`, UC-TSD-14, TSD-02.04, API-TSD-09). 조회 V+(TS_READ).
 * 기기마다 예상 수신 수·실제 수신 수·완전성 %·공백 수·가장 긴 공백을 보이고, 행을 펼치면 공백 목록(시작·끝·누락 추정),
 * 공백을 누르면 탐색기에서 그 구간(앞뒤 1시간)을 연다.
 */
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Badge, Card, EmptyState, Table } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { exploreHref, defaultState } from "../model/state";

export interface GapEntry {
  deviceId: string;
  from: string;
  to: string;
  expectedCount: number;
}

export interface DeviceCompleteness {
  deviceId: string;
  deviceName?: string | null;
  intervalSec: number;
  expected: number;
  missing: number;
  completenessPercent: number;
}

export interface CoverageRow extends DeviceCompleteness {
  received: number;
  gaps: GapEntry[];
  longestGapMs: number;
}

/** 기기별 행: 공백을 붙이고 완전성이 낮은 기기부터 */
export function coverageRows(devices: DeviceCompleteness[], gaps: GapEntry[]): CoverageRow[] {
  return devices
    .map((d) => {
      const mine = gaps.filter((g) => g.deviceId === d.deviceId).sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
      const longestGapMs = mine.reduce((max, g) => Math.max(max, Date.parse(g.to) - Date.parse(g.from)), 0);
      return { ...d, received: Math.max(0, d.expected - d.missing), gaps: mine, longestGapMs };
    })
    .sort((a, b) => a.completenessPercent - b.completenessPercent || (a.deviceName ?? "").localeCompare(b.deviceName ?? ""));
}

export function durationText(ms: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (ms <= 0) return "–";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return t("explore.coverage.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  return t("explore.coverage.hoursMinutes", { h: hours, m: minutes % 60 });
}

export function completenessTone(percent: number): "success" | "warning" | "danger" {
  if (percent >= 95) return "success";
  if (percent >= 80) return "warning";
  return "danger";
}

const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** 공백 앞뒤 1시간을 탐색기에서 연다. 측정 항목을 모르면 기기 상세 데이터 탭으로 */
export function gapHref(gap: GapEntry, name: string, metrics: string[] | undefined): string {
  if (!metrics || metrics.length === 0) return `/devices/${encodeURIComponent(gap.deviceId)}?tab=data`;
  return exploreHref({
    ...defaultState(),
    range: "custom",
    from: iso(Date.parse(gap.from) - HOUR),
    to: iso(Date.parse(gap.to) + HOUR),
    series: metrics.slice(0, 3).map((metric) => ({ kind: "device", id: gap.deviceId, metric, label: `${name} ${metric}` })),
  });
}

export interface CoverageTableProps {
  rows: CoverageRow[];
  metricsOf: Record<string, string[]>;
  failure?: string | null;
  timezone: string;
  lang: string;
}

export function CoverageTable({ rows, metricsOf, failure, timezone, lang }: CoverageTableProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  if (failure) return <Alert tone="danger">{failure}</Alert>;
  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState title={t("explore.coverage.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("explore.coverage.device")}</th>
              <th>{t("explore.coverage.expected")}</th>
              <th>{t("explore.coverage.received")}</th>
              <th>{t("explore.coverage.percent")}</th>
              <th>{t("explore.coverage.gapCount")}</th>
              <th>{t("explore.coverage.longest")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = r.deviceName ?? `#${r.deviceId}`;
              const expanded = open === r.deviceId;
              return (
                <Fragment key={r.deviceId}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className="text-accent hover:underline disabled:text-text disabled:no-underline"
                        aria-expanded={expanded}
                        disabled={r.gaps.length === 0}
                        onClick={() => setOpen(expanded ? null : r.deviceId)}
                      >
                        {r.gaps.length > 0 ? (expanded ? "▾ " : "▸ ") : ""}
                        {name}
                      </button>
                    </td>
                    <td className="font-mono">{r.expected}</td>
                    <td className="font-mono">{r.received}</td>
                    <td>
                      <Badge tone={completenessTone(r.completenessPercent)}>{`${r.completenessPercent.toFixed(1)}%`}</Badge>
                    </td>
                    <td className="font-mono">{r.gaps.length}</td>
                    <td>{durationText(r.longestGapMs, t)}</td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={6} className="bg-panel2">
                        <ul aria-label={t("explore.coverage.gapsOf", { name })} className="flex flex-col gap-1 text-[12.5px]">
                          {r.gaps.map((g) => (
                            <li key={`${g.from}-${g.to}`}>
                              <Link to={gapHref(g, name, metricsOf[r.deviceId])} className="text-accent hover:underline">
                                {formatDateTime(g.from, timezone, lang)} ~ {formatDateTime(g.to, timezone, lang)}
                              </Link>{" "}
                              <span className="text-muted">{t("explore.coverage.missingEstimate", { n: g.expectedCount })}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
