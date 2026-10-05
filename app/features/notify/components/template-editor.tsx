/**
 * UI-RUL-07 템플릿 편집기(RUL-05.01, RUL-03.04): 변수 넣기(커서 위치), 알 수 없는 변수 경고(AT-RUL-08.3), 길이(텔레그램 4,096자),
 * 최근 알람으로 미리 보기(API-RUL-22 preview). 저장·되돌리기는 감싸는 폼이 서버 action으로 보낸다.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, SelectField, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { NotifyApi } from "../api";
import { insertVariable, unknownVariables } from "../model/template";
import type { NotificationTemplate, TemplateVariable } from "../model/types";

export interface TemplateEditorProps {
  template: NotificationTemplate;
  variables: TemplateVariable[];
  maxLength: number;
  alarms: { id: string; title: string }[];
  api: Pick<NotifyApi, "previewTemplate">;
  readOnly?: boolean;
  error?: string;
}

export function TemplateEditor({ template, variables, maxLength, alarms, api, readOnly, error }: TemplateEditorProps) {
  const { t } = useTranslation();
  const [body, setBody] = useState(template.body);
  const [alarmId, setAlarmId] = useState(alarms[0]?.id ?? "");
  const [preview, setPreview] = useState<{ subject?: string | null; body: string } | null>(null);
  const [previewError, setPreviewError] = useState<{ code: string; message?: string } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const unknown = unknownVariables(body, variables.map((v) => v.name));

  const insert = (name: string) => {
    const el = area.current;
    const next = insertVariable(body, el?.selectionStart ?? body.length, el?.selectionEnd ?? body.length, name);
    setBody(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const runPreview = async () => {
    setPreviewError(null);
    const result = await api.previewTemplate(template.notificationTemplateId, alarmId);
    if (result.ok) setPreview(result.data);
    else setPreviewError({ code: result.code, message: result.message });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-3">
        <input type="hidden" name="id" value={template.notificationTemplateId} />
        <input type="hidden" name="baseVersion" value={template.version} />
        <TextField label={t("notify.template.subject")} name="subject" defaultValue={template.subject ?? ""} maxLength={200} disabled={readOnly} />
        <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
          {t("notify.template.body")}
          <textarea
            ref={area}
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            disabled={readOnly}
            aria-invalid={Boolean(error) || body.length > maxLength}
            className="rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[13px] text-text aria-[invalid=true]:border-bad"
          />
        </label>
        <div className="flex justify-between text-[12px] text-muted">
          <span>{unknown.length > 0 && <span className="text-fair-ink">{t("notify.template.unknown", { names: unknown.join(", ") })}</span>}</span>
          <span className={body.length > maxLength ? "text-bad-ink" : undefined}>{t("notify.template.length", { count: body.length, max: maxLength })}</span>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
      <aside className="flex flex-col gap-3">
        <div>
          <h3 className="mb-1.5 text-[12.5px] font-semibold text-muted">{t("notify.template.variables")}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {variables.map((v) => (
              <li key={v.name}>
                <button type="button" disabled={readOnly} title={v.description} aria-label={t("notify.template.insert", { name: v.name })} onClick={() => insert(v.name)} className="rounded border border-line px-1.5 py-0.5 font-mono text-[11.5px] hover:border-accent">
                  {`{{${v.name}}}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-[12.5px] font-semibold text-muted">{t("notify.template.preview")}</h3>
          {alarms.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("notify.template.previewNoAlarm")}</p>
          ) : (
            <>
              <SelectField label={t("notify.template.previewAlarm")} value={alarmId} onChange={(e) => setAlarmId(e.target.value)}>
                {alarms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </SelectField>
              <Button onClick={() => void runPreview()}>{t("notify.template.previewAction")}</Button>
            </>
          )}
          {previewError && <Alert tone="danger">{errorText(t, previewError)}</Alert>}
          {preview && (
            <div className="rounded-md border border-line bg-bg p-2 text-[12.5px]" data-testid="template-preview">
              {preview.subject && <p className="font-semibold">{preview.subject}</p>}
              <pre className="whitespace-pre-wrap font-sans">{preview.body}</pre>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
