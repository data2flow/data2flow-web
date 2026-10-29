/**
 * UI-ENE-01 에너지 설정(`/energy/settings?tab=tariffs|factors`, ENE-01.02, UC-ENE-01). 조회 ENE_READ, 변경 ENE_ADMIN(ADMIN·INTEGRATOR).
 * 요금 단가: 범위(조직/사이트), 시작일(끝은 다음 행 시작 전날로 자동), 방식(단일·시간대별), 기본요금. 시간대별은 평일·주말·공휴일이 24시간을 빈틈없이 덮어야 한다.
 * 배출계수: 시작일, 계수(tCO2eq/MWh, 0~2), 출처·기준 연도. 시스템 기본값은 읽기 전용이다.
 * 바꾼 값은 이후 기간부터 적용되고 과거 기간은 다시 계산하지 않는다(BR-ENE-05). 고치기는 지우고 다시 추가한다.
 * API: API-ENE-01, API-ENE-02.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, PageHeader, SelectField, Table, Tabs, TextField } from "~/components/ui";
import {
  DAY_TYPES,
  DEFAULT_BANDS,
  tariffBody,
  touSummary,
  validateFactorForm,
  validateTariffForm,
  type BandInput,
  type DayType,
  type EmissionFactor,
  type Tariff,
  type TariffForm,
} from "~/features/energy/model/settings";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/energy-settings";

export function meta() {
  return [{ title: "data2flow" }];
}

const TABS = ["tariffs", "factors"] as const;
type Tab = (typeof TABS)[number];

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const tab: Tab = url.searchParams.get("tab") === "factors" ? "factors" : "tariffs";
  const [tariffs, factors, spaces] = await Promise.all([
    tab === "tariffs" ? callApi<Tariff[]>(ctx, request, "/api/v1/core/energy/tariffs") : Promise.resolve(null),
    tab === "factors" ? callApi<EmissionFactor[]>(ctx, request, "/api/v1/core/energy/emission-factors") : Promise.resolve(null),
    tab === "tariffs" ? callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces") : Promise.resolve(null),
  ]);
  const failed = [tariffs, factors].find((r) => r && !r.ok);
  return {
    tab,
    tariffs: tariffs?.ok ? tariffs.data : [],
    factors: factors?.ok ? factors.data : [],
    sites: spaces?.ok ? flattenSpaces(spaces.data).filter((s) => s.type === "SITE").map((s) => ({ id: s.id, name: s.name })) : [],
    failed: failed && !failed.ok ? { code: failed.code, message: failed.message } : null,
    idempotencyKey: newIdempotencyKey(),
  };
}

type ActionResult = { fieldErrors?: Record<string, string>; error?: { code: string; message?: string }; values?: Record<string, unknown> };

function readBands(form: FormData): Record<DayType, BandInput[]> {
  const all = (name: string) => form.getAll(name).map((v) => (typeof v === "string" ? v.trim() : ""));
  const bands = {} as Record<DayType, BandInput[]>;
  for (const dayType of DAY_TYPES) {
    const from = all(`${dayType}.from`);
    const to = all(`${dayType}.to`);
    const rate = all(`${dayType}.rate`);
    const label = all(`${dayType}.label`);
    bands[dayType] = from.map((f, i) => ({ from: f, to: to[i] ?? "", rate: rate[i] ?? "", label: label[i] ?? "" }));
  }
  return bands;
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const fail = (result: { code: string; message?: string; status: number }, values?: Record<string, unknown>) =>
    data<ActionResult>({ error: { code: result.code, message: result.message }, values }, { status: result.status });
  if (intent === "deleteTariff" || intent === "deleteFactor") {
    const kind = intent === "deleteTariff" ? "tariffs" : "emission-factors";
    const result = await callApi(ctx, request, `/api/v1/core/energy/${kind}/${encodeURIComponent(field(form, "id"))}`, { method: "DELETE" });
    if (!result.ok) return fail(result);
    throw redirect(intent === "deleteTariff" ? "/energy/settings" : "/energy/settings?tab=factors");
  }
  if (intent === "createTariff") {
    const values: TariffForm = {
      scopeSpaceId: field(form, "scopeSpaceId"),
      validFrom: field(form, "validFrom").trim(),
      mode: field(form, "mode"),
      flatRate: field(form, "flatRate").trim(),
      baseCharge: field(form, "baseCharge").trim(),
      bands: readBands(form),
    };
    const fieldErrors = validateTariffForm(values);
    if (Object.keys(fieldErrors).length) return data<ActionResult>({ fieldErrors, values: { ...values } }, { status: 400 });
    const result = await callApi(ctx, request, "/api/v1/core/energy/tariffs", { method: "POST", body: tariffBody(values), idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
    if (!result.ok) return fail(result, { ...values });
    throw redirect("/energy/settings");
  }
  if (intent === "createFactor") {
    const values = { validFrom: field(form, "validFrom").trim(), factor: field(form, "factor").trim(), sourceTitle: field(form, "sourceTitle"), sourceYear: field(form, "sourceYear").trim() };
    const fieldErrors = validateFactorForm(values);
    if (Object.keys(fieldErrors).length) return data<ActionResult>({ fieldErrors, values }, { status: 400 });
    const result = await callApi(ctx, request, "/api/v1/core/energy/emission-factors", {
      method: "POST",
      body: { validFrom: values.validFrom, factorTco2PerMwh: Number(values.factor), sourceTitle: values.sourceTitle.trim(), sourceYear: Number(values.sourceYear) },
      idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
    });
    if (!result.ok) return fail(result, values);
    throw redirect("/energy/settings?tab=factors");
  }
  return data<ActionResult>({ error: { code: "BAD_REQUEST" } }, { status: 400 });
}

function DeleteButton({ intent, id, label }: { intent: string; id: string; label: string }) {
  return (
    <Form method="post">
      <CsrfField />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit">{label}</Button>
    </Form>
  );
}

const won = (n: number | null | undefined, language: string) => (n == null ? "–" : `${n.toLocaleString(language)}`);

function TariffRate({ tariff }: { tariff: Tariff }) {
  const { t, i18n } = useTranslation();
  if (tariff.mode === "FLAT") return <span>{t("energy.settings.perKwh", { rate: tariff.flatRateKrwPerKwh?.toLocaleString(i18n.language, { minimumFractionDigits: 2 }) })}</span>;
  return (
    <ul className="flex flex-col gap-0.5 text-[12.5px]">
      {touSummary(tariff.touSchedule).map((row) => (
        <li key={`${row.season}-${row.dayType}`}>
          <span className="text-muted">
            {row.season === "ALL" ? "" : `${row.season} · `}
            {t(`energy.settings.dayType.${row.dayType}`)}
          </span>{" "}
          {row.bands.map((b) => `${b.from}–${b.to} ${b.label ? `${b.label} ` : ""}${b.rate}`).join(" · ")}
        </li>
      ))}
    </ul>
  );
}

function BandEditor({ dayType, initial, error }: { dayType: DayType; initial: BandInput[]; error?: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BandInput[]>(initial.length ? initial : DEFAULT_BANDS[dayType]);
  const set = (i: number, key: keyof BandInput, value: string) => setRows((current) => current.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  return (
    <fieldset className="flex flex-col gap-2" data-day-type={dayType}>
      <legend className="mb-1 text-[13px] font-semibold">{t(`energy.settings.dayType.${dayType}`)}</legend>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1.4fr_auto] items-end gap-2">
          <TextField label={t("energy.settings.band.from")} name={`${dayType}.from`} value={row.from} onChange={(e) => set(i, "from", e.target.value)} placeholder="00:00" />
          <TextField label={t("energy.settings.band.to")} name={`${dayType}.to`} value={row.to} onChange={(e) => set(i, "to", e.target.value)} placeholder="24:00" />
          <TextField label={t("energy.settings.band.rate")} name={`${dayType}.rate`} value={row.rate} onChange={(e) => set(i, "rate", e.target.value)} inputMode="decimal" />
          <TextField label={t("energy.settings.band.label")} name={`${dayType}.label`} value={row.label} onChange={(e) => set(i, "label", e.target.value)} maxLength={32} />
          <Button type="button" onClick={() => setRows((current) => current.filter((_, j) => j !== i))} disabled={rows.length === 1}>
            {t("energy.settings.band.remove")}
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" onClick={() => setRows((current) => [...current, { from: current.at(-1)?.to ?? "00:00", to: "24:00", rate: "", label: "" }])}>
          {t("energy.settings.band.add")}
        </Button>
      </div>
      {error && <p className="text-[12px] text-bad-ink">{error}</p>}
    </fieldset>
  );
}

function TariffEditor({ sites, values, errors, idempotencyKey }: { sites: { id: string; name: string }[]; values?: Partial<TariffForm>; errors: Record<string, string>; idempotencyKey: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(values?.mode ?? "FLAT");
  const v = (key: string) => (errors[key] ? t(`energy.settings.validation.${errors[key]}`) : undefined);
  return (
    <Card title={t("energy.settings.addTariff")}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="createTariff" />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t("energy.settings.scope")} name="scopeSpaceId" defaultValue={values?.scopeSpaceId ?? ""}>
            <option value="">{t("energy.settings.scopeOrg")}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t("energy.settings.validFrom")} name="validFrom" type="date" defaultValue={values?.validFrom ?? ""} error={v("validFrom")} required />
          <SelectField label={t("energy.settings.mode")} name="mode" value={mode} onChange={(e) => setMode(e.target.value)} error={v("mode")}>
            <option value="FLAT">{t("energy.settings.modes.FLAT")}</option>
            <option value="TOU">{t("energy.settings.modes.TOU")}</option>
          </SelectField>
          <TextField label={t("energy.settings.baseCharge")} name="baseCharge" defaultValue={values?.baseCharge ?? ""} inputMode="numeric" error={v("baseCharge")} />
        </div>
        {mode === "FLAT" ? (
          <TextField label={t("energy.settings.flatRate")} name="flatRate" defaultValue={values?.flatRate ?? ""} inputMode="decimal" error={v("flatRate")} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[12.5px] text-muted">{t("energy.settings.touHint")}</p>
            {DAY_TYPES.map((dayType) => (
              <BandEditor key={dayType} dayType={dayType} initial={values?.bands?.[dayType] ?? DEFAULT_BANDS[dayType]} error={dayType === "WEEKEND_HOLIDAY" ? v("bands") : undefined} />
            ))}
          </div>
        )}
        <div>
          <Button type="submit" variant="primary">
            {t("energy.settings.add")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

function FactorEditor({ values, errors, idempotencyKey }: { values?: Record<string, unknown>; errors: Record<string, string>; idempotencyKey: string }) {
  const { t } = useTranslation();
  const v = (key: string) => (errors[key] ? t(`energy.settings.validation.${errors[key]}`) : undefined);
  const s = (key: string) => (typeof values?.[key] === "string" ? (values[key] as string) : "");
  return (
    <Card title={t("energy.settings.addFactor")}>
      <Form method="post" className="grid gap-3 sm:grid-cols-2">
        <CsrfField />
        <input type="hidden" name="intent" value="createFactor" />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <TextField label={t("energy.settings.validFrom")} name="validFrom" type="date" defaultValue={s("validFrom")} error={v("validFrom")} required />
        <TextField label={t("energy.settings.factor")} name="factor" defaultValue={s("factor")} inputMode="decimal" error={v("factor")} required />
        <TextField label={t("energy.settings.sourceTitle")} name="sourceTitle" defaultValue={s("sourceTitle")} maxLength={200} error={v("sourceTitle")} required />
        <TextField label={t("energy.settings.sourceYear")} name="sourceYear" defaultValue={s("sourceYear")} inputMode="numeric" error={v("sourceYear")} required />
        <div>
          <Button type="submit" variant="primary">
            {t("energy.settings.add")}
          </Button>
        </div>
      </Form>
    </Card>
  );
}

export default function EnergySettings({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canAdmin = hasAny(root?.me?.permissions, ["ENE_ADMIN"]);
  const { tab, tariffs, factors, sites, failed, idempotencyKey } = loaderData;
  const result = actionData as ActionResult | undefined;
  const errors = result?.fieldErrors ?? {};
  return (
    <>
      <PageHeader title={t("energy.settings.title")} crumb={t("nav.energy")} />
      <Tabs
        current={tab}
        items={TABS.map((key) => ({ key, label: t(`energy.settings.tabs.${key}`), to: key === "tariffs" ? "/energy/settings" : `/energy/settings?tab=${key}` }))}
      />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {failed && <Alert tone="warning">{errorText(t, failed)}</Alert>}
      <div className="mb-3">
        <Alert tone="info">{t("energy.settings.noRecalc")}</Alert>
      </div>
      {tab === "tariffs" ? (
        <div className="flex flex-col gap-4">
          <Card>
            {tariffs.length === 0 ? (
              <EmptyState title={t("energy.settings.noTariffs")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t("energy.settings.scope")}</th>
                    <th>{t("energy.settings.period")}</th>
                    <th>{t("energy.settings.mode")}</th>
                    <th>{t("energy.settings.rate")}</th>
                    <th>{t("energy.settings.baseCharge")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tariffs.map((row) => (
                    <tr key={row.tariffId} data-tariff={row.tariffId}>
                      <td>{row.scopeSpace?.name ?? t("energy.settings.scopeOrg")}</td>
                      <td className="whitespace-nowrap">{t("energy.settings.range", { from: row.validFrom, to: row.validTo ?? "" })}</td>
                      <td>{t(`energy.settings.modes.${row.mode}`)}</td>
                      <td>
                        <TariffRate tariff={row} />
                      </td>
                      <td>{won(row.baseChargeKrwPerMonth, i18n.language)}</td>
                      <td>{canAdmin && <DeleteButton intent="deleteTariff" id={row.tariffId} label={t("energy.settings.delete")} />}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {canAdmin && <TariffEditor sites={sites} values={result?.values as Partial<TariffForm> | undefined} errors={errors} idempotencyKey={idempotencyKey} />}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>{t("energy.settings.period")}</th>
                  <th>{t("energy.settings.factor")}</th>
                  <th>{t("energy.settings.source")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {factors.map((row) => (
                  <tr key={row.emissionFactorId} data-factor={row.emissionFactorId}>
                    <td className="whitespace-nowrap">{t("energy.settings.range", { from: row.validFrom, to: row.validTo ?? "" })}</td>
                    <td>{t("energy.settings.factorValue", { value: row.factorTco2PerMwh })}</td>
                    <td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {row.system && <Badge tone="neutral">{t("energy.settings.systemDefault")}</Badge>}
                        {t("energy.settings.sourceOf", { title: row.sourceTitle, year: row.sourceYear })}
                      </span>
                    </td>
                    <td>{canAdmin && !row.system && <DeleteButton intent="deleteFactor" id={row.emissionFactorId} label={t("energy.settings.delete")} />}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          {canAdmin && <FactorEditor values={result?.values} errors={errors} idempotencyKey={idempotencyKey} />}
        </div>
      )}
    </>
  );
}
