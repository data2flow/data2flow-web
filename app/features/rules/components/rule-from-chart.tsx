/**
 * RUL-01.13 데이터 탐색 차트에서 규칙 만들기(UI-TSD-01 → UI-RUL-02, TC-RUL-036 AT-RUL-05.1).
 * 계열 하나와 기준선 값(y), 연산자를 고르면 `/rules/new?fromChart=1…`로 간다. 새 규칙 loader가 API-RUL-07로 폼 기본값을 받아 채운다.
 * RULE_WRITE가 없거나 계열이 없으면 그리지 않는다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import type { SeriesSpec } from "~/features/explore/model/state";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";

const OPS = [">", ">=", "<", "<="] as const;
const control = "rounded-md border border-line bg-panel px-2 py-1 text-[13px]";

/** 새 규칙 주소(초안 매개변수) */
export function ruleDraftUrl(spec: Pick<SeriesSpec, "kind" | "id" | "metric">, op: string, value: number): string {
  const params = new URLSearchParams({ fromChart: "1", metric: spec.metric, op, value: String(value) });
  if (spec.kind === "space") params.set("spaceId", spec.id);
  else params.append("deviceIds", spec.id);
  return `/rules/new?${params}`;
}

export function RuleFromChart({ series }: { series: SeriesSpec[] }) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const visible = series.filter((s) => !s.hidden);
  const [index, setIndex] = useState(0);
  const [op, setOp] = useState<string>(">");
  const [value, setValue] = useState("");
  if (!hasAny(root?.me?.permissions, ["RULE_WRITE"]) || visible.length === 0) return null;
  const spec = visible[Math.min(index, visible.length - 1)];
  const number = Number(value);
  const ready = value.trim() !== "" && Number.isFinite(number);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]" role="group" aria-label={t("rules.fromChart.title")}>
      <span className="font-medium">{t("rules.fromChart.title")}</span>
      <select className={control} aria-label={t("rules.fromChart.series")} value={index} onChange={(e) => setIndex(Number(e.target.value))}>
        {visible.map((s, i) => (
          <option key={`${s.kind}-${s.id}-${s.metric}`} value={i}>
            {s.label}
          </option>
        ))}
      </select>
      <select className={control} aria-label={t("rules.cond.op")} value={op} onChange={(e) => setOp(e.target.value)}>
        {OPS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <input className={`${control} w-28`} type="number" step="any" aria-label={t("rules.fromChart.baseline")} placeholder={t("rules.fromChart.baseline")} value={value} onChange={(e) => setValue(e.target.value)} />
      {ready ? (
        <Link to={ruleDraftUrl(spec, op, number)} className="rounded-md border border-accent px-2.5 py-1 text-accent hover:bg-accent-soft">
          {t("rules.fromChart.create")}
        </Link>
      ) : (
        <span className="text-muted">{t("rules.fromChart.hint")}</span>
      )}
    </div>
  );
}
