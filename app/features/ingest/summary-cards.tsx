/**
 * 수집 요약 카드(UI-ING-01, OPS-01.02): 분당 수신, 처리 지연 p95, 스트림 lag, 하트비트, 오늘 실패. 기준을 넘으면 주황·빨강.
 */
import { useTranslation } from "react-i18next";
import { Alert, Kpi, type Level } from "~/components/ui";
import { formatNumber } from "~/lib/format";
import { alertTone, cardTone, type IngestSummary, type Tone } from "./model/ingest";

/** 기준을 넘은 카드: 주의(fair)·위험(bad) 점과 숫자색(목업 H.kpi) */
const LEVEL: Record<Tone, Level | undefined> = { good: undefined, warn: "fair", bad: "bad", muted: undefined };

export function SummaryCards({ summary }: { summary: IngestSummary | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const alerts = summary?.alerts ?? [];
  const cards: { key: string; value: string }[] = [
    { key: "perMinute", value: formatNumber(summary?.perMinute, lang) },
    { key: "latencyP95Ms", value: summary?.latencyP95Ms == null ? "–" : formatNumber(summary.latencyP95Ms / 1000, lang, { precision: 2, unit: "s" }) },
    { key: "streamLagSec", value: formatNumber(summary?.streamLagSec, lang, { unit: "s" }) },
    { key: "heartbeat", value: summary?.heartbeat?.totalMs == null ? "–" : formatNumber(summary.heartbeat.totalMs / 1000, lang, { precision: 1, unit: "s" }) },
    { key: "failuresToday", value: formatNumber(summary?.failuresToday, lang) },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((card) => {
          const tone = cardTone(card.key, alerts);
          return (
            <section key={card.key} data-card={card.key} data-tone={tone}>
              <Kpi label={<h3>{t(`ingest.card.${card.key}`)}</h3>} value={card.value} level={LEVEL[tone]} />
            </section>
          );
        })}
      </div>
      {alerts.map((alert) => (
        <Alert key={alert.code} tone={alertTone(alert.level)}>
          <strong>{t(`ingest.alertLevel.${alert.level}`)}</strong> {alert.message ?? alert.code}
          {alert.causeHints && alert.causeHints.length > 0 && <span> — {t("ingest.monitor.causeHints", { hints: alert.causeHints.join(", ") })}</span>}
        </Alert>
      ))}
    </div>
  );
}
