/**
 * 대상 선택 위젯(UI-FLW-16, 트리거·제어 노드): (기기 직접) / (공간 + 관계 measures·controls + 하위 포함) / (기기 모델) / (태그).
 * 고른 결과로 "현재 대상 N대"를 보여 준다.
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox, SelectField, TextField } from "~/components/ui";
import { SpaceSelect } from "~/components/space-picker";
import { descendantIds, type SpaceNode } from "~/lib/spaces";

export interface TargetDevice {
  id: string;
  name: string;
  spaceId?: string | null;
  modelId?: string | null;
  tags?: string[];
}

export interface TargetValue {
  deviceIds?: string[];
  spaceId?: string;
  relation?: "measures" | "controls";
  includeChildren?: boolean;
  modelId?: string;
  tags?: string[];
}

export type TargetMode = "devices" | "space" | "model" | "tags";

export function targetMode(value: TargetValue | undefined): TargetMode {
  if (value?.deviceIds) return "devices";
  if (value?.modelId !== undefined) return "model";
  if (value?.tags) return "tags";
  return "space";
}

/** 현재 대상 기기 수 */
export function countTargets(value: TargetValue | undefined, devices: TargetDevice[], spaces: SpaceNode[]): number {
  if (!value) return 0;
  switch (targetMode(value)) {
    case "devices":
      return value.deviceIds?.length ?? 0;
    case "model":
      return devices.filter((d) => d.modelId && d.modelId === value.modelId).length;
    case "tags":
      return devices.filter((d) => (value.tags ?? []).some((tag) => d.tags?.includes(tag))).length;
    default: {
      if (!value.spaceId) return 0;
      const ids = new Set([value.spaceId, ...(value.includeChildren ? descendantIds(spaces, value.spaceId) : [])]);
      return devices.filter((d) => d.spaceId && ids.has(String(d.spaceId))).length;
    }
  }
}

export function TargetField({
  label,
  value,
  onChange,
  spaces,
  devices,
  models,
  defaultRelation = "measures",
  error,
  disabled,
}: {
  label: string;
  value: TargetValue | undefined;
  onChange: (value: TargetValue) => void;
  spaces: SpaceNode[];
  devices: TargetDevice[];
  models: { id: string; name: string }[];
  defaultRelation?: "measures" | "controls";
  error?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const legendId = useId();
  const mode = targetMode(value);
  const setMode = (next: TargetMode) => {
    if (next === "devices") onChange({ deviceIds: [] });
    else if (next === "model") onChange({ modelId: "" });
    else if (next === "tags") onChange({ tags: [] });
    else onChange({ spaceId: "", relation: defaultRelation, includeChildren: false });
  };
  const count = countTargets(value, devices, spaces);
  const base: TargetValue = { relation: defaultRelation, includeChildren: false, ...value };
  return (
    <fieldset aria-labelledby={legendId} className="flex flex-col gap-2 rounded-md border border-line p-2">
      <legend id={legendId} className="text-[12.5px] font-medium text-muted">
        {label}
      </legend>
      <SelectField label={t("flows.target.mode")} value={mode} disabled={disabled} onChange={(e) => setMode(e.target.value as TargetMode)}>
        {(["space", "devices", "model", "tags"] as const).map((m) => (
          <option key={m} value={m}>
            {t(`flows.target.modes.${m}`)}
          </option>
        ))}
      </SelectField>
      {mode === "space" && (
        <>
          <SpaceSelect spaces={spaces} label={t("flows.target.space")} value={value?.spaceId ?? ""} disabled={disabled} onChange={(e) => onChange({ ...base, spaceId: e.target.value })} />
          <SelectField label={t("flows.target.relation")} value={value?.relation ?? defaultRelation} disabled={disabled} onChange={(e) => onChange({ ...base, relation: e.target.value as "measures" | "controls" })}>
            <option value="measures">{t("flows.target.measures")}</option>
            <option value="controls">{t("flows.target.controls")}</option>
          </SelectField>
          <Checkbox label={t("flows.target.includeChildren")} checked={Boolean(value?.includeChildren)} disabled={disabled} onChange={(e) => onChange({ ...base, includeChildren: e.target.checked })} />
        </>
      )}
      {mode === "devices" && (
        <div role="group" aria-label={t("flows.target.devices")} className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {devices.length === 0 && <p className="text-[12px] text-muted">{t("flows.target.noDevices")}</p>}
          {devices.map((d) => (
            <Checkbox
              key={d.id}
              label={d.name}
              disabled={disabled}
              checked={value?.deviceIds?.includes(d.id) ?? false}
              onChange={(e) => onChange({ deviceIds: e.target.checked ? [...(value?.deviceIds ?? []), d.id] : (value?.deviceIds ?? []).filter((id) => id !== d.id) })}
            />
          ))}
        </div>
      )}
      {mode === "model" && (
        <SelectField label={t("flows.target.model")} value={value?.modelId ?? ""} disabled={disabled} onChange={(e) => onChange({ modelId: e.target.value })}>
          <option value="">{t("flows.target.chooseModel")}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
      )}
      {mode === "tags" && (
        <TextField
          label={t("flows.target.tags")}
          disabled={disabled}
          defaultValue={(value?.tags ?? []).join(", ")}
          onChange={(e) => onChange({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      )}
      <p className="text-[12px] text-muted">{t("flows.target.count", { n: count })}</p>
      {error && (
        <p role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}
