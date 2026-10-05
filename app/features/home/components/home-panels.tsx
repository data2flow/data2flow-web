/**
 * 홈(UI-DSH-01) 부품: 요약 카드, 공간 쾌적도 표(DSH-01.02, TC-DSH-007), 최근 알람·제어 타임라인,
 * 실시간 갱신(API-DSH-20 `home` → `home-summary`, 바뀐 부분만 합침).
 */
import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { LiveBanner, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Badge, Card, Kpi, Table, Term } from "~/components/ui";
import { liveUrl } from "~/lib/event-stream";
import { formatDateTime, formatNumber } from "~/lib/format";
import { causeText, comfortTone, mergeSummary, severityParts, timelineIcon, timelineLink, topComfort, totalAlarms, type HomeSummary } from "../model/home";

function SummaryCard({ label, value, to }: { label: string; value: ReactNode; to?: string }) {
  // 목업 지표 타일(H.kpi)
  const body = <Kpi label={label} value={value} className="h-full" />;
  return to ? (
    <Link to={to} className="block rounded-lg hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

/** 열린 알람 카드 값: 합계와 심각도별 기호·수(▲1 !3 ·2), 글자 설명은 화면 읽기 도구용(BR-DSH-02, AT-DSH-01.1) */
function AlarmValue({ summary }: { summary: HomeSummary }) {
  const { t } = useTranslation();
  const a = summary.alarms ?? {};
  const parts = severityParts(summary);
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1" title={t("home.cards.alarmsDetail", { critical: a.critical ?? 0, major: a.major ?? 0, minor: a.minor ?? 0 })}>
      <span>{totalAlarms(summary)}</span>
      <span className="flex flex-wrap gap-2 text-[13px] font-normal">
        {parts.map((p) => (
          <span key={p.key} data-severity={p.key} className={p.key === "critical" ? "text-bad-ink" : p.key === "major" ? "text-poor-ink" : "text-muted"}>
            <span aria-hidden>{p.icon}</span>
            {p.count}
            <span className="sr-only">{` ${t(`home.severity.${p.key}`)}`}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

export function SummaryCards({ summary, lang }: { summary: HomeSummary; lang: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <SummaryCard label={t("home.cards.alarms")} value={<AlarmValue summary={summary} />} to="/alarms?state=ACTIVE" />
      <SummaryCard label={t("home.cards.offline")} value={t("home.cards.devicesN", { n: summary.offlineDevices ?? 0 })} to="/devices?connectivity=OFFLINE" />
      {summary.pendingDevices !== undefined && summary.pendingDevices !== null && <SummaryCard label={t("home.cards.pending")} value={t("home.cards.devicesN", { n: summary.pendingDevices })} to="/devices/pending" />}
      <SummaryCard label={t("home.cards.ingest")} value={t("home.cards.perMinute", { n: formatNumber(summary.ingestPerMinute ?? 0, lang) })} to="/ingest/monitor" />
      {summary.sources && <SummaryCard label={t("home.cards.sources")} value={t("home.cards.sourcesValue", { connected: summary.sources.connected, total: summary.sources.total })} to="/sources" />}
    </div>
  );
}

export function ComfortTable({ summary, timezone, lang }: { summary: HomeSummary; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const { rows, rest } = topComfort(summary.comfort, 10, summary.comfortTotal);
  return (
    <Card title={<Term term="comfort">{t("home.comfort.title")}</Term>} actions={<Link className="text-[12.5px] text-accent" to="/spaces">{t("home.comfort.all")}</Link>}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{t("home.comfort.empty")}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th scope="col">{t("home.comfort.space")}</th>
              <th scope="col">{t("home.comfort.state")}</th>
              <th scope="col">{t("home.comfort.cause")}</th>
              <th scope="col">{t("home.comfort.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { tone, icon } = comfortTone(row.state);
              return (
                <tr key={row.spaceId}>
                  <td>
                    <Link to={`/spaces/${row.spaceId}`} className="text-accent hover:underline">
                      {row.spaceName}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={tone}>
                      <span aria-hidden>{icon} </span>
                      {t(`status.comfort.${row.state}`, { defaultValue: row.state })}
                    </Badge>
                  </td>
                  <td className="font-mono text-[12.5px]">{(row.causes ?? []).map(causeText).join(", ") || "–"}</td>
                  <td className="font-mono text-[12px]">{formatDateTime(row.updatedAt, timezone, lang)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {rest > 0 && <p className="mt-2 text-[12.5px] text-muted">{t("home.comfort.more", { n: rest })}</p>}
    </Card>
  );
}

export function Timeline({ summary, timezone, lang }: { summary: HomeSummary; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const items = summary.timeline ?? [];
  return (
    <Card title={t("home.timeline.title")}>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">{t("home.timeline.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[13px]" aria-live="polite">
          {items.slice(0, 20).map((item, index) => (
            <li key={`${item.at}-${index}`} className="flex flex-wrap items-baseline gap-x-2" data-timeline={item.type}>
              <span className="font-mono text-[12px] text-muted">{formatDateTime(item.at, timezone, lang)}</span>
              <span className={item.type === "ALARM_RAISED" ? "text-bad-ink" : item.type === "ALARM_CLEARED" ? "text-good-ink" : "text-accent"} aria-hidden>
                {timelineIcon(item.type)}
              </span>
              <span className="sr-only">{t(`home.timeline.type.${item.type}`, { defaultValue: item.type })}</span>
              <Link to={timelineLink(item)} className="min-w-0 break-words text-accent hover:underline">
                {item.title}
              </Link>
              {item.severity && <span className="text-[12px] text-muted">{t(`home.severity.${item.severity.toLowerCase()}`, { defaultValue: item.severity })}</span>}
              {item.type === "CONTROL" && item.origin && <span className="text-[12px] text-muted">{t(`home.timeline.origin.${item.origin}`, { defaultValue: item.origin })}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** 요약을 상태로 들고 실시간 변경을 합친다 */
export function LiveHome({ initial, timezone, lang, streamOptions }: { initial: HomeSummary; timezone: string; lang: string; streamOptions?: UseLiveStreamOptions }) {
  const [summary, setSummary] = useState(initial);
  const onEvent = useCallback((event: { data: unknown }) => setSummary((current) => mergeSummary(current, event.data)), []);
  const status = useLiveStream(liveUrl(["home"]), ["home-summary"], onEvent, streamOptions);
  return (
    <div className="flex flex-col gap-4">
      <LiveBanner status={status} />
      <SummaryCards summary={summary} lang={lang} />
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ComfortTable summary={summary} timezone={timezone} lang={lang} />
        <Timeline summary={summary} timezone={timezone} lang={lang} />
      </div>
      {summary.aiSummary?.text && <AiSummary summary={summary.aiSummary} />}
    </div>
  );
}

/** AI 요약(일간 리포트 첫 문장 + [리포트 보기]). 없으면 영역을 그리지 않는다(AT-DSH-01.4) */
function AiSummary({ summary }: { summary: { text: string; reportId?: string } }) {
  const { t } = useTranslation();
  return (
    <Card>
      <p className="text-[13px]">
        <span aria-hidden>✨ </span>
        {summary.text}
        {summary.reportId && (
          <Link className="ml-2 text-accent hover:underline" to={`/reports/${encodeURIComponent(summary.reportId)}`}>
            {t("home.aiReport")}
          </Link>
        )}
      </p>
    </Card>
  );
}
