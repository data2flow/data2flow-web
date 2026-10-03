/**
 * UI-SIM-06 가상 공간 물리 설정 폼(SIM-01.02): 프리셋(강의실·사무실·회의실·사용자 정의)을 고르면 값을 채우고,
 * 프리셋과 다른 값은 "변경" 표시, 범위 밖 값은 입력 즉시 문구. 저장 없이 24시간 온도·CO2 곡선 미리 보기(API-SIM-11).
 * 입력 이름은 `physics.{경로}`라 같은 화면 Form이 그대로 action으로 보낸다.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { Button, Checkbox, SelectField, TextField } from "~/components/ui";
import type { ChartSeries } from "~/lib/chart-model";
import type { SimApi } from "../api";
import { PHYSICS_FIELDS, SPACE_PRESETS, changedFromPreset, checkPhysics, getPath, physicsFromForm, presetPhysics } from "../model/sim";
import type { SpacePhysics, SpacePreset } from "../model/types";
import { useProblemText } from "./common";

const GROUPS: { key: string; fields: string[] }[] = [
  { key: "volume", fields: ["areaM2", "heightM", "uValue", "envelopeM2", "windowM2", "solarGainFactor"] },
  { key: "initial", fields: ["initialState.temperature", "initialState.humidity", "initialState.co2", "initialState.pm2_5", "initialState.illumination"] },
  { key: "people", fields: ["outdoorCo2Ppm", "perPerson.heatW", "perPerson.co2Lph", "perPerson.moistureGph", "perPerson.noiseDb", "backgroundNoiseDb"] },
];

function toStrings(physics: SpacePhysics): Record<string, string> {
  return Object.fromEntries(PHYSICS_FIELDS.map((p) => [p, getPath(physics, p) === null || getPath(physics, p) === undefined ? "" : String(getPath(physics, p))]));
}

export function PhysicsForm({
  initialPreset,
  initialPhysics,
  canEdit,
  serverErrors,
  api,
  spaceId,
  timezone,
  chartFactory,
}: {
  initialPreset: SpacePreset;
  initialPhysics: SpacePhysics;
  canEdit: boolean;
  serverErrors?: Record<string, string>;
  api: Pick<SimApi, "preview">;
  spaceId?: string;
  timezone: string;
  chartFactory?: ChartFactory;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [preset, setPreset] = useState<SpacePreset>(initialPreset);
  const [values, setValues] = useState<Record<string, string>>(() => toStrings(initialPhysics));
  const [linked, setLinked] = useState(initialPhysics.outdoorLinked);
  const [orientation, setOrientation] = useState(initialPhysics.windowOrientation ?? "");
  const [occupancy, setOccupancy] = useState("0");
  const [preview, setPreview] = useState<ChartSeries[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const physics = useMemo(() => {
    const map = new Map(Object.entries(values).map(([k, v]) => [`physics.${k}`, v]));
    map.set("physics.outdoorLinked", String(linked));
    map.set("physics.windowOrientation", orientation);
    return physicsFromForm(map, initialPhysics);
  }, [values, linked, orientation, initialPhysics]);
  const problems = checkPhysics(physics);
  const changed = new Set(preset === "CUSTOM" ? [] : changedFromPreset(physics, preset));

  const choosePreset = (next: SpacePreset) => {
    setPreset(next);
    if (next === "CUSTOM") return;
    const p = presetPhysics(next);
    setValues(toStrings(p));
    setLinked(p.outdoorLinked);
    setOrientation(p.windowOrientation ?? "");
  };

  const runPreview = async () => {
    setPreviewError(null);
    const body: Record<string, unknown> = { physics, hours: 24, condition: { occupancy: Number(occupancy) || 0 } };
    if (spaceId) body.spaceId = spaceId;
    const result = await api.preview(body);
    if (!result.ok) {
      setPreview(null);
      setPreviewError(t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }));
      return;
    }
    const s = result.data.series ?? {};
    setPreview(
      (["temperature", "co2"] as const)
        .filter((m) => s[m]?.length)
        .map((m) => ({ key: m, label: t(`sim.metric.${m}`), unit: m === "co2" ? "ppm" : "℃", virtual: true, points: s[m].map((p) => [p.t, p.v, null] as [string, number, null]) })),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <SelectField label={t("sim.space.preset")} name="preset" value={preset} onChange={(e) => choosePreset(e.target.value as SpacePreset)} disabled={!canEdit}>
        {SPACE_PRESETS.map((p) => (
          <option key={p} value={p}>
            {t(`sim.preset.${p}`)}
          </option>
        ))}
      </SelectField>
      {GROUPS.map((group) => (
        <fieldset key={group.key} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <legend className="mb-1 text-[12px] font-semibold text-muted">{t(`sim.physics.group.${group.key}`)}</legend>
          {group.fields.map((path) => (
            <TextField
              key={path}
              label={
                <>
                  {t(`sim.physics.${path}`)}
                  {changed.has(path) && <span className="ml-1 text-accent">{t("sim.physics.changed")}</span>}
                </>
              }
              name={`physics.${path}`}
              inputMode="decimal"
              value={values[path] ?? ""}
              disabled={!canEdit}
              onChange={(e) => setValues((prev) => ({ ...prev, [path]: e.target.value }))}
              error={problemText(problems[path]) ?? serverErrors?.[path]}
            />
          ))}
        </fieldset>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <SelectField label={t("sim.physics.windowOrientation")} name="physics.windowOrientation" value={orientation} onChange={(e) => setOrientation(e.target.value)} disabled={!canEdit}>
          <option value="">–</option>
          {["N", "E", "S", "W"].map((o) => (
            <option key={o} value={o}>
              {t(`sim.physics.orientation.${o}`)}
            </option>
          ))}
        </SelectField>
        <div className="self-end">
          <input type="hidden" name="physics.outdoorLinked" value={String(linked)} />
          <Checkbox label={t("sim.physics.outdoorLinked")} checked={linked} disabled={!canEdit} onChange={(e) => setLinked(e.target.checked)} />
        </div>
      </div>
      <section aria-label={t("sim.physics.previewTitle")} className="flex flex-col gap-2 rounded-md border border-line p-3">
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label={t("sim.physics.previewCondition")} value={occupancy} onChange={(e) => setOccupancy(e.target.value)}>
            <option value="0">{t("sim.physics.occupancyN", { n: 0 })}</option>
            <option value="30">{t("sim.physics.occupancyN", { n: 30 })}</option>
          </SelectField>
          <Button onClick={runPreview} disabled={Object.keys(problems).length > 0}>
            {t("sim.physics.preview")}
          </Button>
        </div>
        {previewError && (
          <p role="alert" className="text-[12.5px] text-bad">
            {previewError}
          </p>
        )}
        {preview && <TimeseriesChart series={preview} timezone={timezone} height={220} factory={chartFactory} title={t("sim.physics.previewTitle")} />}
      </section>
    </div>
  );
}
