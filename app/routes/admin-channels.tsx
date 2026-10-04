/**
 * UI-OPS-06 알림 채널(OPS-06.01·06.03·06.04·06.06, ADR-033). ADMIN(NOTIFY_CHANNEL_MANAGE).
 * - 유형 API-OPS-34 `GET /notification-channel-types` — 지금은 TELEGRAM만 available, 나머지는 "준비 중". 편집 폼은 유형의 configSchema로 만든다
 * - 채널 API-OPS-30 `GET|POST /notification-channels`, `GET|PUT|DELETE …/{id}` `{name, type, config, secret?, rateLimitPerMin, digestWindowSec, enabled, baseVersion}`
 *   (비밀값은 쓰기 전용 `secret{이름: 값}`, 조회는 `secretConfigured`. 사용 중 삭제는 409 CHANNEL_IN_USE)
 * - 테스트 발송 API-OPS-31 `POST …/{id}/test`, 저장 전 `POST …/test-draft` → `{ok, latencyMs, providerResponse}`, 실패 502 CHANNEL_TEST_FAILED
 * - 발송 이력 API-OPS-32(=API-RUL-27 커서 목록 `channelId`), 다시 보내기 API-OPS-33
 * 경로: 목록 `/admin/channels`, 추가 `?new={type}`, 편집 `?edit={id}`(&tab=deliveries)
 */
import { useTranslation } from "react-i18next";
import { Form, Link, redirect, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, field, newIdempotencyKey, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, SelectField, StatusDot, Table, Tabs } from "~/components/ui";
import { ChannelFields, ChannelTypeList } from "~/features/notify/components/channel-form";
import { ResultAlert } from "~/features/notify/components/common";
import { checkCommon, parseChannelForm, schemaFields, targetCount } from "~/features/notify/model/channel-schema";
import { idOf, type Delivery, type NotificationChannel } from "~/features/notify/model/types";
import { done, failed, invalid, loadChannelTypes, loadRows, type NotifyActionResult } from "~/features/notify/server";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/admin-channels";

export function meta() {
  return [{ title: "data2flow" }];
}

function normalizeChannel(raw: Record<string, unknown>): NotificationChannel {
  return {
    id: idOf(raw, "notificationChannelId"),
    name: String(raw.name ?? ""),
    type: String(raw.type ?? ""),
    config: (raw.config as Record<string, unknown>) ?? {},
    secretConfigured: raw.secretConfigured === true || raw.secretConfigured === "***",
    rateLimitPerMin: Number(raw.rateLimitPerMin ?? 20),
    digestWindowSec: Number(raw.digestWindowSec ?? 60),
    enabled: raw.enabled !== false,
    status: (raw.status as NotificationChannel["status"]) ?? "OK",
    version: Number(raw.version ?? 0),
    updatedAt: raw.updatedAt as string | undefined,
  };
}

const STATUS_TONE = { OK: "good", DEGRADED: "warn", FAILING: "bad" } as const;
const DELIVERY_STATUSES = ["PENDING", "RETRYING", "SENT", "FAILED", "SKIPPED", "DIGESTED"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const editId = url.searchParams.get("edit");
  const tab = url.searchParams.get("tab") === "deliveries" ? "deliveries" : "settings";
  const [types, channels, editing] = await Promise.all([
    loadChannelTypes(ctx, request),
    loadRows<Record<string, unknown>>(ctx, request, "/api/v1/core/notification-channels?size=100"),
    editId ? callApi<Record<string, unknown>>(ctx, request, `/api/v1/core/notification-channels/${encodeURIComponent(editId)}`) : null,
  ]);
  if (!channels.ok) orThrow({ ok: false, status: channels.status, code: channels.code ?? "UNKNOWN", message: "" });
  let deliveries: { rows: Delivery[]; nextCursor: string | null } | null = null;
  if (editId && tab === "deliveries") {
    const query = new URLSearchParams({ channelId: editId, size: "50" });
    for (const key of ["status", "cursor"]) {
      const value = url.searchParams.get(key);
      if (value) query.set(key, value);
    }
    const result = await loadRows<Delivery>(ctx, request, `/api/v1/core/notification-deliveries?${query}`);
    deliveries = { rows: result.rows, nextCursor: result.nextCursor ?? null };
  }
  const newType = url.searchParams.get("new");
  return {
    types,
    channels: channels.rows.map(normalizeChannel),
    editing: editing ? normalizeChannel(orThrow(editing)) : null,
    creatingType: newType ? (types.find((t) => t.key === newType && t.available) ?? null) : null,
    tab,
    deliveries,
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = field(form, "id");
  const base = "/api/v1/core/notification-channels";
  if (intent === "resend") {
    const result = await callApi<{ newDeliveryId: string }>(ctx, request, `/api/v1/core/notification-deliveries/${encodeURIComponent(field(form, "deliveryId"))}/resend`, { method: "POST" });
    return result.ok ? done(intent, "ops.channels.resent") : failed(intent, result);
  }
  if (intent === "delete") {
    const result = await callApi(ctx, request, `${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!result.ok) return failed(intent, result);
    throw redirect("/admin/channels?deleted=1");
  }
  if (intent === "test") {
    const result = await callApi<{ ok: boolean; latencyMs: number; providerResponse?: string }>(ctx, request, `${base}/${encodeURIComponent(id)}/test`, { method: "POST" });
    return result.ok ? done(intent, "ops.channels.testOk", { ...result.data }) : failed(intent, result, undefined, { reason: result.message });
  }
  const types = await loadChannelTypes(ctx, request);
  const type = types.find((t) => t.key === field(form, "type") && t.available);
  if (!type) return invalid(intent, { type: "required" });
  const editing = Boolean(id);
  const parsed = parseChannelForm(schemaFields(type.key, type.configSchema, type.secretSchema), (name) => field(form, name), { editing, hasSecret: field(form, "hasSecret") === "true" });
  const common = { name: field(form, "name").trim(), rateLimitPerMin: Number(field(form, "rateLimitPerMin")), digestWindowSec: Number(field(form, "digestWindowSec")) };
  const problems = { ...checkCommon(common), ...parsed.errors };
  if (Object.keys(problems).length) return invalid(intent, problems as Record<string, string>);
  const body = { ...common, type: type.key, config: parsed.config, enabled: form.get("enabled") === "on", ...(Object.keys(parsed.secret).length ? { secret: parsed.secret } : {}) };
  if (intent === "testDraft") {
    const result = await callApi<{ ok: boolean; latencyMs: number }>(ctx, request, `${base}/test-draft`, { method: "POST", body });
    return result.ok ? done(intent, "ops.channels.testOk", { ...result.data }) : failed(intent, result, undefined, { reason: result.message });
  }
  if (editing) {
    const result = await callApi(ctx, request, `${base}/${encodeURIComponent(id)}`, { method: "PUT", body: { ...body, baseVersion: Number(field(form, "baseVersion") || 0) } });
    return result.ok ? done(intent, "ops.channels.saved") : failed(intent, result);
  }
  const result = await callApi<Record<string, unknown>>(ctx, request, base, { method: "POST", body, idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
  if (!result.ok) return failed(intent, result);
  throw redirect(`/admin/channels?edit=${encodeURIComponent(idOf(result.data ?? {}, "notificationChannelId"))}&created=1`);
}

function TestResult({ result }: { result?: NotifyActionResult }) {
  const { t } = useTranslation();
  if (!result || (result.intent !== "test" && result.intent !== "testDraft")) return null;
  if (result.done) return <Alert tone="success">{t("ops.channels.testOk", { seconds: (Number(result.payload?.latencyMs ?? 0) / 1000).toFixed(1) })}</Alert>;
  if (!result.error) return null;
  const reason = result.payload?.reason && result.payload.reason !== result.error.code ? String(result.payload.reason) : errorText(t, result.error);
  return <Alert tone="danger">{t("ops.channels.testFailed", { reason })}</Alert>;
}

export default function AdminChannels({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const tz = root?.timezone ?? "Asia/Seoul";
  const { types, channels, editing, creatingType, tab, deliveries, idempotencyKey } = loaderData;
  const result = actionData as NotifyActionResult | undefined;
  const problems = result?.fieldErrors;
  const editingType = editing ? (types.find((ty) => ty.key === editing.type) ?? { key: editing.type, displayName: editing.type, available: true, configSchema: null }) : null;
  const general = result && !["test", "testDraft"].includes(result.intent) && !result.fieldErrors ? result : undefined;
  const notice = params.get("created") === "1" ? "ops.channels.created" : params.get("deleted") === "1" ? "ops.channels.deleted" : undefined;
  return (
    <>
      <PageHeader title={t("ops.channels.title")} />
      {notice && !result && <ResultAlert result={{ done: notice }} />}
      <ResultAlert result={general} />
      <Card className="mb-4" title={t("ops.channels.add")}>
        <ChannelTypeList types={types} />
      </Card>
      {creatingType && (
        <Card className="mb-4" title={t("ops.channels.addTitle", { type: creatingType.displayName })} actions={<ButtonLink to="/admin/channels">{t("common.cancel")}</ButtonLink>}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <ChannelFields type={creatingType} problems={problems} />
            <TestResult result={result} />
            <div className="flex justify-end gap-2">
              <Button type="submit" name="intent" value="testDraft">
                {t("ops.channels.testDraft")}
              </Button>
              <Button type="submit" name="intent" value="save" variant="primary">
                {t("ops.channels.save")}
              </Button>
            </div>
          </Form>
        </Card>
      )}
      {editing && editingType && (
        <Card className="mb-4" title={t("ops.channels.editTitle", { name: editing.name })} actions={<ButtonLink to="/admin/channels">{t("common.close")}</ButtonLink>}>
          <Tabs
            items={[
              { key: "settings", label: t("ops.channels.settings"), to: `?edit=${encodeURIComponent(editing.id)}` },
              { key: "deliveries", label: t("ops.channels.deliveries"), to: `?edit=${encodeURIComponent(editing.id)}&tab=deliveries` },
            ]}
            current={tab}
          />
          {tab === "settings" ? (
            <Form method="post" className="flex flex-col gap-3" key={editing.version}>
              <CsrfField />
              <input type="hidden" name="id" value={editing.id} />
              <input type="hidden" name="baseVersion" value={editing.version} />
              <input type="hidden" name="hasSecret" value={String(Boolean(editing.secretConfigured))} />
              <ChannelFields type={editingType} channel={editing} problems={problems} />
              <TestResult result={result} />
              <div className="flex justify-between gap-2">
                <Button type="submit" name="intent" value="delete" variant="danger" formNoValidate onClick={(e) => (window.confirm(t("ops.channels.deleteConfirm")) ? undefined : e.preventDefault())}>
                  {t("common.delete")}
                </Button>
                <span className="flex gap-2">
                  <Button type="submit" name="intent" value="test" formNoValidate>
                    {t("ops.channels.test")}
                  </Button>
                  <Button type="submit" name="intent" value="save" variant="primary">
                    {t("ops.channels.save")}
                  </Button>
                </span>
              </div>
            </Form>
          ) : (
            <Deliveries channelId={editing.id} rows={deliveries?.rows ?? []} nextCursor={deliveries?.nextCursor ?? null} timezone={tz} lang={i18n.language} />
          )}
        </Card>
      )}
      {channels.length === 0 ? (
        <EmptyState title={t("ops.channels.empty")} body={t("ops.channels.emptyBody")} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t("ops.channels.name")}</th>
                <th>{t("ops.channels.type")}</th>
                <th>{t("ops.channels.target")}</th>
                <th>{t("ops.channels.status")}</th>
                <th>{t("ops.channels.enabled")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{types.find((ty) => ty.key === c.type)?.displayName ?? c.type}</td>
                  <td>{t("ops.channels.targetCount", { count: targetCount(c.config) })}</td>
                  <td>
                    <StatusDot tone={STATUS_TONE[c.status] ?? "muted"} label={t(`ops.channels.statusValue.${c.status}`)} />
                  </td>
                  <td>
                    <Badge tone={c.enabled ? "success" : "neutral"}>{t(c.enabled ? "ops.channels.on" : "ops.channels.off")}</Badge>
                  </td>
                  <td>
                    <Link to={`?edit=${encodeURIComponent(c.id)}`} className="text-accent hover:underline">
                      {t("ops.channels.edit")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function Deliveries({ channelId, rows, nextCursor, timezone, lang }: { channelId: string; rows: Delivery[]; nextCursor: string | null; timezone: string; lang: string }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  return (
    <div className="flex flex-col gap-3">
      <Form method="get" className="flex items-end gap-2">
        <input type="hidden" name="edit" value={channelId} />
        <input type="hidden" name="tab" value="deliveries" />
        <SelectField label={t("ops.channels.status")} name="status" defaultValue={params.get("status") ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">{t("ops.channels.allStatuses")}</option>
          {DELIVERY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`ops.channels.deliveryStatus.${s}`)}
            </option>
          ))}
        </SelectField>
      </Form>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{t("ops.channels.deliveriesEmpty")}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("ops.channels.at")}</th>
              <th>{t("ops.channels.alarm")}</th>
              <th>{t("ops.channels.recipient")}</th>
              <th>{t("ops.channels.status")}</th>
              <th>{t("ops.channels.attempts")}</th>
              <th>{t("ops.channels.error")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.deliveryId}>
                <td>{formatDateTime(d.sentAt, timezone, lang)}</td>
                <td>{d.alarmId ? <Link to={`/alarms/${encodeURIComponent(d.alarmId)}`} className="text-accent hover:underline">{d.alarmId}</Link> : "–"}</td>
                <td className="font-mono text-[12px]">{d.recipient}</td>
                <td>
                  <Badge tone={d.status === "FAILED" ? "danger" : d.status === "SENT" ? "success" : "neutral"}>{t(`ops.channels.deliveryStatus.${d.status}`, { defaultValue: d.status })}</Badge>
                  {d.skipReason && <span className="ml-1 text-[12px] text-muted">{d.skipReason}</span>}
                </td>
                <td>{d.attempts}</td>
                <td className="text-[12px]">{d.lastError ?? ""}</td>
                <td>
                  {d.status === "FAILED" && (
                    <Form method="post">
                      <CsrfField />
                      <input type="hidden" name="intent" value="resend" />
                      <input type="hidden" name="deliveryId" value={d.deliveryId} />
                      <Button type="submit" variant="ghost">
                        {t("ops.channels.resend")}
                      </Button>
                    </Form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {nextCursor && (
        <div>
          <ButtonLink to={`?edit=${encodeURIComponent(channelId)}&tab=deliveries&cursor=${encodeURIComponent(nextCursor)}${params.get("status") ? `&status=${params.get("status")}` : ""}`}>{t("ops.channels.more")}</ButtonLink>
        </div>
      )}
    </div>
  );
}
