/**
 * 새 스크립트 대화상자(UI-SCR-01): 이름(2~80), 종류, 설명, 템플릿(API-SCR-15), 연결 대상(DECODE → 소스 하나, TRANSFORM → 모델 여러 개).
 * 제출은 목록 라우트의 action(API-SCR-02)이 받는다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Alert, Button, CsrfField, Dialog, SelectField, TextField } from "~/components/ui";
import type { ScriptKind } from "./model/script-model";

export interface ScriptTemplate {
  key: string;
  kind: ScriptKind;
  name: string;
  description?: string;
}

export function CreateScriptDialog({
  open,
  onClose,
  templates,
  sources,
  models,
  idempotencyKey,
  fieldErrors,
  error,
  initialTemplate,
}: {
  open: boolean;
  onClose: () => void;
  templates: ScriptTemplate[];
  sources: { id: string; name: string }[];
  models: { id: string; code: string; name: string }[];
  idempotencyKey: string;
  fieldErrors?: Record<string, string>;
  error?: string;
  initialTemplate?: string;
}) {
  const { t } = useTranslation();
  const initial = templates.find((tpl) => tpl.key === initialTemplate);
  const [kind, setKind] = useState<ScriptKind>(initial?.kind ?? "TRANSFORM");
  const usable = templates.filter((tpl) => tpl.kind === kind);
  return (
    <Dialog title={t("scripts.create.title")} open={open} onClose={onClose}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField label={t("scripts.create.name")} name="name" required minLength={2} maxLength={80} error={fieldErrors?.name ? t("scripts.validation.name") : undefined} />
        <SelectField label={t("scripts.kind.label")} name="kind" value={kind} onChange={(e) => setKind(e.target.value as ScriptKind)} error={fieldErrors?.kind ? t("scripts.validation.kind") : undefined}>
          <option value="TRANSFORM">TRANSFORM</option>
          <option value="DECODE">DECODE</option>
        </SelectField>
        <TextField label={t("scripts.create.description")} name="description" maxLength={500} />
        <SelectField label={t("scripts.create.template")} name="templateKey" defaultValue={initial?.key ?? ""}>
          <option value="">{t("scripts.create.noTemplate")}</option>
          {usable.map((tpl) => (
            <option key={tpl.key} value={tpl.key}>
              {tpl.description ? `${tpl.name} — ${tpl.description}` : tpl.name}
            </option>
          ))}
        </SelectField>
        {kind === "DECODE" ? (
          <SelectField label={t("scripts.create.source")} name="sourceId" defaultValue="" error={fieldErrors?.bindings ? t(`scripts.validation.${fieldErrors.bindings}`) : undefined}>
            <option value="">{t("scripts.targets.none")}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[12.5px] font-medium text-muted">{t("scripts.create.models")}</legend>
            {models.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="modelId" value={m.id} />
                {m.code}
              </label>
            ))}
            {fieldErrors?.bindings && (
              <p role="alert" className="text-[12px] text-bad">
                {t(`scripts.validation.${fieldErrors.bindings}`)}
              </p>
            )}
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary">
            {t("scripts.create.submit")}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
