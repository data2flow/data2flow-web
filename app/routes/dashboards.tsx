/**
 * UI-DSH-04 대시보드 목록(`/dashboards?tab=mine|shared|favorite`, DSH-04.07): 카드(이름·소유자·수정 시각·기본 표시·위젯 수),
 * [새 대시보드], 카드 메뉴(복제·기본으로·JSON 내보내기·삭제), [JSON 가져오기]. 보기는 VIEWER 이상, 만들기·복제·삭제는 DASHBOARD_WRITE.
 * 기본 대시보드는 화면 설정(API-DSH-12 `defaultDashboardId`)으로 표시하고 지정은 `PUT /accounts/me/default-dashboard` + `home: DASHBOARD`.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useActionData, useNavigate, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, Dialog, EmptyState, PageHeader, Pager, Tabs, TextField } from "~/components/ui";
import { dashboardsApi } from "~/features/dashboards/api";
import { exportFileName } from "~/features/dashboards/model/data";
import { kioskUrl } from "~/features/dashboards/model/kiosk";
import { NAME_MAX, parseImport } from "~/features/dashboards/model/transfer";
import type { DashboardSummary } from "~/features/dashboards/model/types";
import { downloadText } from "~/lib/download";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/dashboards";

export function meta() {
  return [{ title: "data2flow" }];
}

const TABS = ["mine", "shared", "favorite"] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const tab = (TABS as readonly string[]).includes(url.searchParams.get("tab") ?? "") ? (url.searchParams.get("tab") as string) : "mine";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const keyword = (url.searchParams.get("keyword") ?? "").slice(0, 100);
  const query = new URLSearchParams({ tab, page: String(page), size: "20" });
  if (keyword) query.set("keyword", keyword);
  const [list, prefs] = await Promise.all([
    callList<DashboardSummary>(ctx, request, `/api/v1/core/dashboards?${query}`),
    callApi<{ defaultDashboardId?: string | null }>(ctx, request, "/api/v1/core/accounts/me/preferences", { noGuards: true }),
  ]);
  return {
    tab,
    page,
    keyword,
    items: list.ok ? list.list.responses : [],
    totalPages: list.ok ? list.list.totalPages : 1,
    failed: !list.ok,
    defaultId: prefs.ok ? (prefs.data?.defaultDashboardId ?? null) : null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const enc = encodeURIComponent;
  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    if (!name || name.length > NAME_MAX) return data({ intent, error: "NAME" }, { status: 400 });
    const r = await callApi<{ id: string }>(ctx, request, "/api/v1/core/dashboards", { method: "POST", body: { name, visibility: "PRIVATE", layout: { widgets: [] }, variables: [], timeRange: { relative: "24h" } }, idempotencyKey: crypto.randomUUID() });
    if (!r.ok) return data({ intent, error: r.code, message: r.message }, { status: r.status });
    throw redirect(`/dashboards/${enc(r.data.id)}/edit`);
  }
  if (intent === "duplicate") {
    const r = await callApi<{ id: string }>(ctx, request, `/api/v1/core/dashboards/${enc(id)}/duplicate`, { method: "POST", idempotencyKey: crypto.randomUUID() });
    if (!r.ok) return data({ intent, error: r.code, message: r.message }, { status: r.status });
    throw redirect(`/dashboards/${enc(r.data.id)}`);
  }
  if (intent === "default") {
    const r = await callApi(ctx, request, "/api/v1/core/accounts/me/default-dashboard", { method: "PUT", body: { dashboardId: id || null } });
    if (!r.ok) return data({ intent, error: r.code, message: r.message }, { status: r.status });
    // 로그인 뒤 첫 화면을 기본 대시보드로(DSH-04.07). 해제하면 홈으로
    const prefs = await callApi<{ version?: number }>(ctx, request, "/api/v1/core/accounts/me/preferences", { noGuards: true });
    if (prefs.ok) await callApi(ctx, request, "/api/v1/core/accounts/me/preferences", { method: "PUT", body: { home: id ? "DASHBOARD" : "HOME", baseVersion: prefs.data?.version ?? 0 }, noGuards: true });
    return { intent, ok: true };
  }
  if (intent === "delete") {
    const r = await callApi(ctx, request, `/api/v1/core/dashboards/${enc(id)}`, { method: "DELETE" });
    if (!r.ok) return data({ intent, error: r.code, message: r.message }, { status: r.status });
    return { intent, ok: true };
  }
  return data({ intent, error: "INVALID_REQUEST" }, { status: 400 });
}

export default function Dashboards({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  const result = useActionData<typeof action>() as { intent?: string; error?: string; message?: string; ok?: boolean } | undefined;
  const canWrite = hasAny(root?.me?.permissions, ["DASHBOARD_WRITE"]);
  const timezone = root?.timezone ?? "Asia/Seoul";
  const { items, tab, defaultId, failed, page, totalPages } = loaderData;
  const [creating, setCreating] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<{ ref: string; reason: string }[] | null>(null);
  const [kioskPick, setKioskPick] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const exportJson = async (item: DashboardSummary) => {
    const r = await dashboardsApi.exportJson(item.id);
    if (r.ok) downloadText(JSON.stringify(r.data, null, 2), exportFileName(item.name, "json"), "application/json");
  };
  const importJson = async (file: File) => {
    setImportError(null);
    const check = parseImport(await file.text(), file.size);
    if (!check.ok) {
      setImportError(t(`dashboards.import.${check.reason}`));
      return;
    }
    const r = await dashboardsApi.importJson(check.body);
    if (!r.ok) {
      setImportError(r.message || r.code);
      return;
    }
    if (r.data.unmapped?.length) setUnmapped(r.data.unmapped);
    else navigate(`/dashboards/${encodeURIComponent(r.data.id)}`);
  };

  return (
    <>
      <PageHeader
        title={t("dashboards.title")}
        actions={
          <div className="flex flex-wrap gap-2">
            {kioskPick.length > 0 && (
              <Link to={kioskUrl(kioskPick)} className="rounded-md border border-line px-3 py-1.5 text-[13px]">
                {t("dashboards.kiosk.start", { n: kioskPick.length })}
              </Link>
            )}
            {canWrite && (
              <>
                <Button onClick={() => fileInput.current?.click()}>{t("dashboards.import.button")}</Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  aria-label={t("dashboards.import.button")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importJson(file);
                    e.target.value = "";
                  }}
                />
                <Button variant="primary" onClick={() => setCreating(true)}>
                  {t("dashboards.new")}
                </Button>
              </>
            )}
          </div>
        }
      />
      <Tabs current={tab} items={TABS.map((key) => ({ key, label: t(`dashboards.tabs.${key}`), to: `/dashboards?tab=${key}` }))} />
      {failed && <Alert tone="warning">{t("dashboards.loadFailed")}</Alert>}
      {result?.error && <Alert tone="danger">{result.message || t(`dashboards.errors.${result.error}`, { defaultValue: result.error })}</Alert>}
      {importError && <Alert tone="danger">{importError}</Alert>}
      {unmapped && (
        <Alert tone="warning">
          <p>{t("dashboards.import.unmapped", { n: unmapped.length })}</p>
          <ul className="list-inside list-disc">
            {unmapped.map((u) => (
              <li key={u.ref}>
                {u.ref}: {u.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {items.length === 0 && !failed ? (
        <EmptyState title={t("dashboards.empty")} body={canWrite ? t("dashboards.emptyBody") : undefined} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/dashboards/${encodeURIComponent(item.id)}`} className="font-semibold text-accent hover:underline">
                      {item.name}
                    </Link>
                    <p className="text-[12px] text-muted">
                      {item.ownerName ?? "–"} · {t(`dashboards.visibility.${item.visibility}`, { defaultValue: item.visibility })} · {t("dashboards.widgetCount", { n: item.widgetCount })}
                    </p>
                    <p className="text-[12px] text-muted">{formatDateTime(item.updatedAt ?? null, timezone, i18n.language)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {defaultId === item.id && <Badge tone="info">{`★ ${t("dashboards.isDefault")}`}</Badge>}
                    {item.favorite && <Badge tone="neutral">{`☆ ${t("dashboards.favorite")}`}</Badge>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <label className="mr-auto flex items-center gap-1 text-[12px]">
                    <input type="checkbox" checked={kioskPick.includes(item.id)} onChange={(e) => setKioskPick((p) => (e.target.checked ? [...p, item.id].slice(0, 10) : p.filter((x) => x !== item.id)))} />
                    {t("dashboards.kiosk.pick")}
                  </label>
                  <Form method="post">
                    <CsrfField />
                    <input type="hidden" name="id" value={defaultId === item.id ? "" : item.id} />
                    <button type="submit" name="intent" value="default" className="rounded px-2 py-1 text-[12px] hover:bg-bg">
                      {defaultId === item.id ? t("dashboards.unsetDefault") : t("dashboards.setDefault")}
                    </button>
                  </Form>
                  <button type="button" className="rounded px-2 py-1 text-[12px] hover:bg-bg" onClick={() => void exportJson(item)}>
                    {t("dashboards.exportJson")}
                  </button>
                  {canWrite && (
                    <Form method="post">
                      <CsrfField />
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" name="intent" value="duplicate" className="rounded px-2 py-1 text-[12px] hover:bg-bg">
                        {t("dashboards.duplicate")}
                      </button>
                    </Form>
                  )}
                  {canWrite && (
                    <Form method="post" onSubmit={(e) => !window.confirm(t("dashboards.deleteConfirm", { name: item.name })) && e.preventDefault()}>
                      <CsrfField />
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" name="intent" value="delete" className="rounded px-2 py-1 text-[12px] text-bad hover:bg-bad-soft">
                        {t("dashboards.delete")}
                      </button>
                    </Form>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} totalPages={totalPages} />
      <Dialog open={creating} onClose={() => setCreating(false)} title={t("dashboards.new")}>
        <Form method="post" className="flex flex-col gap-3">
          <CsrfField />
          <TextField label={t("dashboards.fields.name")} name="name" required maxLength={NAME_MAX} error={result?.intent === "create" && result.error === "NAME" ? t("dashboards.errors.nameRequired") : undefined} />
          <div className="flex justify-end">
            <Button type="submit" name="intent" value="create" variant="primary">
              {t("dashboards.create")}
            </Button>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
