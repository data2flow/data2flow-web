/**
 * 상단 도구(UI-TSD-01): 기간(1h~90d·직접), 시간대 표시, 집계 단위, 채우기, 품질, 가상 데이터 포함. 바꾸면 바로 다시 조회한다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui";
import { FILLS, QUALITIES, RANGE_KEYS, RESOLUTIONS, type ExploreState } from "../model/state";
import { localToUtc, utcToLocal } from "../model/time";

const select = "rounded-md border border-line bg-panel px-2 py-1 text-[13px]";

export function Toolbar({ state, timezone, onChange }: { state: ExploreState; timezone: string; onChange: (next: ExploreState) => void }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(utcToLocal(state.from, timezone));
  const [to, setTo] = useState(utcToLocal(state.to, timezone));
  const field = (label: string, control: React.ReactNode) => (
    <label className="flex items-center gap-1 text-[12.5px] text-muted">
      {label}
      {control}
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      {field(
        t("explore.tool.range"),
        <select className={select} value={state.range} onChange={(e) => (e.target.value === "custom" ? onChange({ ...state, range: "custom", from: state.from, to: state.to }) : onChange({ ...state, range: e.target.value, from: undefined, to: undefined }))}>
          {RANGE_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`range.${k}`)}
            </option>
          ))}
          <option value="custom">{t("range.custom")}</option>
        </select>,
      )}
      {state.range === "custom" && (
        <span className="flex items-center gap-1">
          <input type="datetime-local" aria-label={t("explore.tool.from")} className={select} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>~</span>
          <input type="datetime-local" aria-label={t("explore.tool.to")} className={select} value={to} onChange={(e) => setTo(e.target.value)} />
          <Button onClick={() => onChange({ ...state, range: "custom", from: localToUtc(from, timezone) ?? state.from, to: localToUtc(to, timezone) ?? state.to })}>{t("common.apply")}</Button>
        </span>
      )}
      {field(
        t("explore.tool.resolution"),
        <select className={select} value={state.resolution} onChange={(e) => onChange({ ...state, resolution: e.target.value as ExploreState["resolution"] })}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {t(`explore.resolution.${r}`)}
            </option>
          ))}
        </select>,
      )}
      {field(
        t("explore.tool.fill"),
        <select className={select} value={state.fill} onChange={(e) => onChange({ ...state, fill: e.target.value as ExploreState["fill"] })}>
          {FILLS.map((f) => (
            <option key={f} value={f}>
              {t(`explore.fill.${f}`)}
            </option>
          ))}
        </select>,
      )}
      {field(
        t("explore.tool.quality"),
        <select className={select} value={state.quality} onChange={(e) => onChange({ ...state, quality: e.target.value as ExploreState["quality"] })}>
          {QUALITIES.map((q) => (
            <option key={q} value={q}>
              {t(`explore.quality.${q}`)}
            </option>
          ))}
        </select>,
      )}
      <label className="flex items-center gap-1 text-[12.5px]">
        <input type="checkbox" checked={state.includeVirtual} onChange={(e) => onChange({ ...state, includeVirtual: e.target.checked })} />
        {t("explore.tool.virtual")}
      </label>
      <span className="ml-auto font-mono text-[12px] text-muted" title={t("explore.tool.timezone")}>
        {timezone}
      </span>
    </div>
  );
}
