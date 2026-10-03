/** 측정 항목 속성 입력 칸(UI-DEV-09 편집 패널·새 측정 항목·표준 등록) */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectField, TextArea, TextField } from "~/components/ui";
import { AGGREGATIONS, VALUE_TYPES } from "../model/catalog";
import type { MetricRow } from "../model/types";

export function MetricFields({ metric, creating, fieldErrors }: { metric?: Partial<MetricRow>; creating: boolean; fieldErrors?: Record<string, string> }) {
  const { t } = useTranslation();
  const [valueType, setValueType] = useState(metric?.valueType ?? (fieldErrors?.enumMap ? "ENUM" : "NUMBER"));
  const err = (key: string) => (fieldErrors?.[key] ? t(`catalog.validation.${fieldErrors[key]}`) : undefined);
  const enumText = metric?.enumMap ? Object.entries(metric.enumMap).map(([k, v]) => `${k}=${v}`).join(", ") : "";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {creating && <TextField label={t("catalog.metrics.key")} name="key" defaultValue={metric?.key ?? ""} error={err("key")} hint={t("catalog.metrics.keyHint")} />}
      <TextField label={t("catalog.metrics.displayName")} name="displayName" defaultValue={metric?.displayName ?? metric?.key ?? ""} error={err("displayName")} />
      <TextField label={t("catalog.metrics.unit")} name="unit" defaultValue={metric?.unit ?? ""} />
      <SelectField label={t("catalog.metrics.valueType")} name="valueType" value={valueType} onChange={(e) => setValueType(e.target.value)} error={err("valueType")}>
        {VALUE_TYPES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </SelectField>
      <TextField label={t("catalog.metrics.validMin")} name="validMin" inputMode="decimal" defaultValue={metric?.validMin ?? ""} error={err("validMin")} />
      <TextField label={t("catalog.metrics.validMax")} name="validMax" inputMode="decimal" defaultValue={metric?.validMax ?? ""} error={err("validMax")} />
      <TextField label={t("catalog.metrics.precision")} name="precision" type="number" defaultValue={metric?.precision ?? ""} error={err("precision")} />
      <SelectField label={t("catalog.metrics.aggDefault")} name="aggDefault" defaultValue={metric?.aggDefault ?? "AVG"} error={err("aggDefault")}>
        {AGGREGATIONS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </SelectField>
      {valueType === "ENUM" && <TextArea label={t("catalog.metrics.enumMap")} name="enumMap" rows={2} defaultValue={enumText} placeholder="open=1, close=0" error={err("enumMap")} />}
    </div>
  );
}
