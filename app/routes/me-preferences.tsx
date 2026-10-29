/**
 * UI-DSH-11 화면 설정(`/me/preferences`, UI-IAM-04 내 정보의 [화면 설정] 탭, UC-DSH-11, DSH-07). 본인만, 모든 사용자.
 * API-DSH-12 `GET|PUT /accounts/me/preferences`(보낸 키만 바꾼다, baseVersion): 테마, 첫 화면(홈/기본 대시보드), 온도 단위(DEV-04.04),
 * 즐겨찾기 관리, 기능 안내 투어 다시 보기(toursDismissed 비우기). 언어·시간대는 계정 프로필(API-IAM)이 원본이라 [프로필] 탭에서 바꾼다.
 * 테마는 사용자 메뉴의 빠른 전환과 같게 쿠키(`data2flow_theme`)에도 남겨 서버 렌더링부터 적용한다.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useActionData } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, Card, CsrfField, EmptyState, SelectField, Table } from "~/components/ui";
import { clearDismissedLocal } from "~/components/feature-tour";
import { errorText } from "~/lib/error-text";
import { THEMES, THEME_COOKIE, normalizeTheme } from "~/lib/theme";
import type { Route } from "./+types/me-preferences";

const PREFS = "/api/v1/core/accounts/me/preferences";

interface Preferences {
  theme?: string | null;
  home?: "HOME" | "DASHBOARD" | null;
  defaultDashboardId?: string | null;
  favorites?: { type: string; id: string; name?: string | null }[];
  toursDismissed?: string[];
  temperatureUnit?: "C" | "F" | null;
  effectiveTemperatureUnit?: "C" | "F" | null;
  version?: number;
}

type ActionResult = { intent: string; ok?: boolean; error?: { code: string; message?: string }; fieldError?: string };

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [prefs, dashboards] = await Promise.all([
    callApi<Preferences>(ctx, request, PREFS, { noGuards: true }),
    callList<{ id: string | number; name: string }>(ctx, request, "/api/v1/core/dashboards?size=100", { noGuards: true }),
  ]);
  return {
    prefs: prefs.ok ? (prefs.data ?? null) : null,
    failure: prefs.ok ? null : { code: prefs.code, message: prefs.message },
    dashboards: dashboards.ok ? dashboards.list.responses.map((d) => ({ id: String(d.id), name: d.name })) : [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const current = await callApi<Preferences>(ctx, request, PREFS, { noGuards: true });
  if (!current.ok) return data({ intent, error: { code: current.code, message: current.message } } satisfies ActionResult, { status: current.status });
  const baseVersion = current.data?.version ?? 0;
  let body: Record<string, unknown>;
  let cookie: string | undefined;
  if (intent === "save") {
    const theme = normalizeTheme(field(form, "theme"));
    const home = field(form, "home") === "DASHBOARD" ? "DASHBOARD" : "HOME";
    const dashboardId = field(form, "defaultDashboardId");
    if (home === "DASHBOARD" && !/^\d+$/.test(dashboardId)) return data({ intent, fieldError: "defaultDashboardId" } satisfies ActionResult, { status: 400 });
    const unit = field(form, "temperatureUnit");
    body = { theme, home, defaultDashboardId: home === "DASHBOARD" ? dashboardId : (current.data?.defaultDashboardId ?? null), temperatureUnit: unit === "C" || unit === "F" ? unit : null };
    const secure = ctx.runtime.config.cookieSecure ? "; Secure" : "";
    cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } else if (intent === "removeFavorite") {
    const key = field(form, "favorite");
    body = { favorites: (current.data?.favorites ?? []).filter((f) => `${f.type}:${f.id}` !== key).map((f) => ({ type: f.type, id: f.id })) };
  } else if (intent === "resetTours") {
    body = { toursDismissed: [] };
  } else {
    return data({ intent, error: { code: "INVALID_REQUEST" } } satisfies ActionResult, { status: 400 });
  }
  const saved = await callApi<Preferences>(ctx, request, PREFS, { method: "PUT", body: { ...body, baseVersion }, noGuards: true });
  if (!saved.ok) return data({ intent, error: { code: saved.code, message: saved.message } } satisfies ActionResult, { status: saved.status });
  return data({ intent, ok: true } satisfies ActionResult, cookie ? { headers: { "Set-Cookie": cookie } } : undefined);
}

export default function MePreferences({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const { prefs, dashboards } = loaderData;
  if (!prefs) return <Alert tone="danger">{errorText(t, loaderData.failure)}</Alert>;
  const favorites = prefs.favorites ?? [];
  return (
    <div className="flex flex-col gap-4">
      {result?.ok && <Alert tone="success">{t(`me.preferences.done.${result.intent}`)}</Alert>}
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      <Card title={t("me.preferences.display")}>
        <Form method="post" className="flex flex-col gap-3">
          <CsrfField />
          <input type="hidden" name="intent" value="save" />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t("me.preferences.theme")} name="theme" defaultValue={normalizeTheme(prefs.theme)}>
              {THEMES.map((th) => (
                <option key={th} value={th}>
                  {t(`me.preferences.themes.${th}`)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("me.preferences.temperatureUnit")} name="temperatureUnit" defaultValue={prefs.temperatureUnit ?? ""}>
              <option value="">{t("me.preferences.orgDefault", { unit: prefs.effectiveTemperatureUnit === "F" ? "℉" : "℃" })}</option>
              <option value="C">℃</option>
              <option value="F">℉</option>
            </SelectField>
            <SelectField label={t("me.preferences.home")} name="home" defaultValue={prefs.home ?? "HOME"}>
              <option value="HOME">{t("me.preferences.homes.HOME")}</option>
              <option value="DASHBOARD">{t("me.preferences.homes.DASHBOARD")}</option>
            </SelectField>
            <SelectField
              label={t("me.preferences.defaultDashboard")}
              name="defaultDashboardId"
              defaultValue={prefs.defaultDashboardId ? String(prefs.defaultDashboardId) : ""}
              error={result?.fieldError === "defaultDashboardId" ? t("me.preferences.dashboardRequired") : undefined}
            >
              <option value="">{t("me.preferences.noDashboard")}</option>
              {dashboards.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="text-[12px] text-muted">
            {t("me.preferences.localeHint")}{" "}
            <Link to="/me/profile" className="text-accent hover:underline">
              {t("me.tabs.profile")}
            </Link>
          </p>
          <div>
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </Form>
      </Card>

      <Card title={t("me.preferences.favorites")}>
        {favorites.length === 0 ? (
          <EmptyState title={t("me.preferences.noFavorites")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("me.preferences.favoriteType")}</th>
                <th>{t("me.preferences.favoriteName")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {favorites.map((f) => (
                <tr key={`${f.type}:${f.id}`}>
                  <td>{t(`me.preferences.types.${f.type}`, { defaultValue: f.type })}</td>
                  <td>{f.name ?? `#${f.id}`}</td>
                  <td>
                    <Form method="post">
                      <CsrfField />
                      <input type="hidden" name="intent" value="removeFavorite" />
                      <input type="hidden" name="favorite" value={`${f.type}:${f.id}`} />
                      <Button type="submit" variant="ghost" aria-label={t("me.preferences.removeFavorite", { name: f.name ?? f.id })}>
                        {t("common.delete")}
                      </Button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={t("me.preferences.tours")}>
        <Form method="post" className="flex flex-wrap items-center justify-between gap-2" onSubmit={() => clearDismissedLocal()}>
          <CsrfField />
          <input type="hidden" name="intent" value="resetTours" />
          <p className="text-[13px]">{t("me.preferences.toursBody", { n: prefs.toursDismissed?.length ?? 0 })}</p>
          <Button type="submit">{t("me.preferences.resetTours")}</Button>
        </Form>
      </Card>
    </div>
  );
}
