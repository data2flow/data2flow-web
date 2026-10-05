/**
 * generic-json 매핑 편집기(UI-DSC-02 4단계, ING-02.03): 기기 ID 위치, 시각 경로, 측정 항목 매핑 표 +
 * 테스트 메시지로 즉시 미리 보기(TC-DSC-045). 경로 문법 오류는 "경로 문법이 올바르지 않습니다: {위치}".
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SelectField, Table, TextArea, TextField } from "~/components/ui";
import { TIME_FORMATS, mappingFromConfig, mappingToConfig, previewMapping, validateMapping, type GenericJsonMapping, type MappingProblem, type TimeFormat } from "../model/mapping";

export function problemText(t: (k: string, o?: Record<string, unknown>) => string, problem: MappingProblem | undefined): string | undefined {
  if (!problem) return undefined;
  return t(`sources.mapping.problem.${problem.code}`, { position: problem.position ?? "", value: problem.value ?? "" });
}

export function MappingEditor({ value, onChange, readOnly = false }: { value: string; onChange: (config: string, valid: boolean) => void; readOnly?: boolean }) {
  const { t } = useTranslation();
  const [mapping, setMapping] = useState<GenericJsonMapping>(() => mappingFromConfig(value));
  const [topic, setTopic] = useState("devices/esp-01/telemetry");
  const [payload, setPayload] = useState('{"temp": 22.4, "ts": 1759449600000}');
  const problems = useMemo(() => validateMapping(mapping), [mapping]);
  const preview = useMemo(() => previewMapping(mapping, topic, payload), [mapping, topic, payload]);
  const problemOf = (field: string) => problems.find((p) => p.field === field);

  const update = (next: GenericJsonMapping) => {
    setMapping(next);
    onChange(mappingToConfig(next), validateMapping(next).length === 0);
  };
  const setMetric = (index: number, patch: Partial<{ path: string; key: string; unit: string }>) => update({ ...mapping, metrics: mapping.metrics.map((m, i) => (i === index ? { ...m, ...patch } : m)) });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <p className="text-[12.5px] font-semibold">{t("sources.mapping.title")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label={t("sources.mapping.deviceIdFrom")} value={mapping.deviceIdFrom} readOnly={readOnly} hint={t("sources.mapping.deviceIdHint")} error={problemText(t, problemOf("deviceIdFrom"))} onChange={(e) => update({ ...mapping, deviceIdFrom: e.target.value })} />
        <TextField label={t("sources.mapping.timePath")} value={mapping.timePath ?? ""} readOnly={readOnly} hint={t("sources.mapping.timeHint")} error={problemText(t, problemOf("timePath"))} onChange={(e) => update({ ...mapping, timePath: e.target.value })} />
        <SelectField label={t("sources.mapping.timeFormat")} value={mapping.timeFormat ?? "AUTO"} disabled={readOnly} onChange={(e) => update({ ...mapping, timeFormat: e.target.value as TimeFormat })}>
          {TIME_FORMATS.map((f) => (
            <option key={f} value={f}>
              {t(`sources.mapping.timeFormats.${f}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <Table>
        <thead>
          <tr>
            <th scope="col">{t("sources.mapping.path")}</th>
            <th scope="col">{t("sources.mapping.key")}</th>
            <th scope="col">{t("sources.mapping.unit")}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {mapping.metrics.map((m, i) => (
            <tr key={i}>
              <td>
                <TextField label={t("sources.mapping.pathN", { n: i + 1 })} value={m.path} readOnly={readOnly} error={problemText(t, problemOf(`metrics.${i}.path`))} onChange={(e) => setMetric(i, { path: e.target.value })} />
              </td>
              <td>
                <TextField label={t("sources.mapping.keyN", { n: i + 1 })} value={m.key} readOnly={readOnly} error={problemText(t, problemOf(`metrics.${i}.key`))} onChange={(e) => setMetric(i, { key: e.target.value })} />
              </td>
              <td>
                <TextField label={t("sources.mapping.unitN", { n: i + 1 })} value={m.unit ?? ""} readOnly={readOnly} error={problemText(t, problemOf(`metrics.${i}.unit`))} onChange={(e) => setMetric(i, { unit: e.target.value })} />
              </td>
              <td>
                {!readOnly && (
                  <Button variant="ghost" onClick={() => update({ ...mapping, metrics: mapping.metrics.filter((_, j) => j !== i) })}>
                    {t("common.remove")}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {problemOf("metrics") && <p className="text-[12px] text-bad-ink">{problemText(t, problemOf("metrics"))}</p>}
      {!readOnly && (
        <div>
          <Button onClick={() => update({ ...mapping, metrics: [...mapping.metrics, { path: "$.", key: "" }] })}>{t("sources.mapping.addMetric")}</Button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <TextField label={t("sources.mapping.sampleTopic")} value={topic} onChange={(e) => setTopic(e.target.value)} />
          <TextArea label={t("sources.mapping.samplePayload")} rows={4} value={payload} onChange={(e) => setPayload(e.target.value)} error={preview.error ? t("sources.mapping.problem.json") : undefined} />
        </div>
        <div aria-live="polite" className="rounded-md bg-bg p-2 text-[13px]">
          <p className="text-[12px] font-semibold text-muted">{t("sources.mapping.preview")}</p>
          <p>
            {t("sources.mapping.externalId")}: <span className="font-mono">{preview.externalId ?? "–"}</span>
          </p>
          <p>
            {t("sources.mapping.measuredAt")}: <span className="font-mono">{preview.measuredAt ?? "–"}</span>
          </p>
          <ul>
            {preview.metrics.map((m, i) => (
              <li key={i} className="font-mono">
                {m.key} = {String(m.value)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
