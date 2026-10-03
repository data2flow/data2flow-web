/**
 * 수집 흐름 실시간 부분(DSH-03.01, DSH-05.01): 스냅샷(API-DSH-05)을 SSE `ingest-stats`(API-DSH-20 topic `ingest`, 5초)로 갱신하고
 * "갱신 n초 전"을 1초마다 다시 센다. 다이어그램과 소스 표를 함께 갱신한다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Card, StatusDot, Table } from "~/components/ui";
import { liveUrl, type StreamEvent } from "~/lib/event-stream";
import { formatNumber, formatRelative } from "~/lib/format";
import { connectionTone, mergeLive, secondsSince, type IngestSummary, type MonitorSnapshot } from "./model/ingest";
import { PipelineDiagram } from "./pipeline-diagram";

const LIVE_URL = liveUrl(["ingest"]);

export function LiveMonitor({
  initial,
  counts,
  loadedAt,
  now = Date.now,
  live = {},
}: {
  initial: MonitorSnapshot;
  counts?: IngestSummary["sources"];
  loadedAt: number;
  now?: () => number;
  live?: UseLiveStreamOptions;
}) {
  const { t, i18n } = useTranslation();
  const [snapshot, setSnapshot] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState<number>(loadedAt);
  const [tick, setTick] = useState(loadedAt);
  const onEvent = useCallback(
    (event: StreamEvent) => {
      setSnapshot((current) => mergeLive(current, event.data));
      setUpdatedAt(now());
    },
    [now],
  );
  const status = useLiveStream(LIVE_URL, ["ingest-stats"], onEvent, live);
  useEffect(() => {
    const timer = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(timer);
  }, [now]);
  const elapsed = secondsSince(updatedAt, tick);
  const lang = i18n.language;
  return (
    <div className="flex flex-col gap-4">
      <LiveBanner status={status} />
      <Card
        title={t("ingest.monitor.diagram")}
        actions={
          <>
            <span className="text-[12px] text-muted">{t("ingest.monitor.updatedAgo", { n: elapsed ?? 0 })}</span>
            <LiveDot status={status} />
          </>
        }
      >
        <PipelineDiagram stages={snapshot.stages} />
      </Card>
      <Card title={t("ingest.monitor.sources")}>
        <Table>
          <thead>
            <tr>
              <th>{t("ingest.monitor.sourceName")}</th>
              <th>{t("ingest.monitor.type")}</th>
              <th>{t("ingest.monitor.connection")}</th>
              <th>{t("ingest.monitor.perMin")}</th>
              <th>OK</th>
              <th>DECODE_ERROR</th>
              <th>SCRIPT_ERROR</th>
              <th>DUPLICATE</th>
              <th>REJECTED</th>
              <th>INVALID</th>
              <th>{t("ingest.monitor.lastReceived")}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.sources.map((source) => {
              const row = counts?.find((c) => String(c.sourceId) === String(source.id));
              const c = row?.counts ?? {};
              return (
                <tr key={source.id} data-source={source.id}>
                  <td>
                    <Link to={`/sources/${source.id}`} className="text-accent hover:underline">
                      {source.name}
                    </Link>
                  </td>
                  <td>{row?.type ?? "–"}</td>
                  <td>
                    <StatusDot tone={connectionTone(source.state)} label={source.state ?? "–"} />
                  </td>
                  <td className="font-mono">{formatNumber(source.perMin, lang)}</td>
                  {["OK", "DECODE_ERROR", "SCRIPT_ERROR", "DUPLICATE", "UNKNOWN_DEVICE_REJECTED", "INVALID"].map((k) => (
                    <td key={k} className="font-mono">
                      {formatNumber(c[k] ?? 0, lang)}
                    </td>
                  ))}
                  <td>{formatRelative(source.lastMessageAt ?? row?.lastReceivedAt, tick, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
