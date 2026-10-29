/**
 * UI-ING-02 원본 메시지 목록(`/ingest/raw-messages`, UC-ING-06, ING-01.01/02). 조회 INGEST_READ(OPERATOR 이상),
 * 원본 payload는 상세 패널(UI-ING-03)에서 INGEST_PAYLOAD_READ(INTEGRATOR·ADMIN)일 때만 서버가 채운다.
 * 필터는 URL 쿼리에 남기고(서버 loader가 API-ING-05를 부른다), 상태 집계를 누르면 그 상태로 거른다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Badge, Card, EmptyState, Table } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { RawMessagePanel } from "./failures-panels";

export interface RawMessageRow {
  id: string;
  receivedAt: string;
  sourceId?: string | null;
  sourceName?: string | null;
  topic: string;
  deviceId?: string | null;
  deviceName?: string | null;
  externalId?: string | null;
  status: string;
  metricCount?: number | null;
  qualitySummary?: { normal: number; outOfRange: number; unverified: number } | null;
  sizeBytes?: number | null;
  virtual?: boolean;
}

/** 기간 단추(시간). 원본 보관 기간이 30일이라 최대 30일(API-ING-05는 31일까지) */
export const RAW_PERIODS = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720 } as const;
export type RawPeriod = keyof typeof RAW_PERIODS;

export function rawPeriod(value: string | null): RawPeriod {
  return value && Object.hasOwn(RAW_PERIODS, value) ? (value as RawPeriod) : "1h";
}

/** 원본 메시지 처리 상태(RawMessage.status) */
export const RAW_STATUSES = ["OK", "DECODE_ERROR", "SCRIPT_ERROR", "DUPLICATE", "REJECTED", "UNKNOWN_DEVICE_REJECTED", "INVALID"] as const;

export function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "OK") return "success";
  if (status === "DUPLICATE") return "neutral";
  if (status.endsWith("_ERROR") || status === "INVALID") return "danger";
  return "warning";
}

export interface RawMessageListProps {
  rows: RawMessageRow[];
  counts: Record<string, number>;
  /** 상태 집계를 누르면 갈 주소 */
  statusLink: (status: string) => string;
  nextLink: string | null;
  failure?: string | null;
  timezone: string;
  lang: string;
}

export function RawMessageList({ rows, counts, statusLink, nextLink, failure, timezone, lang }: RawMessageListProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const statuses = Object.keys(counts);
  return (
    <div className="flex flex-col gap-4">
      {failure && <Alert tone="danger">{failure}</Alert>}
      {statuses.length > 0 && (
        <nav aria-label={t("ingest.rawList.counts")} className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <Link key={s} to={statusLink(s)} className="rounded-md border border-line bg-panel px-2.5 py-1 text-[12.5px] hover:bg-panel2">
              <span className="font-mono">{s}</span> <strong>{counts[s]}</strong>
            </Link>
          ))}
        </nav>
      )}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t("ingest.rawList.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("ingest.raw.receivedAt")}</th>
                <th>{t("ingest.rawList.source")}</th>
                <th>{t("ingest.raw.topic")}</th>
                <th>{t("ingest.rawList.device")}</th>
                <th>{t("ingest.raw.status")}</th>
                <th>{t("ingest.rawList.metrics")}</th>
                <th>{t("ingest.rawList.quality")}</th>
                <th>{t("ingest.rawList.size")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={selected === r.id ? "bg-accent-soft" : undefined}>
                  <td>
                    <button type="button" className="font-mono text-accent hover:underline" onClick={() => setSelected(r.id)} aria-label={t("ingest.rawList.open", { id: r.id })}>
                      {formatDateTime(r.receivedAt, timezone, lang, true)}
                    </button>
                  </td>
                  <td>{r.sourceName ?? (r.sourceId ? `#${r.sourceId}` : "–")}</td>
                  <td className="max-w-[280px] truncate font-mono text-[12px]" title={r.topic}>
                    {r.topic}
                  </td>
                  <td>
                    {r.deviceName ?? (r.externalId ? <span className="font-mono">{r.externalId}</span> : <span className="text-muted">{t("ingest.rawList.unknownDevice")}</span>)}
                    {r.virtual && (
                      <>
                        {" "}
                        <Badge tone="virtual">{t("ingest.rawList.virtual")}</Badge>
                      </>
                    )}
                  </td>
                  <td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="font-mono">{r.metricCount ?? "–"}</td>
                  <td className="text-[12px]">
                    {r.qualitySummary ? t("ingest.rawList.qualityValue", { normal: r.qualitySummary.normal, outOfRange: r.qualitySummary.outOfRange, unverified: r.qualitySummary.unverified }) : "–"}
                  </td>
                  <td className="font-mono text-[12px]">{r.sizeBytes != null ? `${r.sizeBytes} B` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {nextLink && (
          <div className="mt-3 flex justify-center">
            <Link to={nextLink} className="text-accent hover:underline">
              {t("ingest.rawList.more")}
            </Link>
          </div>
        )}
      </Card>
      {selected && <RawMessagePanel rawMessageId={selected} timezone={timezone} onClose={() => setSelected(null)} />}
    </div>
  );
}
