/**
 * 주석(TSD-01.04, UI-TSD-01): 종류별 표시 토글, 목록(본인 주석 삭제), [주석 추가](DEV_PLACE). 서버에 시각은 UTC로 보낸다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Badge, Button, CsrfField, SelectField, TextField } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import type { ApiAnnotation } from "../model/query";
import { ANNOTATION_TYPES, type ExploreState } from "../model/state";

export function AnnotationToggles({ state, onChange }: { state: ExploreState; onChange: (next: ExploreState) => void }) {
  const { t } = useTranslation();
  const toggle = (type: string) => onChange({ ...state, annotations: state.annotations.includes(type) ? state.annotations.filter((x) => x !== type) : [...state.annotations, type] });
  return (
    <fieldset className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <legend className="sr-only">{t("explore.annotations.toggles")}</legend>
      <span className="text-muted">{t("explore.annotations.title")}</span>
      {ANNOTATION_TYPES.map((type) => (
        <label key={type} className="flex items-center gap-1">
          <input type="checkbox" checked={state.annotations.includes(type)} onChange={() => toggle(type)} />
          {t(`explore.annotationType.${type}`)}
        </label>
      ))}
    </fieldset>
  );
}

export function AnnotationList({ items, timezone, meId, canEdit }: { items: ApiAnnotation[]; timezone: string; meId?: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-[12.5px]">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{t(`explore.annotationType.${a.type}`, { defaultValue: a.type })}</Badge>
          <span className="font-medium">{a.title}</span>
          <span className="font-mono text-muted">
            {formatDateTime(a.timeFrom, timezone, i18n.language)}
            {a.timeTo ? ` ~ ${formatDateTime(a.timeTo, timezone, i18n.language)}` : ""}
          </span>
          {a.spaceId && !a.deviceId && <span className="text-muted">{t("explore.annotations.spaceScope")}</span>}
          {canEdit && a.type === "USER" && a.createdBy != null && String(a.createdBy) === meId && (
            <Form method="post">
              <CsrfField />
              <input type="hidden" name="intent" value="delete-annotation" />
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" className="text-bad hover:underline" aria-label={t("explore.annotations.deleteOf", { title: a.title })}>
                {t("common.delete")}
              </button>
            </Form>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AnnotationForm({ state, timezone, defaultFrom, defaultTo, error }: { state: ExploreState; timezone: string; defaultFrom: string; defaultTo: string; error?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(Boolean(error));
  const targets = [...new Map(state.series.map((s) => [`${s.kind}:${s.id}`, s])).values()];
  if (!open) return <Button onClick={() => setOpen(true)}>{t("explore.annotations.add")}</Button>;
  return (
    <Form method="post" className="flex flex-wrap items-end gap-2 rounded-md border border-line p-3">
      <CsrfField />
      <input type="hidden" name="intent" value="annotate" />
      <input type="hidden" name="timezone" value={timezone} />
      <TextField label={t("explore.annotations.titleLabel")} name="title" required maxLength={200} error={error} />
      <TextField label={t("explore.tool.from")} name="timeFrom" type="datetime-local" defaultValue={defaultFrom} required />
      <TextField label={t("explore.tool.to")} name="timeTo" type="datetime-local" defaultValue={defaultTo} />
      <SelectField label={t("explore.annotations.target")} name="target">
        {targets.map((s) => (
          <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
            {s.label}
          </option>
        ))}
      </SelectField>
      <Button type="submit" variant="primary">
        {t("common.save")}
      </Button>
      <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
    </Form>
  );
}
