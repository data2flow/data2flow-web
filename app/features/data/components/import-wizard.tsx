/**
 * UI-TSD-03 데이터 가져오기 마법사(TSD-04.02): ① 출처(CSV 파일 / InfluxDB) ② 매핑 ③ 미리 실행(API-TSD-30 dryRun=true).
 * 미리 실행 결과와 ④ 실행(API-TSD-32)은 작업 상세(`/imports/{id}`)에서 본다.
 * CSV는 앞 20행을 브라우저에서 읽어 미리 보고 시각을 읽을 수 없는 줄을 표시한다. 파일은 2GB까지(BFF가 버퍼 없이 흘려보낸다).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { COMMON_TIMEZONES } from "~/lib/format";
import { defaultDataApi, type DataApi } from "../api";
import {
  DEVICE_KEYS,
  PREVIEW_ROWS,
  TIME_FORMATS,
  badTimeLines,
  emptyInfluxForm,
  guessMapping,
  influxBody,
  mappingOf,
  parseCsv,
  validateCsv,
  validateInflux,
  type CsvErrors,
  type CsvMappingForm,
  type ImportJob,
  type InfluxErrors,
  type InfluxForm,
} from "../model/imports";

export interface ImportWizardProps {
  timezone: string;
  api?: DataApi;
  onCreated: (job: ImportJob) => void;
  /** 파일 앞부분을 글자로 읽는다(테스트에서 바꿔 넣는다) */
  readHead?: (file: File) => Promise<string>;
}

const HEAD_BYTES = 256 * 1024;
const defaultReadHead = (file: File) => file.slice(0, HEAD_BYTES).text();

export function ImportWizard({ timezone, api = defaultDataApi, onCreated, readHead = defaultReadHead }: ImportWizardProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"CSV" | "INFLUXDB">("CSV");
  const [originLabel, setOriginLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [mapping, setMapping] = useState<CsvMappingForm | null>(null);
  const [influx, setInflux] = useState<InfluxForm>(emptyInfluxForm);
  const [errors, setErrors] = useState<CsvErrors & InfluxErrors>({});
  const [failure, setFailure] = useState<{ code: string; message?: string; errors?: { field: string; message: string }[] }>();
  const [busy, setBusy] = useState(false);

  const rows = mapping ? parseCsv(text, mapping.delimiter) : [];
  const header = rows[0] ?? [];
  const bad = mapping ? badTimeLines(rows, mapping) : [];
  const setMap = (patch: Partial<CsvMappingForm>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const setFlux = (patch: Partial<InfluxForm>) => setInflux((f) => ({ ...f, ...patch }));
  const err = (key: keyof (CsvErrors & InfluxErrors)) => (errors[key] ? t(`data.imports.errors.${key}.${errors[key]}`) : undefined);

  const pick = async (picked: File | null) => {
    setFile(picked);
    setErrors({});
    if (!picked) return;
    const head = await readHead(picked);
    setText(head);
    const first = parseCsv(head, ",", 1)[0] ?? [];
    const delimiter = first.length <= 1 && head.includes(";") ? ";" : ",";
    const columns = parseCsv(head, delimiter, 1)[0] ?? [];
    setMapping({ ...guessMapping(columns, timezone), delimiter });
  };

  const submit = async () => {
    setFailure(undefined);
    if (kind === "CSV") {
      const found = mapping ? validateCsv(mapping, originLabel, file) : ({ file: "required", ...(originLabel.trim() ? {} : { originLabel: "required" }) } as CsvErrors);
      setErrors(found);
      if (Object.keys(found).length || !mapping || !file) return;
      setBusy(true);
      const result = await api.createCsvImport(file, mappingOf(mapping), originLabel.trim(), true);
      setBusy(false);
      if (result.ok) onCreated(result.data);
      else setFailure({ code: result.code, message: result.message, errors: result.errors });
      return;
    }
    const found = validateInflux(influx, originLabel, timezone);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    const result = await api.createInfluxImport(influxBody(influx, originLabel, timezone, true));
    setBusy(false);
    if (result.ok) onCreated(result.data);
    else setFailure({ code: result.code, message: result.message, errors: result.errors });
  };

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-3 text-[12.5px] text-muted" aria-label={t("data.imports.steps")}>
        {["source", "mapping", "dryRun", "run"].map((s, i) => (
          <li key={s} aria-current={i === (mapping || kind === "INFLUXDB" ? 1 : 0) ? "step" : undefined} className={i === (mapping || kind === "INFLUXDB" ? 1 : 0) ? "font-semibold text-accent" : undefined}>
            {`${i + 1}. ${t(`data.imports.step.${s}`)}`}
          </li>
        ))}
      </ol>
      <Card title={t("data.imports.step.source")}>
        <fieldset className="flex gap-4 text-[13px]">
          <legend className="sr-only">{t("data.imports.sourceKind")}</legend>
          {(["CSV", "INFLUXDB"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="radio" name="import-kind" checked={kind === k} onChange={() => setKind(k)} />
              {t(`data.imports.kinds.${k}`)}
            </label>
          ))}
        </fieldset>
        <div className="mt-3">
          <TextField label={t("data.imports.originLabel")} placeholder={t("data.imports.originLabelExample")} value={originLabel} onChange={(e) => setOriginLabel(e.target.value)} error={err("originLabel")} />
        </div>
      </Card>

      {kind === "CSV" ? (
        <Card title={t("data.imports.step.mapping")}>
          <div className="flex flex-col gap-1">
            <label htmlFor="import-file" className="text-[12.5px] font-medium text-muted">
              {t("data.imports.file")}
            </label>
            <input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
            {errors.file && (
              <p role="alert" className="text-[12px] text-bad">
                {err("file")}
              </p>
            )}
          </div>
          {mapping && (
            <div className="mt-3 flex flex-col gap-3">
              <Table>
                <caption className="text-left text-[12px] text-muted">{t("data.imports.previewCaption", { n: Math.min(PREVIEW_ROWS, Math.max(0, rows.length - 1)) })}</caption>
                <thead>
                  <tr>
                    <th>#</th>
                    {header.map((h, i) => (
                      <th key={`${h}${i}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((row, i) => (
                    <tr key={i} className={bad.includes(i + 2) ? "bg-bad-soft" : undefined}>
                      <td className="font-mono">{i + 2}</td>
                      {header.map((_, j) => (
                        <td key={j} className="font-mono">
                          {row[j] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {bad.length > 0 && <Alert tone="warning">{t("data.imports.badTime", { lines: bad.join(", ") })}</Alert>}
              <div className="grid gap-2 sm:grid-cols-3">
                <SelectField label={t("data.imports.timeColumn")} value={mapping.timeColumn} onChange={(e) => setMap({ timeColumn: e.target.value })} error={err("timeColumn")}>
                  <option value="">{t("data.schedule.choose")}</option>
                  {header.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={t("data.imports.timeFormat")} value={mapping.timeFormat} onChange={(e) => setMap({ timeFormat: e.target.value as CsvMappingForm["timeFormat"] })}>
                  {TIME_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {t(`data.imports.timeFormats.${f}`)}
                    </option>
                  ))}
                </SelectField>
                {mapping.timeFormat === "CUSTOM" ? (
                  <TextField label={t("data.imports.customPattern")} placeholder="yyyy-MM-dd HH:mm:ss" value={mapping.customPattern} onChange={(e) => setMap({ customPattern: e.target.value })} error={err("customPattern")} />
                ) : (
                  <SelectField label={t("data.imports.tz")} value={mapping.tz} onChange={(e) => setMap({ tz: e.target.value })}>
                    {[...new Set([timezone, ...COMMON_TIMEZONES])].map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </SelectField>
                )}
                <SelectField label={t("data.imports.deviceColumn")} value={mapping.deviceColumn} onChange={(e) => setMap({ deviceColumn: e.target.value })} error={err("deviceColumn")}>
                  <option value="">{t("data.schedule.choose")}</option>
                  {header.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={t("data.imports.deviceKey")} value={mapping.deviceKey} onChange={(e) => setMap({ deviceKey: e.target.value as CsvMappingForm["deviceKey"] })}>
                  {DEVICE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {t(`data.imports.deviceKeys.${k}`)}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={t("data.imports.shape")} value={mapping.shape} onChange={(e) => setMap({ shape: e.target.value as CsvMappingForm["shape"] })}>
                  <option value="WIDE">{t("data.imports.shapes.WIDE")}</option>
                  <option value="LONG">{t("data.imports.shapes.LONG")}</option>
                </SelectField>
              </div>
              {mapping.shape === "LONG" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["metricColumn", "valueColumn"] as const).map((key) => (
                    <SelectField key={key} label={t(`data.imports.${key}`)} value={mapping[key]} onChange={(e) => setMap({ [key]: e.target.value })}>
                      <option value="">{t("data.schedule.choose")}</option>
                      {header.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </SelectField>
                  ))}
                </div>
              ) : (
                <fieldset className="flex flex-col gap-1">
                  <legend className="text-[12.5px] font-medium text-muted">{t("data.imports.metricColumns")}</legend>
                  {mapping.metricColumns.map((m, i) => (
                    <div key={m.column} className="flex items-center gap-2 text-[13px]">
                      <span className="w-40 truncate font-mono">{m.column}</span>
                      <span aria-hidden>→</span>
                      <input
                        aria-label={t("data.imports.metricKeyOf", { column: m.column })}
                        className="rounded border border-line bg-panel px-2 py-1 font-mono text-[12.5px]"
                        value={m.metricKey}
                        onChange={(e) => setMap({ metricColumns: mapping.metricColumns.map((x, j) => (j === i ? { ...x, metricKey: e.target.value } : x)) })}
                      />
                    </div>
                  ))}
                </fieldset>
              )}
              {errors.metricColumns && (
                <p role="alert" className="text-[12px] text-bad">
                  {err("metricColumns")}
                </p>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Card title={t("data.imports.step.mapping")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <TextField label={t("data.imports.influx.url")} placeholder="http://10.116.64.13:8086" value={influx.url} onChange={(e) => setFlux({ url: e.target.value })} error={err("url")} />
            <TextField label={t("data.imports.influx.org")} value={influx.org} onChange={(e) => setFlux({ org: e.target.value })} error={err("org")} />
            <TextField label={t("data.imports.influx.bucket")} value={influx.bucket} onChange={(e) => setFlux({ bucket: e.target.value })} error={err("bucket")} />
            <TextField label={t("data.imports.influx.token")} type="password" autoComplete="off" value={influx.token} onChange={(e) => setFlux({ token: e.target.value })} error={err("token")} />
            <TextField label={t("data.imports.influx.measurement")} value={influx.measurement} onChange={(e) => setFlux({ measurement: e.target.value })} />
            <TextField label={t("data.imports.influx.deviceTag")} hint={t("data.imports.influx.deviceTagHint")} value={influx.deviceTag} onChange={(e) => setFlux({ deviceTag: e.target.value })} />
            <TextField label={t("data.imports.influx.from")} type="datetime-local" value={influx.from} onChange={(e) => setFlux({ from: e.target.value })} />
            <TextField label={t("data.imports.influx.to")} type="datetime-local" value={influx.to} onChange={(e) => setFlux({ to: e.target.value })} error={err("range")} />
          </div>
          <fieldset className="mt-3 flex flex-col gap-1">
            <legend className="text-[12.5px] font-medium text-muted">{t("data.imports.influx.fields")}</legend>
            {influx.fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px]">
                <input aria-label={t("data.imports.influx.field", { n: i + 1 })} className="rounded border border-line bg-panel px-2 py-1 font-mono text-[12.5px]" value={f.field} onChange={(e) => setFlux({ fields: influx.fields.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })} />
                <span aria-hidden>→</span>
                <input aria-label={t("data.imports.influx.metricKey", { n: i + 1 })} className="rounded border border-line bg-panel px-2 py-1 font-mono text-[12.5px]" value={f.metricKey} onChange={(e) => setFlux({ fields: influx.fields.map((x, j) => (j === i ? { ...x, metricKey: e.target.value } : x)) })} />
              </div>
            ))}
            <div>
              <Button variant="ghost" onClick={() => setFlux({ fields: [...influx.fields, { field: "", metricKey: "" }] })}>
                {t("data.imports.influx.addField")}
              </Button>
            </div>
          </fieldset>
        </Card>
      )}

      {failure && (
        <Alert tone="danger">
          {errorText(t, failure)}
          {failure.errors?.length ? <span className="ml-1 font-mono text-[12px]">{failure.errors.map((e) => e.field).join(", ")}</span> : null}
        </Alert>
      )}
      <div className="flex justify-end">
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {t("data.imports.dryRun")}
        </Button>
      </div>
    </div>
  );
}
