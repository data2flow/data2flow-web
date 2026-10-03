/**
 * 제어 노드 위젯(UI-FLW-16): 기능 선택 → 명령 선택 → 인자 폼(기능 정의의 인자 스키마, API-ACT-25).
 * 범위를 벗어난 값은 입력 단계에서 거부하고(설정에 넣지 않음) 허용 범위를 알려 준다. 예: Thermostat.set(mode=cool, targetTemperature=24)
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectField, TextField } from "~/components/ui";
import type { CapabilityAttribute, CapabilityDetail, CapabilitySummary, FlowApi } from "../api";

export interface ControlValue {
  capability?: string;
  command?: string;
  args?: Record<string, unknown>;
}

/** 인자 하나 검사: 범위·단위(step)·열거값 */
export function checkArg(attr: CapabilityAttribute, raw: string): { value?: unknown; problem?: "range" | "step" | "enum" | "number" } {
  if (attr.type === "enum") return attr.enum && !attr.enum.includes(raw) ? { problem: "enum" } : { value: raw };
  if (attr.type === "boolean") return { value: raw === "true" };
  if (attr.type === "number" || attr.type === "integer") {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n) || (attr.type === "integer" && !Number.isInteger(n))) return { problem: "number" };
    if ((attr.min !== undefined && n < attr.min) || (attr.max !== undefined && n > attr.max)) return { problem: "range" };
    if (attr.step && Math.abs(Math.round(n / attr.step) * attr.step - n) > 1e-9) return { problem: "step" };
    return { value: n };
  }
  return { value: raw };
}

/** 명령이 바꾸는 속성(sets) — 없으면 읽기 전용이 아닌 모든 속성 */
export function commandArgs(detail: CapabilityDetail | null, command: string | undefined): CapabilityAttribute[] {
  if (!detail) return [];
  const cmd = detail.commands.find((c) => c.name === command);
  const writable = detail.attributes.filter((a) => !a.readOnly);
  if (!cmd?.sets) return writable;
  return writable.filter((a) => cmd.sets!.includes(a.name));
}

export function ControlFields({ value, onChange, api, disabled }: { value: ControlValue; onChange: (patch: ControlValue) => void; api: Pick<FlowApi, "capabilities" | "capability">; disabled?: boolean }) {
  const { t } = useTranslation();
  const [list, setList] = useState<CapabilitySummary[]>([]);
  const [detail, setDetail] = useState<CapabilityDetail | null>(null);
  const [raw, setRaw] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(value.args ?? {}).map(([k, v]) => [k, String(v)])));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.capabilities().then((r) => {
      if (!alive) return;
      if (r.ok) setList(r.data.responses ?? []);
      else setLoadError(true);
    });
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    let alive = true;
    if (!value.capability) {
      setDetail(null);
      return;
    }
    void api.capability(value.capability).then((r) => {
      if (alive) setDetail(r.ok ? r.data : null);
    });
    return () => {
      alive = false;
    };
  }, [api, value.capability]);

  const attrs = commandArgs(detail, value.command);
  const setArg = (attr: CapabilityAttribute, text: string) => {
    setRaw((prev) => ({ ...prev, [attr.name]: text }));
    const args = { ...(value.args ?? {}) };
    if (text.trim() === "") {
      delete args[attr.name];
      setProblems((p) => ({ ...p, [attr.name]: "" }));
      onChange({ args });
      return;
    }
    const checked = checkArg(attr, text);
    if (checked.problem) {
      setProblems((p) => ({ ...p, [attr.name]: t(`flows.control.problem.${checked.problem}`, { min: attr.min ?? "", max: attr.max ?? "", step: attr.step ?? "", unit: attr.unit ?? "" }) }));
      return;
    }
    setProblems((p) => ({ ...p, [attr.name]: "" }));
    onChange({ args: { ...args, [attr.name]: checked.value } });
  };

  return (
    <div className="flex flex-col gap-2">
      {loadError && <p className="text-[12px] text-warn">{t("flows.control.loadFailed")}</p>}
      <SelectField label={t("flows.control.capability")} value={value.capability ?? ""} disabled={disabled} onChange={(e) => onChange({ capability: e.target.value, command: undefined, args: {} })}>
        <option value="">{t("flows.control.choose")}</option>
        {[...new Set([...(value.capability ? [value.capability] : []), ...list.map((c) => c.name)])].map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </SelectField>
      <SelectField label={t("flows.control.command")} value={value.command ?? ""} disabled={disabled || !detail} onChange={(e) => onChange({ command: e.target.value })}>
        <option value="">{t("flows.control.choose")}</option>
        {[...new Set([...(value.command ? [value.command] : []), ...(detail?.commands ?? []).map((c) => c.name)])].map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </SelectField>
      {attrs.map((attr) => {
        const label = `${attr.name}${attr.unit ? ` (${attr.unit})` : ""}`;
        if (attr.type === "enum") {
          return (
            <SelectField key={attr.name} label={label} value={raw[attr.name] ?? ""} disabled={disabled} onChange={(e) => setArg(attr, e.target.value)}>
              <option value="">{t("flows.control.unset")}</option>
              {(attr.enum ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectField>
          );
        }
        if (attr.type === "boolean") {
          return (
            <SelectField key={attr.name} label={label} value={raw[attr.name] ?? ""} disabled={disabled} onChange={(e) => setArg(attr, e.target.value)}>
              <option value="">{t("flows.control.unset")}</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </SelectField>
          );
        }
        return (
          <TextField
            key={attr.name}
            label={label}
            type="number"
            min={attr.min}
            max={attr.max}
            step={attr.step ?? "any"}
            value={raw[attr.name] ?? ""}
            disabled={disabled}
            hint={attr.min !== undefined && attr.max !== undefined ? t("flows.control.range", { min: attr.min, max: attr.max, unit: attr.unit ?? "" }) : undefined}
            error={problems[attr.name] || undefined}
            onChange={(e) => setArg(attr, e.target.value)}
          />
        );
      })}
    </div>
  );
}
