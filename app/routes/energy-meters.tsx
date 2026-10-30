/**
 * UI-ENE-02 계량 설정·고지서 입력(`/energy/meters?spaceId=&year=`, ENE-01.01, UC-ENE-02). 조회 ENE_READ, 변경 ENE_ADMIN(ADMIN·INTEGRATOR).
 * 공간 트리(연결 원천 수 배지)에서 공간을 고르면 그 공간의 원천 목록(측정·추정, 상위 계량 여부, 최근 수신)과 추가 양식을 보여 준다.
 * 측정: 모델에 energy(누적 kWh)·power(W)가 있는 기기(power는 적분해 kWh로 계산한다, BR-ENE-03). 추정: 장비 정격·대기 전력(BR-ENE-04).
 * 같은 공간에 측정과 추정이 함께 있으면 합계에는 측정을 쓰고 추정은 비교용이다(BR-ENE-01).
 * 고지서(사이트·건물): 월·kWh·금액. 같은 달이 있으면 덮어쓸지 묻는다(409 ENE_BILL_DUPLICATE). 측정 합계와 차이는 일 집계가 생긴 뒤 보인다.
 * API: API-ENE-04, API-ENE-05.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, Checkbox, CountBadge, CsrfField, EmptyState, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { percent, validateBillForm, type Bill, type EnergySource, type SourceCandidate } from "~/features/energy/model/settings";
import { errorText } from "~/lib/error-text";
import { formatDateTime, resolveTimezone } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/energy-meters";

export function meta() {
  return [{ title: "data2flow" }];
}

const BILL_TYPES = ["SITE", "BUILDING"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const spacesResult = await callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces");
  const spaces = spacesResult.ok ? flattenSpaces(spacesResult.data) : [];
  const spaceId = url.searchParams.get("spaceId") ?? spaces[0]?.id ?? null;
  const selected = spaces.find((s) => s.id === spaceId) ?? null;
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const billable = !!selected && BILL_TYPES.includes(String(selected.type));
  const q = (path: string) => `${path}${path.includes("?") ? "&" : "?"}spaceId=${encodeURIComponent(spaceId ?? "")}`;
  const [all, candidates, devices, bills] = await Promise.all([
    callApi<EnergySource[]>(ctx, request, "/api/v1/core/energy/sources"),
    selected ? callApi<SourceCandidate[]>(ctx, request, q("/api/v1/core/energy/sources/candidates")) : Promise.resolve(null),
    selected ? callList<{ id: string; name: string }>(ctx, request, q("/api/v1/core/devices?status=ACTIVE&size=100")) : Promise.resolve(null),
    billable ? callList<Bill>(ctx, request, q(`/api/v1/core/energy/bills?year=${year}&size=12`)) : Promise.resolve(null),
  ]);
  const sources = all.ok ? all.data : [];
  return {
    spaces: spaces.map((s) => ({ id: s.id, name: s.name, type: String(s.type), depth: s.depth, count: sources.filter((x) => x.space.id === s.id).length })),
    spacesFailed: !spacesResult.ok,
    selected: selected ? { id: selected.id, name: selected.name, type: String(selected.type) } : null,
    sources: sources.filter((s) => s.space.id === spaceId),
    failed: all.ok ? null : { code: all.code, message: all.message },
    candidates: candidates?.ok ? candidates.data : [],
    devices: devices?.ok ? devices.list.responses : [],
    billable,
    bills: bills?.ok ? bills.list.responses : [],
    year,
    idempotencyKey: newIdempotencyKey(),
  };
}

type ActionResult = {
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, string>;
  /** 같은 달 고지서가 있어 덮어쓸지 물어야 한다 */
  confirmOverwrite?: { month: string; kwh: string; amountKrw: string };
  values?: Record<string, string>;
};

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const form = await request.formData();
  const intent = field(form, "intent");
  const spaceId = field(form, "spaceId");
  const back = `/energy/meters?spaceId=${encodeURIComponent(spaceId)}${url.searchParams.get("year") ? `&year=${url.searchParams.get("year")}` : ""}`;
  const fail = (result: { code: string; message?: string; status: number }, extra: ActionResult = {}) =>
    data<ActionResult>({ error: { code: result.code, message: result.message }, ...extra }, { status: result.status });

  if (intent === "addMetered" || intent === "addEstimated") {
    const metered = intent === "addMetered";
    const [deviceId, metricKey] = metered ? field(form, "meter").split("|") : [field(form, "deviceId"), ""];
    if (!deviceId) return data<ActionResult>({ fieldErrors: { [metered ? "meter" : "deviceId"]: "deviceRequired" } }, { status: 400 });
    const rated = field(form, "ratedPowerW").trim();
    if (!metered && !/^\d+$/.test(rated)) return data<ActionResult>({ fieldErrors: { ratedPowerW: "powerRequired" } }, { status: 400 });
    const standby = field(form, "standbyPowerW").trim();
    const body = metered
      ? { spaceId, kind: "METERED", deviceId, metricKey, coversDescendants: field(form, "coversDescendants") === "true" }
      : { spaceId, kind: "ESTIMATED", deviceId, ratedPowerW: Number(rated), standbyPowerW: standby ? Number(standby) : null };
    const result = await callApi(ctx, request, "/api/v1/core/energy/sources", { method: "POST", body, idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
    if (!result.ok) return fail(result);
    throw redirect(back);
  }
  if (intent === "deleteSource") {
    const result = await callApi(ctx, request, `/api/v1/core/energy/sources/${encodeURIComponent(field(form, "sourceId"))}`, { method: "DELETE" });
    if (!result.ok) return fail(result);
    throw redirect(back);
  }
  if (intent === "putBill") {
    const values = { month: field(form, "month").trim(), kwh: field(form, "kwh").trim(), amountKrw: field(form, "amountKrw").trim() };
    const fieldErrors = validateBillForm(values);
    if (Object.keys(fieldErrors).length) return data<ActionResult>({ fieldErrors, values }, { status: 400 });
    const result = await callApi(ctx, request, `/api/v1/core/energy/bills/${encodeURIComponent(spaceId)}/${values.month}`, {
      method: "PUT",
      body: { kwh: Number(values.kwh), amountKrw: values.amountKrw ? Number(values.amountKrw) : null, overwrite: field(form, "overwrite") === "true" },
    });
    if (!result.ok && result.code === "ENE_BILL_DUPLICATE") return data<ActionResult>({ confirmOverwrite: values, values }, { status: 409 });
    if (!result.ok) return fail(result, { values });
    throw redirect(back);
  }
  if (intent === "deleteBill") {
    const result = await callApi(ctx, request, `/api/v1/core/energy/bills/${encodeURIComponent(spaceId)}/${encodeURIComponent(field(form, "month"))}`, { method: "DELETE" });
    if (!result.ok) return fail(result);
    throw redirect(back);
  }
  return data<ActionResult>({ error: { code: "BAD_REQUEST" } }, { status: 400 });
}

function Hidden({ intent, spaceId }: { intent: string; spaceId: string }) {
  return (
    <>
      <CsrfField />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="spaceId" value={spaceId} />
    </>
  );
}

function SourceStatus({ source }: { source: EnergySource }) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const tone = source.status === "OK" ? "success" : source.status === "NO_DATA" ? "warning" : "neutral";
  return (
    <span className="flex flex-col">
      <Badge tone={tone}>{t(`energy.meters.status.${source.status}`)}</Badge>
      {source.lastValueAt && <span className="text-[12px] text-muted">{formatDateTime(source.lastValueAt, resolveTimezone(root?.timezone), i18n.language)}</span>}
    </span>
  );
}

export default function EnergyMeters({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canAdmin = hasAny(root?.me?.permissions, ["ENE_ADMIN"]);
  const { spaces, spacesFailed, selected, sources, failed, candidates, devices, billable, bills, year, idempotencyKey } = loaderData;
  const result = actionData as ActionResult | undefined;
  const errors = result?.fieldErrors ?? {};
  const v = (key: string) => (errors[key] ? t(`energy.meters.validation.${errors[key]}`) : undefined);
  const hasMetered = sources.some((s) => s.kind === "METERED" && s.enabled);
  const hasEstimated = sources.some((s) => s.kind === "ESTIMATED" && s.enabled);
  const meterOptions = candidates.flatMap((c) => c.metricKeys.filter((m) => !c.linkedMetricKeys.includes(m)).map((m) => ({ value: `${c.device.id}|${m}`, label: `${c.device.name} · ${m} (${c.space.name})`, metric: m })));
  const qs = (extra: string) => `/energy/meters?spaceId=${selected?.id ?? ""}${extra}`;
  return (
    <>
      <PageHeader title={t("energy.meters.title")} crumb={t("nav.energy")} />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {(failed || spacesFailed) && <Alert tone="warning">{errorText(t, failed ?? { code: "SERVICE_UNAVAILABLE" })}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card title={t("energy.meters.spaces")}>
          {spaces.length === 0 ? (
            <EmptyState title={t("energy.meters.noSpaces")} />
          ) : (
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {spaces.map((s) => (
                <li key={s.id} style={{ paddingLeft: `${(s.depth - 1) * 12}px` }}>
                  <Link to={`/energy/meters?spaceId=${s.id}`} aria-current={s.id === selected?.id ? "page" : undefined} className={s.id === selected?.id ? "font-semibold text-accent" : "hover:underline"}>
                    {s.name}
                  </Link>{" "}
                  {s.count > 0 && <CountBadge n={s.count} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {selected && (
          <div className="flex flex-col gap-4">
            <Card title={t("energy.meters.sourcesOf", { name: selected.name })}>
              {hasMetered && hasEstimated && (
                <div className="mb-3">
                  <Alert tone="info">{t("energy.meters.meteredFirst")}</Alert>
                </div>
              )}
              {sources.length === 0 ? (
                <EmptyState title={t("energy.meters.noSources")} body={t("energy.meters.noSourcesBody")} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>{t("energy.meters.col.kind")}</th>
                      <th>{t("energy.meters.col.target")}</th>
                      <th>{t("energy.meters.col.scope")}</th>
                      <th>{t("energy.meters.col.status")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.sourceId} data-source={s.sourceId}>
                        <td>
                          <Badge tone={s.kind === "METERED" ? "info" : "neutral"}>{t(`energy.meters.kind.${s.kind}`)}</Badge>
                        </td>
                        <td>
                          <Link className="text-accent hover:underline" to={`/devices/${s.device.id}`}>
                            {s.device.name}
                          </Link>
                          <div className="text-[12px] text-muted">
                            {s.kind === "METERED"
                              ? t(s.cumulative ? "energy.meters.cumulative" : "energy.meters.instant", { metric: s.metricKey })
                              : t("energy.meters.rated", { rated: s.ratedPowerW, standby: s.standbyPowerW ?? 0 })}
                          </div>
                          {s.kind === "METERED" && s.metricKey === "power" && <div className="text-[12px] text-muted">{t("energy.meters.integrated")}</div>}
                        </td>
                        <td>{s.coversDescendants ? t("energy.meters.coversDescendants") : t("energy.meters.thisSpace")}</td>
                        <td>
                          <SourceStatus source={s} />
                        </td>
                        <td>
                          {canAdmin && (
                            <Form method="post">
                              <Hidden intent="deleteSource" spaceId={selected.id} />
                              <input type="hidden" name="sourceId" value={s.sourceId} />
                              <Button type="submit">{t("energy.meters.remove")}</Button>
                            </Form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
            {canAdmin && (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title={t("energy.meters.addMetered")}>
                  {meterOptions.length === 0 ? (
                    <p className="text-[12.5px] text-muted">{t("energy.meters.noCandidates")}</p>
                  ) : (
                    <Form method="post" className="flex flex-col gap-3">
                      <Hidden intent="addMetered" spaceId={selected.id} />
                      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
                      <SelectField label={t("energy.meters.meter")} name="meter" error={v("meter")}>
                        {meterOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </SelectField>
                      <p className="text-[12px] text-muted">{t("energy.meters.autoDetect")}</p>
                      <Checkbox label={t("energy.meters.coversDescendantsLabel")} name="coversDescendants" value="true" />
                      <div>
                        <Button type="submit" variant="primary">
                          {t("energy.meters.add")}
                        </Button>
                      </div>
                    </Form>
                  )}
                </Card>
                <Card title={t("energy.meters.addEstimated")}>
                  <Form method="post" className="flex flex-col gap-3">
                    <Hidden intent="addEstimated" spaceId={selected.id} />
                    <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
                    <SelectField label={t("energy.meters.equipment")} name="deviceId" error={v("deviceId")}>
                      <option value="">{t("energy.meters.choose")}</option>
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </SelectField>
                    <TextField label={t("energy.meters.ratedPowerW")} name="ratedPowerW" inputMode="numeric" error={v("ratedPowerW")} required />
                    <TextField label={t("energy.meters.standbyPowerW")} name="standbyPowerW" inputMode="numeric" />
                    <div>
                      <Button type="submit" variant="primary">
                        {t("energy.meters.add")}
                      </Button>
                    </div>
                  </Form>
                </Card>
              </div>
            )}
            {billable ? (
              <Card
                title={t("energy.meters.bills", { year })}
                actions={
                  <span className="flex gap-2 text-[13px]">
                    <Link className="text-accent hover:underline" to={qs(`&year=${year - 1}`)}>
                      {t("energy.meters.prevYear")}
                    </Link>
                    <Link className="text-accent hover:underline" to={qs(`&year=${year + 1}`)}>
                      {t("energy.meters.nextYear")}
                    </Link>
                  </span>
                }
              >
                {bills.length === 0 ? (
                  <EmptyState title={t("energy.meters.noBills")} />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <th>{t("energy.meters.col.month")}</th>
                        <th>{t("energy.meters.col.billKwh")}</th>
                        <th>{t("energy.meters.col.amount")}</th>
                        <th>{t("energy.meters.col.meteredKwh")}</th>
                        <th>{t("energy.meters.col.diff")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map((b) => (
                        <tr key={b.billId} data-bill={b.month}>
                          <td>{b.month}</td>
                          <td>{b.kwh.toLocaleString(i18n.language)}</td>
                          <td>{b.amountKrw == null ? "–" : b.amountKrw.toLocaleString(i18n.language)}</td>
                          <td>{b.meteredKwh == null ? "–" : b.meteredKwh.toLocaleString(i18n.language)}</td>
                          <td>{b.diffRatio == null ? <span className="text-muted">{t("energy.meters.noMetered")}</span> : t("energy.meters.diff", { value: percent(b.diffRatio) })}</td>
                          <td>
                            {canAdmin && (
                              <Form method="post">
                                <Hidden intent="deleteBill" spaceId={selected.id} />
                                <input type="hidden" name="month" value={b.month} />
                                <Button type="submit">{t("energy.meters.remove")}</Button>
                              </Form>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                {canAdmin && (
                  <div className="mt-4 border-t border-line pt-4">
                    {result?.confirmOverwrite ? (
                      <Form method="post" className="flex flex-col gap-2" role="alertdialog">
                        <Hidden intent="putBill" spaceId={selected.id} />
                        <input type="hidden" name="overwrite" value="true" />
                        <input type="hidden" name="month" value={result.confirmOverwrite.month} />
                        <input type="hidden" name="kwh" value={result.confirmOverwrite.kwh} />
                        <input type="hidden" name="amountKrw" value={result.confirmOverwrite.amountKrw} />
                        <Alert tone="warning">{t("energy.meters.overwriteConfirm", { month: result.confirmOverwrite.month })}</Alert>
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary">
                            {t("energy.meters.overwrite")}
                          </Button>
                          <Link className="self-center text-[13px] text-accent hover:underline" to={qs(`&year=${year}`)}>
                            {t("energy.meters.cancel")}
                          </Link>
                        </div>
                      </Form>
                    ) : (
                      <Form method="post" className="grid gap-3 sm:grid-cols-4 sm:items-end">
                        <Hidden intent="putBill" spaceId={selected.id} />
                        <TextField label={t("energy.meters.col.month")} name="month" type="month" defaultValue={result?.values?.month ?? ""} error={v("month")} required />
                        <TextField label={t("energy.meters.col.billKwh")} name="kwh" inputMode="decimal" defaultValue={result?.values?.kwh ?? ""} error={v("kwh")} required />
                        <TextField label={t("energy.meters.col.amount")} name="amountKrw" inputMode="numeric" defaultValue={result?.values?.amountKrw ?? ""} error={v("amountKrw")} />
                        <div>
                          <Button type="submit" variant="primary">
                            {t("energy.meters.saveBill")}
                          </Button>
                        </div>
                      </Form>
                    )}
                  </div>
                )}
              </Card>
            ) : (
              <p className="text-[12.5px] text-muted">{t("energy.meters.billsSiteOnly")}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
