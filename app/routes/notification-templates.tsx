/**
 * UI-RUL-07 알림 템플릿(RUL-05.01, RUL-03.04). 채널 탭·언어, 편집기(변수 넣기·알 수 없는 변수 경고·길이), 미리 보기, 기본값 되돌리기.
 * API-RUL-22: 목록 `GET /notification-templates?channel=&locale=`, 변수 `GET …/variables`, 수정 `PUT …/{id}`(baseVersion, 응답 warnings
 * TEMPLATE_VARIABLE_UNKNOWN), 미리 보기 `POST …/{id}/preview {alarmId}`(브라우저), 되돌리기 `POST …/{id}/reset`.
 * 목록·변수는 `{header, responses, totalCount}`(페이징 없음), 템플릿 키는 `key`. 저장 응답은 `{template, warnings}`.
 * 미리 볼 알람은 API-RUL-10 최근 10건, 메신저 길이 한도는 채널 유형 API-OPS-34 capabilities.maxBodyLength(기본 4,000자, core 검증과 같다)
 */
import { useTranslation } from "react-i18next";
import { Form, Link, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, PageHeader, SelectField, cx } from "~/components/ui";
import { notifyApi } from "~/features/notify/api";
import { NotifyTabs, ResultAlert } from "~/features/notify/components/common";
import { TemplateEditor } from "~/features/notify/components/template-editor";
import { DEFAULT_MAX_LENGTH, checkTemplate, normalizeTemplate, normalizeVariables, warningNames } from "~/features/notify/model/template";
import { done, failed, invalid, loadChannelTypes, loadRows, type NotifyActionResult } from "~/features/notify/server";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/notification-templates";

const LOCALES = ["ko", "en", "ja", "zh"];

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const channelTypes = await loadChannelTypes(ctx, request);
  const channels = ["TELEGRAM", "WEB", ...channelTypes.filter((c) => c.available && c.key !== "TELEGRAM").map((c) => c.key)];
  const channel = channels.includes(url.searchParams.get("channel") ?? "") ? (url.searchParams.get("channel") as string) : channels[0];
  const locale = LOCALES.includes(url.searchParams.get("locale") ?? "") ? (url.searchParams.get("locale") as string) : "ko";
  const [templates, variables, alarms] = await Promise.all([
    loadRows<Record<string, unknown>>(ctx, request, `/api/v1/core/notification-templates?channel=${encodeURIComponent(channel)}&locale=${locale}`),
    loadRows<unknown>(ctx, request, "/api/v1/core/notification-templates/variables"),
    loadRows<{ id: string | number; title: string }>(ctx, request, "/api/v1/core/alarms?size=10"),
  ]);
  const rows = templates.rows.map(normalizeTemplate);
  // 기본 템플릿을 고치면 core가 조직 행(새 ID)을 만들고, 되돌리면 그 행을 지운다. ID로 못 찾으면 같은 키로 고른다
  const selectedId = url.searchParams.get("id") ?? rows[0]?.notificationTemplateId ?? "";
  const selectedKey = url.searchParams.get("key");
  return {
    channels,
    channel,
    locale,
    templates: rows,
    selected: rows.find((r) => r.notificationTemplateId === selectedId) ?? (selectedKey ? rows.find((r) => r.templateKey === selectedKey) : undefined) ?? null,
    variables: normalizeVariables(variables.rows),
    maxLength: channelTypes.find((c) => c.key === channel)?.capabilities?.maxBodyLength ?? DEFAULT_MAX_LENGTH[channel] ?? 4000,
    alarms: alarms.rows.map((a) => ({ id: String(a.id), title: a.title })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const id = field(form, "id");
  const intent = field(form, "intent");
  const path = `/api/v1/core/notification-templates/${encodeURIComponent(id)}`;
  if (intent === "reset") {
    const result = await callApi(ctx, request, `${path}/reset`, { method: "POST" });
    return result.ok ? done("reset", "notify.template.resetDone") : failed("reset", result);
  }
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel") ?? "TELEGRAM";
  const maxLength = Number(field(form, "maxLength")) || DEFAULT_MAX_LENGTH[channel] || 4000;
  const input = { subject: field(form, "subject"), body: field(form, "body") };
  const problem = checkTemplate(input, maxLength);
  if (problem) return invalid("save", { body: problem }, { max: maxLength });
  const result = await callApi<unknown>(ctx, request, path, { method: "PUT", body: { subject: input.subject.trim() || null, body: input.body, baseVersion: Number(field(form, "baseVersion") || 0) } });
  if (!result.ok) return failed("save", result);
  const names = warningNames(result.data);
  return done("save", names.length ? "notify.template.savedWithWarnings" : "notify.template.saved", { names: names.join(", ") });
}

export default function NotificationTemplates({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const canWrite = hasAny(root?.me?.permissions, ["NOTIFY_POLICY_WRITE"]);
  const { channels, channel, locale, templates, selected, variables, maxLength, alarms } = loaderData;
  const result = actionData as NotifyActionResult | undefined;
  const query = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    if (!("id" in patch)) {
      next.delete("id");
      next.delete("key");
    }
    return `?${next.toString()}`;
  };
  const doneText = result?.done ? t(result.done, { names: String(result.payload?.names ?? "") }) : undefined;
  const fieldError = result?.fieldErrors?.body ? t(`notify.template.errors.${result.fieldErrors.body}`, { max: result.payload?.max ?? maxLength }) : undefined;
  return (
    <>
      <PageHeader crumb={t("notify.crumb")} title={t("notify.template.title")} />
      <NotifyTabs current="templates" />
      <ResultAlert result={result?.error ? result : undefined} />
      {doneText && (
        <div className="mb-3">
          <Alert tone="success">{doneText}</Alert>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <nav aria-label={t("notify.template.channelTabs")} className="flex gap-1">
          {channels.map((c) => (
            <Link key={c} to={query({ channel: c })} aria-current={c === channel ? "page" : undefined} className={cx("rounded-md border px-3 py-1.5 text-[13px]", c === channel ? "border-accent font-semibold text-accent" : "border-line text-muted")}>
              {t(`notify.channel.${c}`, { defaultValue: c })}
            </Link>
          ))}
        </nav>
        <Form method="get" className="flex items-end gap-2">
          <input type="hidden" name="channel" value={channel} />
          <SelectField label={t("notify.template.locale")} name="locale" defaultValue={locale} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </SelectField>
        </Form>
      </div>
      {templates.length === 0 ? (
        <EmptyState title={t("notify.template.empty")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <Card title={t("notify.template.key")}>
            <ul className="flex flex-col gap-1">
              {templates.map((tpl) => (
                <li key={tpl.notificationTemplateId}>
                  <Link to={query({ id: tpl.notificationTemplateId, key: tpl.templateKey })} aria-current={selected?.notificationTemplateId === tpl.notificationTemplateId ? "true" : undefined} className={cx("flex items-center justify-between rounded px-2 py-1 text-[13px]", selected?.notificationTemplateId === tpl.notificationTemplateId ? "bg-accent-soft text-accent" : "hover:bg-bg")}>
                    <span className="font-mono">{tpl.templateKey}</span>
                    <Badge tone={tpl.customized || !tpl.builtin ? "info" : "neutral"}>{t(tpl.customized || !tpl.builtin ? "notify.template.customized" : "notify.template.builtin")}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {selected ? (
            <Card title={`${selected.templateKey} · ${t(`notify.channel.${selected.channel}`, { defaultValue: selected.channel })} · ${selected.locale}`}>
              <Form method="post" key={`${selected.notificationTemplateId}:${selected.version}`} className="flex flex-col gap-3">
                <CsrfField />
                <input type="hidden" name="maxLength" value={maxLength} />
                <TemplateEditor template={selected} variables={variables} maxLength={maxLength} alarms={alarms} api={notifyApi} readOnly={!canWrite} error={fieldError} />
                {canWrite && (
                  <div className="flex justify-between">
                    <Button type="submit" name="intent" value="reset" variant="ghost" formNoValidate onClick={(e) => (window.confirm(t("notify.template.resetConfirm")) ? undefined : e.preventDefault())}>
                      {t("notify.template.reset")}
                    </Button>
                    <Button type="submit" name="intent" value="save" variant="primary">
                      {t("common.save")}
                    </Button>
                  </div>
                )}
              </Form>
            </Card>
          ) : (
            <EmptyState title={t("notify.template.select")} />
          )}
        </div>
      )}
    </>
  );
}
