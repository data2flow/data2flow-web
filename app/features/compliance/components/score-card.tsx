/**
 * UI-CMP-05 종합 실내 환경 점수 카드(CMP-01.05). 점수(색: 80↑ 초록, 60~79 노랑, 40~59 주황, 40 미만 빨강), 항목별 지수 막대(1~5),
 * 감점 1순위, 계산 시각, 기준 출처(기본 기준 배지), [계산식 보기]로 공개 계산식과 이번 입력값(API-CMP-10 `include=inputs`).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, cx } from "~/components/ui";
import { formatDateTime, formatNumber } from "~/lib/format";
import { GRADE_BAR, GRADE_TEXT, gradeOf, type ScoreView } from "../model/status";
import { limitText } from "../model/format";

export function metricName(t: (key: string, options?: Record<string, unknown>) => string, key: string): string {
  return t(`compliance.metric.${key}`, { defaultValue: key });
}

export function ScoreCard({ score, timezone, lang }: { score: ScoreView; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const grade = score.grade ?? gradeOf(score.score);
  const entries = Object.entries(score.indices);
  return (
    <Card>
      <div data-score-card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="cap">{t("compliance.score.title")}</p>
          <div className="flex flex-wrap gap-1.5">
            {score.basis === "DEFAULT" && <Badge tone="neutral">{t("compliance.score.defaultBasis")}</Badge>}
            {score.partial && <Badge tone="warning">{t("compliance.score.partial")}</Badge>}
          </div>
        </div>
        {score.score === null || score.score === undefined ? (
          <p className="text-[13px] text-muted">{t("compliance.score.noData")}</p>
        ) : (
          <p className="flex items-baseline gap-2">
            <span className={cx("text-[34px] leading-none font-semibold [font-feature-settings:'tnum']", grade && GRADE_TEXT[grade])}>{score.score}</span>
            {grade && <span className={cx("text-[13px] font-medium", GRADE_TEXT[grade])}>● {t(`compliance.grade.${grade}`)}</span>}
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {entries.map(([key, index]) => (
            <li key={key} className="grid grid-cols-[72px_1fr_24px] items-center gap-2 text-[12.5px]">
              <span className="truncate">{metricName(t, key)}</span>
              <span className="flex gap-0.5" aria-hidden>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={cx("h-2 flex-1 rounded-sm", index !== null && n <= index ? GRADE_BAR[gradeOf((index - 1) * 25) ?? "BAD"] : "bg-line2")} />
                ))}
              </span>
              <span className="text-right [font-feature-settings:'tnum']" aria-label={t("compliance.score.indexOf", { metric: metricName(t, key) })}>
                {index ?? "–"}
              </span>
            </li>
          ))}
        </ul>
        {score.topPenaltyMetric && (
          <p className="text-[12.5px]">
            {t("compliance.score.topPenalty", {
              metric: metricName(t, score.topPenaltyMetric),
              value: formatNumber(score.topPenaltyValue, lang, { precision: 0, unit: score.inputs?.find((i) => i.metricKey === score.topPenaltyMetric)?.unit }),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
          <span>{t("compliance.score.at", { time: formatDateTime(score.time, timezone, lang) })}</span>
          <Button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {t("compliance.score.formula")}
          </Button>
        </div>
        {open && (
          <div className="flex flex-col gap-2 border-t border-line2 pt-3 text-[12.5px]">
            <p className="text-muted">{t("compliance.score.formulaText")}</p>
            {score.inputs?.length ? (
              <table className="w-full text-left [&_td]:py-1 [&_th]:py-1 [&_th]:text-[11px] [&_th]:text-muted">
                <thead>
                  <tr>
                    <th>{t("compliance.score.metric")}</th>
                    <th>{t("compliance.score.avg5m")}</th>
                    <th>{t("compliance.score.boundary")}</th>
                    <th>{t("compliance.score.weight")}</th>
                  </tr>
                </thead>
                <tbody>
                  {score.inputs.map((i) => (
                    <tr key={i.metricKey}>
                      <td>{metricName(t, i.metricKey)}</td>
                      <td>{i.avg5m === null || i.avg5m === undefined ? "–" : formatNumber(i.avg5m, lang, { precision: 1, unit: i.unit })}</td>
                      <td>{limitText(i.boundary.lower, i.boundary.upper, true)}</td>
                      <td>{i.weight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p className="text-[11px] text-muted">{score.formulaVersion}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
