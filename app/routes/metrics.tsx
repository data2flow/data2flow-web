/**
 * UI-DEV-09 측정 항목·별칭(DEV-04.01, DEV-04.02): 검증됨·미검증·무시됨·별칭 탭. 조회 DEV_READ, 수정 DEV_ADMIN.
 * API: 목록 API-DEV-50, 생성·수정 API-DEV-51(baseVersion), 표준 등록 API-DEV-52, 별칭 연결 API-DEV-53 → 진행률 API-DEV-56,
 * 무시·복원 API-DEV-54, 별칭 API-DEV-55
 */
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, ButtonLink, Card, Checkbox, CountBadge, CsrfField, EmptyState, PageHeader, SelectField, Table, Tabs, Term, TextField } from "~/components/ui";
import { MetricFields } from "~/features/catalog/components/metric-fields";
import { RemapProgress } from "~/features/catalog/components/remap-progress";
import { METRIC_KEY_PATTERN, checkMetricInput, metricBody, recommendKeys, type MetricInput } from "~/features/catalog/model/catalog";
import type { AliasRow, MetricRow } from "~/features/catalog/model/types";
import { can, failed, invalid, outcome, type CatalogActionResult } from "~/features/catalog/server";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { UnitSettingsCard, type UnitSettings } from "~/features/devmodel/components/unit-settings";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/metrics";

const TABS = ["verified", "unverified", "ignored", "aliases"] as const;
type Tab = (typeof TABS)[number];

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "verified";
  const [verified, unverified, ignored, aliases, units] = await Promise.all([
    callList<MetricRow>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100"),
    callList<MetricRow>(ctx, request, "/api/v1/core/metrics?status=UNVERIFIED&size=100"),
    callList<MetricRow>(ctx, request, "/api/v1/core/metrics?status=IGNORED&size=100"),
    tab === "aliases" ? callList<AliasRow>(ctx, request, "/api/v1/core/metric-aliases?size=100") : null,
    // DEV-04.04 조직 기본 표시 단위(API-DEV-57)
    tab === "verified" ? callApi<UnitSettings>(ctx, request, "/api/v1/core/settings/units") : null,
  ]);
  const v = listOrThrow(verified);
  const u = unverified.ok ? unverified.list : { responses: [], totalCount: 0 };
  const i = ignored.ok ? ignored.list : { responses: [], totalCount: 0 };
  return {
    tab,
    verified: v.responses,
    unverified: u.responses,
    ignored: i.responses,
    counts: { verified: v.totalCount ?? v.responses.length, unverified: u.totalCount ?? u.responses.length, ignored: i.totalCount ?? i.responses.length },
    aliases: aliases?.ok ? aliases.list.responses : [],
    units: units?.ok ? units.data : null,
    editId: url.searchParams.get("edit"),
    creating: url.searchParams.get("new") === "1",
    idempotencyKey: newIdempotencyKey(),
  };
}

function readMetric(form: FormData): MetricInput {
  return {
    key: field(form, "key"),
    displayName: field(form, "displayName"),
    unit: field(form, "unit"),
    valueType: field(form, "valueType"),
    enumMap: field(form, "enumMap"),
    validMin: field(form, "validMin"),
    validMax: field(form, "validMax"),
    precision: field(form, "precision"),
    aggDefault: field(form, "aggDefault"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(field(form, "id"));
  const base = `/api/v1/core/metrics/${id}`;
  switch (intent) {
    case "create":
    case "update":
    case "verify": {
      const input = readMetric(form);
      const errors = checkMetricInput(input, { creating: intent === "create" });
      if (Object.keys(errors).length) return invalid(intent, errors);
      const body = metricBody(input, intent === "create");
      const result =
        intent === "create"
          ? await callApi(ctx, request, "/api/v1/core/metrics", { method: "POST", body, idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() })
          : intent === "verify"
            ? await callApi(ctx, request, `${base}/verify`, { method: "POST", body })
            : await callApi(ctx, request, base, { method: "PATCH", body: { ...body, baseVersion: Number(field(form, "baseVersion")) } });
      if (!result.ok) return failed(intent, result);
      throw redirect(`/metrics?tab=${intent === "verify" ? "unverified" : "verified"}&saved=1`);
    }
    case "alias": {
      const targetKey = field(form, "targetKey");
      if (!targetKey) return invalid(intent, { targetKey: "required" });
      const result = await callApi<{ remapJobId?: string | null }>(ctx, request, `${base}/alias-to`, { method: "POST", body: { targetKey, remapHistory: form.get("remapHistory") === "on" } });
      if (!result.ok) return failed(intent, result);
      return { intent, done: true, remapJobId: result.data?.remapJobId ?? null } as CatalogActionResult;
    }
    case "ignore":
    case "restore":
      return outcome(intent, await callApi(ctx, request, `${base}/${intent}`, { method: "POST" }));
    case "alias-add": {
      const alias = field(form, "alias").trim();
      if (!METRIC_KEY_PATTERN.test(alias)) return invalid(intent, { alias: "metricKey" });
      return outcome(intent, await callApi(ctx, request, "/api/v1/core/metric-aliases", { method: "POST", body: { alias, metricKey: field(form, "metricKey") } }));
    }
    case "units": {
      const unit = field(form, "temperatureUnit");
      if (unit !== "C" && unit !== "F") return invalid(intent, { temperatureUnit: "required" });
      return outcome(intent, await callApi(ctx, request, "/api/v1/core/settings/units", { method: "PUT", body: { temperatureUnit: unit, baseVersion: Number(field(form, "baseVersion")) } }));
    }
    case "alias-delete":
      return outcome(intent, await callApi(ctx, request, `/api/v1/core/metric-aliases/${id}`, { method: "DELETE" }));
    default:
      return data({ intent, error: { code: "INVALID_REQUEST" } } as CatalogActionResult, { status: 400 });
  }
}

function Post({ intent, id, label, variant = "secondary", confirm }: { intent: string; id: string; label: string; variant?: "secondary" | "danger" | "primary"; confirm?: string }) {
  return (
    <Form method="post" className="inline" onSubmit={(e) => confirm && !window.confirm(confirm) && e.preventDefault()}>
      <CsrfField />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </Form>
  );
}

function range(m: MetricRow) {
  if (m.validMin == null && m.validMax == null) return "–";
  return `${m.validMin ?? ""} ~ ${m.validMax ?? ""}`;
}

export default function Metrics({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const admin = can(root?.me?.permissions, "DEV_ADMIN");
  const [params] = useSearchParams();
  const { tab, verified, unverified, ignored, counts, aliases, editId, creating, idempotencyKey } = loaderData;
  const result = actionData as CatalogActionResult | undefined;
  const standardKeys = verified.map((m) => m.key);
  const editing = editId ? verified.find((m) => m.id === editId) : undefined;
  const verifyId = params.get("verify");
  const verifying = verifyId ? unverified.find((m) => m.id === verifyId) : undefined;
  const fieldErrorsFor = (intent: string) => (result?.intent === intent ? result.fieldErrors : undefined);
  const tz = root?.timezone ?? "Asia/Seoul";
  return (
    <>
      <PageHeader title={t("catalog.metrics.title")} actions={admin && tab === "verified" && !creating && <ButtonLink to="?tab=verified&new=1" variant="primary">{t("catalog.metrics.new")}</ButtonLink>} />
      <DeviceAreaTabs current="metrics" />
      {((result?.done && !result.remapJobId) || (!result && params.get("saved") === "1")) && (
        <div className="mb-3">
          <Alert tone="success">{t("common.done")}</Alert>
        </div>
      )}
      {result?.remapJobId && (
        <div className="mb-3">
          <Card title={t("catalog.metrics.remapTitle")}>
            <RemapProgress jobId={result.remapJobId} />
          </Card>
        </div>
      )}
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      <Tabs
        current={tab}
        items={TABS.map((key) => ({
          key,
          label: (
            <>
              {t(`catalog.metrics.tab.${key}`)}
              {key !== "aliases" && <CountBadge n={counts[key]} />}
            </>
          ),
          to: `?tab=${key}`,
        }))}
      />
      {admin && (creating || editing || verifying) && (
        <Card className="mb-4" title={creating ? t("catalog.metrics.new") : verifying ? t("catalog.metrics.verifyTitle", { key: verifying.key }) : t("catalog.metrics.editTitle", { key: editing?.key })} actions={<ButtonLink to={`?tab=${tab}`}>{t("common.cancel")}</ButtonLink>}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value={creating ? "create" : verifying ? "verify" : "update"} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            {!creating && <input type="hidden" name="id" value={(verifying ?? editing)?.id} />}
            {editing && <input type="hidden" name="baseVersion" value={editing.version} />}
            <MetricFields metric={verifying ?? editing} creating={creating} fieldErrors={fieldErrorsFor(creating ? "create" : verifying ? "verify" : "update")} />
            {editing?.builtin && <p className="text-[12px] text-muted">{t("catalog.metrics.builtinKey")}</p>}
            <div className="flex justify-end">
              <Button type="submit" variant="primary">
                {verifying ? t("catalog.metrics.verify") : t("common.save")}
              </Button>
            </div>
          </Form>
        </Card>
      )}
      {tab === "verified" && loaderData.units && <UnitSettingsCard settings={loaderData.units} canEdit={can(root?.me?.permissions, "OPS_MANAGE")} />}
      {tab === "verified" && (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>
                  <Term term="metric">{t("catalog.metrics.key")}</Term>
                </th>
                <th>{t("catalog.metrics.displayName")}</th>
                <th>{t("catalog.metrics.unit")}</th>
                <th>{t("catalog.metrics.valueType")}</th>
                <th>{t("catalog.metrics.range")}</th>
                <th>{t("catalog.metrics.precision")}</th>
                <th>{t("catalog.metrics.aggDefault")}</th>
                <th>{t("catalog.metrics.builtin")}</th>
                {admin && <th />}
              </tr>
            </thead>
            <tbody>
              {verified.map((m) => (
                <tr key={m.id}>
                  <td className="font-mono">{m.key}</td>
                  <td>{m.displayName}</td>
                  <td>{m.unit ?? "–"}</td>
                  <td>{m.valueType}</td>
                  <td className="font-mono">{range(m)}</td>
                  <td>{m.precision ?? "–"}</td>
                  <td>{m.aggDefault}</td>
                  <td>{m.builtin ? <Badge tone="info">{t("catalog.models.builtinBadge")}</Badge> : ""}</td>
                  {admin && (
                    <td>
                      <ButtonLink to={`?tab=verified&edit=${m.id}`}>{t("common.edit")}</ButtonLink>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          {verified.length === 0 && <EmptyState title={t("catalog.metrics.emptyVerified")} action={admin ? <ButtonLink to="?tab=verified&new=1">{t("catalog.metrics.new")}</ButtonLink> : undefined} />}
        </Card>
      )}
      {tab === "unverified" &&
        (unverified.length === 0 ? (
          <EmptyState title={t("catalog.metrics.emptyUnverified")} body={t("catalog.metrics.emptyUnverifiedBody")} action={<ButtonLink to="?tab=verified">{t("catalog.metrics.tab.verified")}</ButtonLink>} />
        ) : (
          <div className="flex flex-col gap-3">
            {unverified.map((m) => {
              const suggestions = recommendKeys(m.key, standardKeys);
              return (
                <Card key={m.id} title={<span className="font-mono">{m.key}</span>}>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                    <dt className="text-muted">{t("catalog.metrics.firstSeen")}</dt>
                    <dd>
                      {formatDateTime(m.firstSeen?.at, tz, i18n.language)} {m.firstSeen?.deviceId && <span className="font-mono text-muted">#{m.firstSeen.deviceId}</span>}
                    </dd>
                    <dt className="text-muted">{t("catalog.metrics.samples")}</dt>
                    <dd className="font-mono">{(m.sample ?? []).slice(0, 3).map((s) => s.value).join(", ") || "–"}</dd>
                    <dt className="text-muted">{t("catalog.metrics.suggestion")}</dt>
                    <dd>{suggestions.length ? suggestions.map((s) => t("catalog.metrics.suggestionItem", { key: s.key, score: Math.round(s.score * 100) })).join(", ") : t("common.none")}</dd>
                  </dl>
                  {admin && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <ButtonLink to={`?tab=unverified&verify=${m.id}`}>{t("catalog.metrics.verify")}</ButtonLink>
                      <Form method="post" className="flex flex-wrap items-end gap-2">
                        <CsrfField />
                        <input type="hidden" name="intent" value="alias" />
                        <input type="hidden" name="id" value={m.id} />
                        <SelectField label={t("catalog.metrics.aliasTarget")} name="targetKey" defaultValue={suggestions[0]?.key ?? ""}>
                          <option value="">{t("catalog.metrics.chooseTarget")}</option>
                          {standardKeys.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </SelectField>
                        <Checkbox label={t("catalog.metrics.remapHistory")} name="remapHistory" defaultChecked />
                        <Button type="submit">{t("catalog.metrics.aliasTo")}</Button>
                      </Form>
                      <Post intent="ignore" id={m.id} label={t("catalog.metrics.ignore")} confirm={t("catalog.metrics.confirmIgnore")} />
                    </div>
                  )}
                  {result?.intent === "alias" && result.fieldErrors && <Alert tone="danger">{t("catalog.metrics.chooseTarget")}</Alert>}
                </Card>
              );
            })}
          </div>
        ))}
      {tab === "ignored" && (
        <Card>
          {ignored.length === 0 ? (
            <p className="text-muted">{t("catalog.metrics.emptyIgnored")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("catalog.metrics.key")}</th>
                  <th>{t("catalog.metrics.firstSeen")}</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {ignored.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono">{m.key}</td>
                    <td>{formatDateTime(m.firstSeen?.at, tz, i18n.language)}</td>
                    {admin && (
                      <td>
                        <Post intent="restore" id={m.id} label={t("catalog.metrics.restore")} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      {tab === "aliases" && (
        <Card>
          {admin && (
            <Form method="post" className="mb-3 flex flex-wrap items-end gap-2">
              <CsrfField />
              <input type="hidden" name="intent" value="alias-add" />
              <TextField label={t("catalog.metrics.alias")} name="alias" error={result?.intent === "alias-add" && result.fieldErrors?.alias ? t("catalog.validation.metricKey") : undefined} />
              <SelectField label={t("catalog.metrics.aliasTarget")} name="metricKey">
                {standardKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </SelectField>
              <Button type="submit">{t("common.add")}</Button>
            </Form>
          )}
          {aliases.length === 0 ? (
            <p className="text-muted">{t("catalog.metrics.emptyAliases")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("catalog.metrics.alias")}</th>
                  <th>{t("catalog.metrics.aliasTarget")}</th>
                  <th>{t("catalog.metrics.createdAt")}</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {aliases.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono">{a.alias}</td>
                    <td className="font-mono">→ {a.metricKey}</td>
                    <td>{formatDateTime(a.createdAt, tz, i18n.language)}</td>
                    {admin && (
                      <td>
                        <Post intent="alias-delete" id={a.id} label={t("common.delete")} variant="danger" confirm={t("catalog.metrics.confirmAliasDelete")} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
