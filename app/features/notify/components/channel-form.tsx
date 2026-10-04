/**
 * UI-OPS-06 알림 채널 부품(OPS-06.01·06.06): 채널 추가 유형 목록(등록된 SPI만 활성, 나머지 "준비 중"), 설정 스키마로 만든 편집 필드.
 * 비밀값(봇 토큰·웹훅 시크릿)은 저장되어 있으면 `●●●●`만 보이고 바꿀 때만 입력한다(AT-OPS-11.3).
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Checkbox, SelectField, TextArea, TextField } from "~/components/ui";
import { fieldDefault, schemaFields, type FieldProblem, type SchemaField } from "../model/channel-schema";
import type { ChannelType, NotificationChannel } from "../model/types";

export function ChannelTypeList({ types }: { types: ChannelType[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("ops.channels.types")}>
      {types.map((type) =>
        type.available ? (
          <li key={type.key}>
            <Link to={`/admin/channels?new=${encodeURIComponent(type.key)}`} className="inline-flex items-center rounded-md border border-accent px-3 py-1.5 text-[13px] font-medium text-accent">
              {type.displayName}
            </Link>
          </li>
        ) : (
          <li key={type.key} aria-disabled="true" className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] text-muted">
            {type.displayName}
            <span className="text-[11.5px]">{t("ops.channels.comingSoon")}</span>
          </li>
        ),
      )}
    </ul>
  );
}

export function SchemaFieldInput({ field, config, hasSecret, problem }: { field: SchemaField; config?: Record<string, unknown>; hasSecret: boolean; problem?: FieldProblem }) {
  const { t } = useTranslation();
  const label = field.title || t(`ops.channels.fields.${field.name}`, { defaultValue: field.name });
  const error = problem ? t(`ops.channels.problems.${problem}`) : undefined;
  const value = fieldDefault(field, config);
  switch (field.kind) {
    case "secret":
      return <TextField label={label} name={`secret.${field.name}`} type="password" autoComplete="off" placeholder={hasSecret ? t("ops.channels.secretSet") : t("ops.channels.secretNew")} error={error} hint={field.description} />;
    case "boolean":
      return <Checkbox label={label} name={`cfg.${field.name}`} defaultChecked={value === "true"} error={error} />;
    case "enum":
      return (
        <SelectField label={label} name={`cfg.${field.name}`} defaultValue={value} error={error}>
          {!field.required && <option value="" />}
          {field.enumValues?.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </SelectField>
      );
    case "stringList":
    case "integerList":
      return <TextArea label={`${label} — ${t("ops.channels.listHint")}`} name={`cfg.${field.name}`} defaultValue={value} rows={3} error={error} />;
    default:
      return <TextField label={label} name={`cfg.${field.name}`} defaultValue={value} type={field.kind === "string" ? "text" : "number"} required={field.required} error={error} hint={field.description} />;
  }
}

export interface ChannelFieldsProps {
  type: ChannelType;
  channel?: NotificationChannel | null;
  problems?: Record<string, string>;
}

/** 공통 필드(이름·분당 한도·묶음 창·켜기) + 설정 스키마 필드 */
export function ChannelFields({ type, channel, problems = {} }: ChannelFieldsProps) {
  const { t } = useTranslation();
  const fields = schemaFields(type.key, type.configSchema);
  const hasSecret = Boolean(channel?.secretConfigured);
  const problem = (name: string) => (problems[name] ? t(`ops.channels.problems.${problems[name]}`) : undefined);
  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="type" value={type.key} />
      <section className="grid gap-3 md:grid-cols-3">
        <TextField label={t("ops.channels.name")} name="name" defaultValue={channel?.name ?? ""} maxLength={50} required error={problem("name")} />
        <TextField label={t("ops.channels.rateLimit")} name="rateLimitPerMin" type="number" min={1} max={600} defaultValue={String(channel?.rateLimitPerMin ?? type.capabilities?.defaultRatePerMin ?? 20)} error={problem("rateLimitPerMin")} />
        <TextField label={t("ops.channels.digest")} name="digestWindowSec" type="number" min={0} max={900} defaultValue={String(channel?.digestWindowSec ?? 60)} error={problem("digestWindowSec")} />
      </section>
      <Checkbox label={t("ops.channels.enabled")} name="enabled" defaultChecked={channel?.enabled ?? true} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[12.5px] font-semibold text-muted">{t("ops.channels.settings")}</legend>
        {fields.map((field) => (
          <SchemaFieldInput key={field.name} field={field} config={channel?.config} hasSecret={hasSecret} problem={problems[field.name] as FieldProblem | undefined} />
        ))}
      </fieldset>
    </div>
  );
}
