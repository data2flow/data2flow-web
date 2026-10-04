/**
 * UI-OPS-05 유지보수 일정(OPS-05.01~05.03, BR-OPS-10·11). ADMIN·OPERATOR(자기 공간 범위 — 범위 밖 대상은 서버가 404).
 * API: 목록 API-OPS-23 `GET /maintenance-windows?status=`(탭: 진행 중 ACTIVE / 예약 SCHEDULED / 지난 ENDED,CANCELED),
 * 시작 API-OPS-20 `POST /maintenance-windows {targetType, targetId, startsAt?, endsAt?, pauseAutomation, excludeFromAnalytics, reason}`
 * (겹치면 409 MAINTENANCE_OVERLAP, 기간 오류 400 MAINTENANCE_RANGE_INVALID), 종료 API-OPS-21, 예약 취소 API-OPS-22.
 * 대상 후보는 공간 트리(API-DEV-01)와 기기 목록(API-DEV-11). 일시는 조직 시간대로 입력받아 UTC로 보낸다
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Badge, Button, ButtonLink, Card, Checkbox, CsrfField, EmptyState, PageHeader, SelectField, Table, Tabs, TextField } from "~/components/ui";
import { SpaceSelect } from "~/components/space-picker";
import { localToUtc } from "~/features/explore/model/time";
import { ResultAlert } from "~/features/notify/components/common";
import { MAINTENANCE_TABS, REASON_MAX, checkMaintenance, maintenanceActions, maintenanceBody, normalizeMaintenance, statusesOf, tabOf, type MaintenanceErrors } from "~/features/notify/model/maintenance";
import { done, failed, invalid, loadSpaces, loadUsers, type NotifyActionResult } from "~/features/notify/server";
import { formatDateTime } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/admin-maintenance";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const tab = tabOf(url.searchParams.get("tab"));
  const creating = url.searchParams.get("new") === "1";
  const [list, spaces, devices, users] = await Promise.all([
    callList<Record<string, unknown>>(ctx, request, `/api/v1/core/maintenance-windows?status=${statusesOf(tab).join(",")}&size=100`),
    creating ? loadSpaces(ctx, request) : Promise.resolve([] as SpaceNode[]),
    creating ? callList<{ id: string | number; name: string }>(ctx, request, "/api/v1/core/devices?size=100") : null,
    // 만든 사람 이름(core는 사용자 ID만 준다). 회원 목록은 관리자만 볼 수 있어 실패하면 ID를 보인다
    loadUsers(ctx, request),
  ]);
  const nameOf = new Map(users.users.map((u) => [u.id, u.name]));
  return {
    tab,
    creating,
    windows: listOrThrow(list)
      .responses.map(normalizeMaintenance)
      .map((w) => (w.createdBy ? { ...w, createdBy: { ...w.createdBy, name: w.createdBy.name || nameOf.get(w.createdBy.userId) || w.createdBy.userId } } : w)),
    spaces,
    devices: devices?.ok ? devices.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "end" || intent === "cancel") {
    const result = await callApi(ctx, request, `/api/v1/core/maintenance-windows/${encodeURIComponent(field(form, "id"))}/${intent}`, { method: "POST" });
    return result.ok ? done(intent, intent === "end" ? "ops.maintenance.ended" : "ops.maintenance.canceled") : failed(intent, result);
  }
  const timezone = field(form, "timezone") || "Asia/Seoul";
  const targetType = field(form, "targetType");
  const input = {
    targetType,
    targetId: targetType === "DEVICE" ? field(form, "deviceId") : field(form, "spaceId"),
    startsAt: field(form, "startMode") === "at" ? (localToUtc(field(form, "startsAt"), timezone) ?? "invalid") : null,
    endsAt: field(form, "endMode") === "at" ? (localToUtc(field(form, "endsAt"), timezone) ?? "invalid") : null,
    pauseAutomation: form.get("pauseAutomation") === "on",
    excludeFromAnalytics: form.get("excludeFromAnalytics") === "on",
    reason: field(form, "reason"),
  };
  const errors = checkMaintenance(input, Date.now());
  if (Object.keys(errors).length) return invalid("create", errors);
  const result = await callApi(ctx, request, "/api/v1/core/maintenance-windows", { method: "POST", body: maintenanceBody(input), idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
  return result.ok ? done("create", "ops.maintenance.created") : failed("create", result);
}

function CreateForm({ spaces, devices, errors, timezone, idempotencyKey }: { spaces: SpaceNode[]; devices: { id: string; name: string }[]; errors?: MaintenanceErrors; timezone: string; idempotencyKey: string }) {
  const { t } = useTranslation();
  const [targetType, setTargetType] = useState("SPACE");
  const [startMode, setStartMode] = useState("now");
  const [endMode, setEndMode] = useState("at");
  const err = (key: keyof MaintenanceErrors) => (errors?.[key] ? t(`ops.maintenance.errors.${errors[key]}`) : undefined);
  const radio = (name: string, value: string, current: string, set: (v: string) => void, label: string) => (
    <label className="inline-flex items-center gap-1.5 text-[13px]">
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value)} />
      {label}
    </label>
  );
  return (
    <Form method="post" className="flex flex-col gap-3">
      <CsrfField />
      <input type="hidden" name="intent" value="create" />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("ops.maintenance.target")}</legend>
        <div className="flex gap-4">
          {radio("targetType", "SPACE", targetType, setTargetType, t("ops.maintenance.SPACE"))}
          {radio("targetType", "DEVICE", targetType, setTargetType, t("ops.maintenance.DEVICE"))}
        </div>
        {targetType === "SPACE" ? (
          <SpaceSelect spaces={spaces} label={t("ops.maintenance.space")} name="spaceId" error={err("target")} />
        ) : (
          <SelectField label={t("ops.maintenance.device")} name="deviceId" error={err("target")}>
            <option value="">{t("ops.maintenance.chooseDevice")}</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
        )}
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("ops.maintenance.start")}</legend>
          <div className="flex gap-4">
            {radio("startMode", "now", startMode, setStartMode, t("ops.maintenance.startNow"))}
            {radio("startMode", "at", startMode, setStartMode, t("ops.maintenance.startAt"))}
          </div>
          {startMode === "at" && <TextField label={t("ops.maintenance.startAt")} name="startsAt" type="datetime-local" />}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("ops.maintenance.end")}</legend>
          <div className="flex gap-4">
            {radio("endMode", "none", endMode, setEndMode, t("ops.maintenance.endNone"))}
            {radio("endMode", "at", endMode, setEndMode, t("ops.maintenance.endAt"))}
          </div>
          {endMode === "at" && <TextField label={t("ops.maintenance.endAt")} name="endsAt" type="datetime-local" />}
        </fieldset>
      </div>
      {err("range") && <p className="text-[12.5px] text-bad">{err("range")}</p>}
      <div className="flex flex-wrap gap-4">
        <Checkbox label={t("ops.maintenance.pauseAutomation")} name="pauseAutomation" defaultChecked />
        <Checkbox label={t("ops.maintenance.excludeFromAnalytics")} name="excludeFromAnalytics" defaultChecked />
      </div>
      <TextField label={t("ops.maintenance.reason")} name="reason" maxLength={REASON_MAX} required error={err("reason")} />
      <div className="flex justify-end gap-2">
        <ButtonLink to="/admin/maintenance">{t("common.cancel")}</ButtonLink>
        <Button type="submit" variant="primary">
          {t("ops.maintenance.new")}
        </Button>
      </div>
    </Form>
  );
}

export default function AdminMaintenance({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const [params] = useSearchParams();
  const tz = root?.timezone ?? "Asia/Seoul";
  const { tab, creating, windows, spaces, devices, idempotencyKey } = loaderData;
  const result = actionData as NotifyActionResult | undefined;
  const showCreate = creating || (result?.intent === "create" && !result.done);
  return (
    <>
      <PageHeader title={t("ops.maintenance.title")} actions={!showCreate && <ButtonLink to="?new=1" variant="primary">{t("ops.maintenance.new")}</ButtonLink>} />
      <ResultAlert result={result?.intent === "create" && result.fieldErrors ? undefined : result} />
      {showCreate && (
        <Card className="mb-4" title={t("ops.maintenance.new")}>
          <CreateForm spaces={spaces} devices={devices} errors={result?.fieldErrors as MaintenanceErrors | undefined} timezone={tz} idempotencyKey={idempotencyKey} />
        </Card>
      )}
      <Tabs items={MAINTENANCE_TABS.map((key) => ({ key, label: t(`ops.maintenance.tabs.${key}`), to: `?tab=${key}` }))} current={params.get("tab") ? tab : "active"} />
      {windows.length === 0 ? (
        <EmptyState title={t(`ops.maintenance.empty.${tab}`)} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t("ops.maintenance.target")}</th>
                <th>{t("ops.maintenance.start")}</th>
                <th>{t("ops.maintenance.end")}</th>
                <th>{t("ops.maintenance.options")}</th>
                <th>{t("ops.maintenance.reason")}</th>
                <th>{t("ops.maintenance.createdBy")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {windows.map((w) => (
                <tr key={w.id}>
                  <td>
                    <span className="mr-1.5 text-muted">{t(`ops.maintenance.${w.targetType}`)}</span>
                    {w.targetName ?? w.targetId}
                    <span className="ml-2">
                      <Badge tone={w.status === "ACTIVE" ? "warning" : "neutral"}>{t(`ops.maintenance.status.${w.status}`)}</Badge>
                    </span>
                  </td>
                  <td>{formatDateTime(w.startsAt, tz, i18n.language)}</td>
                  <td>{w.endsAt ? formatDateTime(w.endsAt, tz, i18n.language) : t("ops.maintenance.openEnded")}</td>
                  <td className="text-[12.5px]">
                    {w.pauseAutomation && <div>{t("ops.maintenance.pauseAutomation")}</div>}
                    {w.excludeFromAnalytics && <div>{t("ops.maintenance.excludeFromAnalytics")}</div>}
                  </td>
                  <td>{w.reason}</td>
                  <td>{w.createdBy?.name ?? "–"}</td>
                  <td>
                    {maintenanceActions(w.status).map((act) => (
                      <Form key={act} method="post" onSubmit={(e) => (window.confirm(t(act === "end" ? "ops.maintenance.endConfirm" : "ops.maintenance.cancelConfirm")) ? undefined : e.preventDefault())}>
                        <CsrfField />
                        <input type="hidden" name="intent" value={act} />
                        <input type="hidden" name="id" value={w.id} />
                        <Button type="submit" variant={act === "end" ? "secondary" : "ghost"}>
                          {t(act === "end" ? "ops.maintenance.endAction" : "ops.maintenance.cancelAction")}
                        </Button>
                      </Form>
                    ))}
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
