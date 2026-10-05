/** 기간·지속 시간 위젯(UI-FLW-16): 숫자 + 단위(초/분/시간), 값은 ISO-8601(`PT5M`)로 저장한다 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { joinDuration, splitDuration, type DurationUnit } from "../model/duration";

export function DurationField({ label, value, onChange, error, disabled }: { label: string; value: unknown; onChange: (iso: string | undefined) => void; error?: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const initial = splitDuration(value);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);
  const update = (nextAmount: string, nextUnit: DurationUnit) => {
    setAmount(nextAmount);
    setUnit(nextUnit);
    onChange(joinDuration(nextAmount, nextUnit) ?? (nextAmount.trim() === "" ? undefined : `invalid:${nextAmount}`));
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted">
        {label}
      </label>
      <div className="flex gap-1">
        <input
          id={id}
          type="number"
          min={0}
          inputMode="numeric"
          value={amount}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(e) => update(e.target.value, unit)}
          className="w-24 rounded-md border border-line bg-panel px-2 py-1.5 text-[13.5px] aria-[invalid=true]:border-bad"
        />
        <select aria-label={t("flows.duration.unit", { label })} value={unit} disabled={disabled} onChange={(e) => update(amount, e.target.value as DurationUnit)} className="rounded-md border border-line bg-panel px-2 py-1.5 text-[13.5px]">
          {(["s", "m", "h"] as const).map((u) => (
            <option key={u} value={u}>
              {t(`flows.duration.${u}`)}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-bad-ink">
          {error}
        </p>
      )}
    </div>
  );
}
