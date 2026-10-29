/**
 * UI-CMP-06 준수 현황판 본문(CMP-02.01): 요약 카드, 공간 표(충족률·이탈 상위 3·결측률·연속 달성 막대·점수), 펼친 줄의 일별 막대와 이탈 구간.
 * 이탈 구간마다 [개선 조치 기록](UI-CMP-10) 링크가 있고, 조치가 있으면 [조치 보기]다.
 * 연속 달성이 깨진 줄은 빨간 테두리와 "D-n 깨짐: 항목", 결측률 10% 초과는 "데이터 품질 기준 미달" 경고.
 */
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Badge, Kpi, Table, cx } from "~/components/ui";
import { formatDateTime, formatNumber } from "~/lib/format";
import { GRADE_TEXT, gradeOf, percent, type DailyStatus, type SpaceStatus, type StatusRow, type StatusView } from "../model/status";
import { metricName } from "./score-card";

export const rowKey = (r: StatusRow) => `${r.space.id}:${r.profile.id}`;

export function StatusSummary({ summary }: { summary: StatusView["summary"] }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label={t("compliance.status.avgRatio")} value={percent(summary.avgRatio)} unit={summary.avgRatio === null || summary.avgRatio === undefined ? undefined : "%"} />
      <Kpi label={t("compliance.status.exceededHours")} value={formatNumber(summary.exceededHours, "ko", { precision: 1 })} unit="h" />
      <Kpi label={t("compliance.status.streaking")} value={summary.streakingSpaces} />
      <Kpi label={t("compliance.status.qualityWarnings")} value={summary.qualityWarnings} level={summary.qualityWarnings > 0 ? "fair" : undefined} />
    </div>
  );
}

/** 이탈 시간 상위 3 항목("CO2 18h, PM2.5 9h") */
function exceededText(t: (key: string, options?: Record<string, unknown>) => string, row: StatusRow): string {
  const top = row.exceededByMetric.filter((m) => m.hours > 0).slice(0, 3);
  return top.length ? top.map((m) => `${metricName(t, m.metricKey)} ${m.hours}h`).join(", ") : "–";
}

/** 연속 달성 막대("47/90일"), 요구 일수가 없으면 일수만 */
function StreakBar({ streak }: { streak: StatusRow["streak"] }) {
  const { t } = useTranslation();
  if (!streak.requiredDays) return <span className="text-muted">–</span>;
  const ratio = Math.min(1, streak.currentDays / streak.requiredDays);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded bg-line2" aria-hidden>
        <span className="block h-full bg-good" style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="text-[12px] [font-feature-settings:'tnum']">{t("compliance.status.streakDays", { current: streak.currentDays, required: streak.requiredDays })}</span>
    </span>
  );
}

export function StatusTable({ rows, openKey, detail, linkFor, timezone, lang }: {
  rows: StatusRow[];
  openKey: string | null;
  detail: SpaceStatus | null;
  /** 줄을 펼치거나 접는 주소 */
  linkFor: (key: string | null) => string;
  timezone: string;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <Table>
      <thead>
        <tr>
          <th>{t("compliance.status.space")}</th>
          <th>{t("compliance.status.profile")}</th>
          <th>{t("compliance.status.ratio")}</th>
          <th>{t("compliance.status.exceeded")}</th>
          <th>{t("compliance.status.missing")}</th>
          <th>{t("compliance.status.streak")}</th>
          <th>{t("compliance.status.score")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const key = rowKey(r);
          const open = key === openKey;
          const broken = r.streak.brokenOn && r.streak.currentDays === 0;
          const grade = gradeOf(r.score);
          return (
            <Fragment key={key}>
              <tr data-status-row={key} className={cx(broken && "outline outline-1 -outline-offset-1 outline-bad")}>
                <td>
                  <Link to={linkFor(open ? null : key)} aria-expanded={open} className="font-medium">
                    {open ? "▼" : "▶"} {r.space.name ?? r.space.id}
                  </Link>
                </td>
                <td>
                  {r.profile.name} <span className="text-muted">v{r.profile.versionNo}</span>
                </td>
                <td className="[font-feature-settings:'tnum']">{r.ratio === null || r.ratio === undefined ? "–" : `${percent(r.ratio)}%`}</td>
                <td>{exceededText(t, r)}</td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    {percent(r.missingRatio)}%
                    {r.qualityWarning && (
                      <span title={t("compliance.status.qualityWarning")} aria-label={t("compliance.status.qualityWarning")} className="text-fair-ink">
                        ⚠
                      </span>
                    )}
                  </span>
                </td>
                <td>
                  {broken ? (
                    <Badge tone="danger">
                      {t("compliance.status.broken", { days: daysSince(r.streak.brokenOn!), metric: metricName(t, r.streak.brokenMetric ?? "") })}
                    </Badge>
                  ) : (
                    <StreakBar streak={r.streak} />
                  )}
                </td>
                <td className={cx("font-semibold [font-feature-settings:'tnum']", grade && GRADE_TEXT[grade])}>{r.score ?? "–"}</td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={7} className="bg-panel2">
                    {detail ? <SpaceDetail detail={detail} timezone={timezone} lang={lang} /> : <p className="text-[12.5px] text-muted">{t("compliance.status.detailFailed")}</p>}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}

/** 깨진 날 표기용 경과(D-n): 깨진 날부터 오늘까지 날 수 */
function daysSince(day: string): number {
  const ms = Date.now() - new Date(`${day}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** 하루 막대: 초록 충족, 빨강 이탈, 회색 결측(높이는 분 비율) */
function DayBar({ day }: { day: DailyStatus }) {
  const { t } = useTranslation();
  const all = day.metMinutes + day.exceededMinutes + day.missingMinutes || 1;
  const pct = (n: number) => `${(n / all) * 100}%`;
  const label = t("compliance.status.dayLabel", { day: day.day, ratio: percent(day.ratio), exceeded: day.exceededMinutes, missing: day.missingMinutes });
  return (
    <span className="flex h-10 w-2.5 flex-col-reverse overflow-hidden rounded-sm" title={label} aria-label={label} role="img">
      <span className="bg-good" style={{ height: pct(day.metMinutes) }} />
      <span className="bg-bad" style={{ height: pct(day.exceededMinutes) }} />
      <span className="bg-line" style={{ height: pct(day.missingMinutes) }} />
    </span>
  );
}

export function SpaceDetail({ detail, timezone, lang }: { detail: SpaceStatus; timezone: string; lang: string }) {
  const { t } = useTranslation();
  return (
    <div data-space-detail className="flex flex-col gap-3 py-1">
      <div>
        <p className="cap mb-1.5">{t("compliance.status.daily")}</p>
        {detail.daily.length ? (
          <div className="flex flex-wrap items-end gap-0.5">
            {detail.daily.map((d) => (
              <DayBar key={d.day} day={d} />
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">{t("compliance.status.noDaily")}</p>
        )}
      </div>
      <div>
        <p className="cap mb-1.5">{t("compliance.status.excursions")}</p>
        {detail.excursions.length ? (
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {detail.excursions.map((x) => (
              <li key={x.id} className="flex flex-wrap gap-x-3">
                <span>
                  {formatDateTime(x.startedAt, timezone, lang)} ~ {x.endedAt ? formatDateTime(x.endedAt, timezone, lang) : t("compliance.status.ongoing")}
                </span>
                <span className="font-medium">{metricName(t, x.metricKey)}</span>
                <span>{t("compliance.status.peak", { value: formatNumber(x.peakValue, lang, { precision: 1 }) })}</span>
                {x.alarmId && <span className="text-muted">{t("compliance.status.alarm", { id: x.alarmId })}</span>}
                <Link className="text-accent hover:underline" to={`/compliance/excursions/${x.id}`}>
                  {x.hasAction ? t("compliance.status.viewActions") : t("compliance.status.recordAction")}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">{t("compliance.status.noExcursions")}</p>
        )}
      </div>
    </div>
  );
}
