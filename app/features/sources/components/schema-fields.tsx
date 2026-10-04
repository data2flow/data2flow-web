/**
 * 스키마 필드 그리기(UI-DSC-08, DSC-09.01): 커넥터 JSON Schema의 필드 하나를 형식에 맞는 입력으로 그린다.
 * string(enum은 선택, 비밀은 비밀번호 칸) · integer/number · boolean · array(문자열·객체 목록, 추가·삭제, 최소·최대 개수) · object(묶음).
 * 라벨은 `sources.schema.field.{이름}` 번역, 없으면 스키마 title 또는 이름. 설명은 도움말로.
 */
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, SelectField, TextArea, TextField } from "~/components/ui";
import { MULTILINE_SECRETS, getPath, isSecretField, newItem, parseNumberInput, typeOf, type JsonSchema, type SchemaErrors, type SchemaValue } from "../model/schema-form";

export interface SchemaFieldProps {
  name: string;
  path: string;
  schema: JsonSchema;
  required?: boolean;
  root: SchemaValue;
  errors: SchemaErrors;
  showErrors: boolean;
  readOnly?: boolean;
  onChange: (path: string, value: unknown) => void;
  /** 서버가 준 필드 오류 문구(`errors[{field, message}]`). 있으면 코드 번역보다 우선 */
  serverMessages?: Record<string, string>;
}

export function useFieldLabel() {
  const { t } = useTranslation();
  return (name: string, schema: JsonSchema) => t(`sources.schema.field.${name}`, { defaultValue: schema.title ?? humanize(name) });
}

export function humanize(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export function SchemaField({ name, path, schema, required, root, errors, showErrors, readOnly, onChange, serverMessages }: SchemaFieldProps) {
  const { t } = useTranslation();
  const labelOf = useFieldLabel();
  const value = getPath(root, path);
  const code = showErrors ? errors[path] : undefined;
  const error = code ? serverMessages?.[path] || t(`sources.schema.error.${code}`, { defaultValue: code, min: schema.minimum ?? schema.minLength ?? schema.minItems, max: schema.maximum ?? schema.maxLength ?? schema.maxItems }) : undefined;
  const label = `${labelOf(name, schema)}${required ? " *" : ""}`;
  const hint = schema.description;
  const type = typeOf(schema);

  if (schema.enum) {
    return (
      <SelectField
        label={label}
        value={value === undefined ? "" : String(value)}
        error={error}
        disabled={readOnly}
        onChange={(e) => {
          const raw = e.target.value;
          const match = schema.enum?.find((x) => String(x) === raw);
          onChange(path, raw === "" ? undefined : match);
        }}
      >
        {!required && <option value="">{t("sources.schema.unset")}</option>}
        {schema.enum.map((option) => (
          <option key={String(option)} value={String(option)}>
            {t(`sources.schema.option.${String(option)}`, { defaultValue: String(option) })}
          </option>
        ))}
      </SelectField>
    );
  }
  if (type === "boolean") {
    return <Checkbox label={label} checked={value === true} disabled={readOnly} error={error} onChange={(e) => onChange(path, e.target.checked)} />;
  }
  if (type === "integer" || type === "number") {
    return (
      <TextField
        label={label}
        inputMode="numeric"
        value={value === undefined || value === null ? "" : String(value)}
        min={schema.minimum}
        max={schema.maximum}
        hint={hint ?? rangeHint(t, schema)}
        error={error}
        readOnly={readOnly}
        onChange={(e) => onChange(path, parseNumberInput(e.target.value, type === "integer"))}
      />
    );
  }
  if (type === "array") return <ArrayField name={name} path={path} schema={schema} root={root} errors={errors} showErrors={showErrors} readOnly={readOnly} onChange={onChange} label={label} error={error} serverMessages={serverMessages} />;
  if (type === "object") {
    const props = schema.properties ?? {};
    return (
      <fieldset className="col-span-full rounded-md border border-line p-3">
        <legend className="px-1 text-[12.5px] font-semibold">{label}</legend>
        {hint && <p className="mb-2 text-[12px] text-muted">{hint}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(props).map(([key, sub]) => (
            <SchemaField key={key} name={key} path={`${path}.${key}`} schema={sub} required={(schema.required ?? []).includes(key)} root={root} errors={errors} showErrors={showErrors} readOnly={readOnly} onChange={onChange} serverMessages={serverMessages} />
          ))}
        </div>
      </fieldset>
    );
  }
  if (isSecretField(schema)) {
    return <TextField label={label} type="password" autoComplete="new-password" value={typeof value === "string" ? value : ""} hint={t("sources.form.secretWriteOnly")} error={error} readOnly={readOnly} onChange={(e) => onChange(path, e.target.value)} />;
  }
  if ((schema.maxLength ?? 0) > 512) {
    return <TextArea label={label} value={typeof value === "string" ? value : ""} error={error} readOnly={readOnly} onChange={(e) => onChange(path, e.target.value)} />;
  }
  return <TextField label={label} value={typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)} hint={hint} error={error} readOnly={readOnly} onChange={(e) => onChange(path, e.target.value)} />;
}

function rangeHint(t: (key: string, options?: Record<string, unknown>) => string, schema: JsonSchema): string | undefined {
  if (schema.minimum !== undefined && schema.maximum !== undefined) return t("sources.schema.range", { min: schema.minimum, max: schema.maximum });
  return undefined;
}

function ArrayField({ name, path, schema, root, errors, showErrors, readOnly, onChange, label, error, serverMessages }: Omit<SchemaFieldProps, "required"> & { label: string; error?: string }) {
  const { t } = useTranslation();
  const items = (getPath(root, path) as unknown[] | undefined) ?? [];
  const itemSchema = schema.items ?? { type: "string" };
  const objectItems = typeOf(itemSchema) === "object";
  const max = schema.maxItems ?? Infinity;
  return (
    <fieldset className="col-span-full flex flex-col gap-2 rounded-md border border-line p-3">
      <legend className="px-1 text-[12.5px] font-semibold">{label}</legend>
      {schema.description && <p className="text-[12px] text-muted">{schema.description}</p>}
      {items.map((_, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className={objectItems ? "grid flex-1 gap-2 md:grid-cols-2" : "flex-1"}>
            {objectItems ? (
              Object.entries(itemSchema.properties ?? {}).map(([key, sub]) => (
                <SchemaField key={key} name={key} path={`${path}[${i}].${key}`} schema={sub} required={(itemSchema.required ?? []).includes(key)} root={root} errors={errors} showErrors={showErrors} readOnly={readOnly} onChange={onChange} serverMessages={serverMessages} />
              ))
            ) : (
              <SchemaField name={`${name}Item`} path={`${path}[${i}]`} schema={{ ...itemSchema, title: t("sources.schema.itemN", { name: label.replace(/ \*$/, ""), n: i + 1 }) }} root={root} errors={errors} showErrors={showErrors} readOnly={readOnly} onChange={onChange} serverMessages={serverMessages} />
            )}
          </div>
          {!readOnly && (
            <Button variant="ghost" aria-label={t("sources.schema.removeItem", { n: i + 1 })} onClick={() => onChange(path, items.filter((__, j) => j !== i))}>
              {t("common.remove")}
            </Button>
          )}
        </div>
      ))}
      {error && <p className="text-[12px] text-bad">{error}</p>}
      {!readOnly && (
        <div>
          <Button onClick={() => onChange(path, [...items, newItem(itemSchema)])} disabled={items.length >= max}>
            {t("sources.schema.addItem", { name: label.replace(/ \*$/, "") })}
          </Button>
          {Number.isFinite(max) && <span className="ml-2 text-[12px] text-muted">{t("sources.schema.count", { n: items.length, max })}</span>}
        </div>
      )}
    </fieldset>
  );
}

/** 쓰기 전용 비밀값 입력(인증 방식 매트릭스·TLS). PEM·JSON은 여러 줄 + 파일 올리기, 저장된 값은 지문만 */
export function SecretInput({ kind, value, required, configured, fingerprint, expiresAt, error, readOnly, onChange }: { kind: string; value: string; required?: boolean; configured?: boolean; fingerprint?: string | null; expiresAt?: string | null; error?: string; readOnly?: boolean; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const label = `${t(`sources.secretKind.${kind}`, { defaultValue: kind })}${required ? " *" : ""}`;
  const hint = configured ? t("sources.schema.secretConfigured", { fingerprint: fingerprint ?? "••••" }) : t("sources.form.secretWriteOnly");
  async function readFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onChange(await file.text());
  }
  if (MULTILINE_SECRETS.has(kind)) {
    return (
      <div className="col-span-full flex flex-col gap-1">
        <TextArea label={label} value={value} placeholder={configured ? (fingerprint ?? "••••") : "-----BEGIN …"} error={error} readOnly={readOnly} spellCheck={false} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          {!readOnly && (
            <label className="cursor-pointer rounded border border-line px-2 py-0.5 hover:border-accent">
              {t("sources.schema.uploadFile")}
              <input type="file" className="sr-only" accept=".pem,.crt,.key,.json,.txt" aria-label={t("sources.schema.uploadFor", { kind: label })} onChange={readFile} />
            </label>
          )}
          <span>{hint}</span>
          {expiresAt && <span>{t("sources.tls.expires", { at: expiresAt.slice(0, 10) })}</span>}
        </div>
      </div>
    );
  }
  return <TextField label={label} type="password" autoComplete="new-password" value={value} placeholder={configured ? (fingerprint ?? "••••") : ""} hint={hint} error={error} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} />;
}
