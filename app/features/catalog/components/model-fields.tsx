/** 모델 기본 정보 입력 칸(UI-DEV-08 새 모델·정보 탭) */
import { useTranslation } from "react-i18next";
import { SelectField, TextArea, TextField } from "~/components/ui";
import { DEVICE_KINDS, PROTOCOLS } from "../model/catalog";
import type { MetricRow, ModelDetail } from "../model/types";

export function ModelFields({ model, metrics, creating, fieldErrors }: { model?: ModelDetail; metrics: MetricRow[]; creating: boolean; fieldErrors?: Record<string, string> }) {
  const { t } = useTranslation();
  const err = (key: string) => (fieldErrors?.[key] ? t(`catalog.validation.${fieldErrors[key]}`) : undefined);
  const chosen = new Set((model?.metrics ?? []).map((m) => m.key));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {creating && <TextField label={t("catalog.models.code")} name="code" required error={err("code")} hint={t("catalog.models.codeHint")} />}
      <TextField label={t("catalog.models.vendor")} name="vendor" defaultValue={model?.vendor} error={err("vendor")} />
      <TextField label={t("catalog.models.name")} name="name" defaultValue={model?.name} error={err("name")} />
      <SelectField label={t("catalog.models.protocol")} name="protocol" defaultValue={model?.protocol ?? "LORAWAN"} error={err("protocol")}>
        {PROTOCOLS.map((p) => (
          <option key={p} value={p}>
            {t(`catalog.protocol.${p}`)}
          </option>
        ))}
      </SelectField>
      <SelectField label={t("catalog.models.kind")} name="kind" defaultValue={model?.kind ?? "SENSOR"} error={err("kind")}>
        {DEVICE_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`catalog.kind.${k}`)}
          </option>
        ))}
      </SelectField>
      <TextField label={t("catalog.models.interval")} name="defaultIntervalSec" type="number" defaultValue={model?.defaultIntervalSec ?? ""} error={err("defaultIntervalSec")} />
      {creating && (
        <fieldset className="md:col-span-2">
          <legend className="text-[12.5px] font-medium text-muted">{t("catalog.models.metrics")}</legend>
          <div className="flex flex-wrap gap-3">
            {metrics.map((m) => (
              <label key={m.id} className="flex items-center gap-1 text-[13px]">
                <input type="checkbox" name="metrics" value={m.key} defaultChecked={chosen.has(m.key)} />
                <span className="font-mono">{m.key}</span>
              </label>
            ))}
          </div>
          {err("metrics") && (
            <p role="alert" className="text-[12px] text-bad-ink">
              {err("metrics")}
            </p>
          )}
        </fieldset>
      )}
      <TextField label={t("catalog.models.capabilities")} name="capabilities" defaultValue={(model?.capabilities ?? []).map((c) => c.capability).join(", ")} hint={t("catalog.models.capabilitiesHint")} />
      <TextArea label={t("catalog.models.description")} name="description" defaultValue={model?.description ?? ""} rows={2} />
    </div>
  );
}

