/**
 * 모델 속성 스키마 편집(DEV-07.05, UI-DEV-08 패키지 탭): JSON 편집 + 문법·형식 검사, 폼 미리 보기,
 * "기기 입력값 검증"(필수·타입) 도우미. 저장은 숨은 필드 `attributeSchema`로 보낸다.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, TextArea, TextField } from "~/components/ui";
import { coerceAttribute, parseAttributeSchema, validateAttributes } from "../model/catalog";

export function AttributeSchemaEditor({ initial, readOnly }: { initial: string; readOnly?: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  const [sample, setSample] = useState<Record<string, string>>({});
  const parsed = useMemo(() => parseAttributeSchema(text), [text]);
  const fields = parsed.ok ? parsed.fields : [];
  const values = Object.fromEntries(fields.map((f) => [f.key, coerceAttribute(f, sample[f.key] ?? "")]).filter(([, v]) => v !== undefined));
  const problems = parsed.ok ? validateAttributes(fields, values) : {};
  const checked = Object.keys(sample).length > 0;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <input type="hidden" name="attributeSchema" value={text} />
        <TextArea label={t("catalog.package.schema")} rows={12} value={text} readOnly={readOnly} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {parsed.ok ? (
          <p role="status" className="text-[12px] text-good">
            {t("catalog.package.schemaOk", { n: fields.length })}
          </p>
        ) : (
          <Alert tone="danger">{t(`catalog.package.schemaError.${parsed.error}`, { detail: parsed.detail ?? "" })}</Alert>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">{t("catalog.package.preview")}</h3>
        {fields.length === 0 && <p className="text-[12.5px] text-muted">{t("catalog.package.noFields")}</p>}
        {fields.map((f) => (
          <TextField
            key={f.key}
            label={
              <>
                {f.title ?? f.key} <span className="font-mono text-[11px]">({f.type}{f.unit ? `, ${f.unit}` : ""})</span> {f.required && <Badge tone="warning">{t("catalog.required")}</Badge>}
              </>
            }
            placeholder={f.default !== undefined ? String(f.default) : ""}
            value={sample[f.key] ?? ""}
            onChange={(e) => setSample((s) => ({ ...s, [f.key]: e.target.value }))}
            error={problems[f.key] ? t(`catalog.package.attrError.${problems[f.key]}`, { type: f.type }) : undefined}
          />
        ))}
        {fields.length > 0 && (
          <p role="status" className="text-[12px] text-muted">
            {!checked ? t("catalog.package.validateHint") : Object.keys(problems).length === 0 ? t("catalog.package.valid") : t("catalog.package.invalid", { n: Object.keys(problems).length })}
          </p>
        )}
      </div>
    </div>
  );
}
