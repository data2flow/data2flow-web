/**
 * 왼쪽 시계열 목록(UI-TSD-01): 색, 이름, 측정 항목, 집계 함수, 숨기기, 제거, [+ 시계열 추가].
 */
import { useTranslation } from "react-i18next";
import { Button, cx } from "~/components/ui";
import { AGGS, MAX_SERIES, removeSeries, updateSeries, type ExploreState } from "../model/state";

/** 차트 계열 색과 같은 순서(lib/chart-model 팔레트) */
export const SERIES_COLORS = ["#206bc4", "#2f9e44", "#b7791f", "#ae3ec9", "#d63939", "#0ca678", "#f76707", "#4263eb"];

export function SeriesPanel({ state, onChange, onAdd }: { state: ExploreState; onChange: (next: ExploreState) => void; onAdd: () => void }) {
  const { t } = useTranslation();
  let visibleIndex = -1;
  return (
    <section aria-label={t("explore.series.title")} className="flex flex-col gap-2">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{t("explore.series.title")}</h2>
      {state.series.length === 0 && <p className="text-[12.5px] text-muted">{t("explore.series.empty")}</p>}
      <ul className="flex flex-col gap-1.5">
        {state.series.map((s, index) => {
          if (!s.hidden) visibleIndex += 1;
          const color = s.hidden ? "transparent" : SERIES_COLORS[visibleIndex % SERIES_COLORS.length];
          return (
            <li key={`${s.kind}${s.id}.${s.metric}`} className={cx("rounded-md border border-line p-2 text-[12.5px]", s.hidden && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-sm border border-line" style={{ background: color }} />
                <span className="flex-1 truncate font-medium" title={s.label}>
                  {s.label}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-muted">
                <span className="font-mono">{s.metric}</span>
                {s.kind === "space" && (
                  <select
                    aria-label={t("explore.series.agg", { name: s.label })}
                    value={s.agg ?? "avg"}
                    onChange={(e) => onChange(updateSeries(state, index, { agg: e.target.value }))}
                    className="rounded border border-line bg-panel px-1 text-[12px]"
                  >
                    {AGGS.filter((a) => ["avg", "min", "max", "sum"].includes(a)).map((a) => (
                      <option key={a} value={a}>
                        {t(`explore.agg.${a}`)}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="text-accent hover:underline" onClick={() => onChange(updateSeries(state, index, { hidden: !s.hidden }))}>
                  {s.hidden ? t("explore.series.show") : t("explore.series.hide")}
                </button>
                <button type="button" className="text-bad hover:underline" aria-label={t("explore.series.removeOf", { name: s.label })} onClick={() => onChange(removeSeries(state, index))}>
                  {t("common.remove")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {/* TSD-03.03: 50개면 추가 버튼을 막는다 */}
      <Button onClick={onAdd} disabled={state.series.length >= MAX_SERIES}>
        {t("explore.series.add")}
      </Button>
      {state.series.length >= MAX_SERIES && <p className="text-[12px] text-muted">{t("explore.tooMany")}</p>}
    </section>
  );
}
