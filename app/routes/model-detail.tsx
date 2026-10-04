/**
 * UI-DEV-08 기기 모델 상세(DEV-03.01, DEV-07.05): 정보·측정 항목·기능·패키지·기기 탭.
 * 기본 제공 모델은 전체 읽기 전용 + [복제](BR-DEV-14). 쓰는 기기가 있으면 삭제 대신 사용 중지(BR-DEV-15).
 * API: 조회 API-DEV-46(`?code=`), 수정 API-DEV-41(baseVersion), 패키지 API-DEV-42, 사용 중지·삭제 API-DEV-43, 복제 API-DEV-47
 * DEV-03.03 제어 드라이버 연결(M3): 드라이버 목록 API-ACT-30, 연결 API-ACT-31 `PUT /device-models/{id}/driver`(DRIVER_MANAGE).
 * 모델 기능을 드라이버가 지원하지 않으면 연결 전에 거부하고 "이 드라이버는 {기능}을 지원하지 않습니다"를 보여 준다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { getMe } from "~/bff/user.server";
import { Alert, Badge, Button, ButtonLink, Card, CsrfField, Dialog, PageHeader, SelectField, Table, Tabs, TextField } from "~/components/ui";
import { AttributeSchemaEditor } from "~/features/catalog/components/attribute-schema-editor";
import { ModelFields } from "~/features/catalog/components/model-fields";
import { MODEL_CODE_PATTERN, checkModelInput, modelBody, parseAttributeSchema, parseList, readModelForm } from "~/features/catalog/model/catalog";
import type { DeviceLite, MetricRow, ModelDetail, ModelSummary, ScriptLite } from "~/features/catalog/model/types";
import { can, failed, invalid, outcome, type CatalogActionResult } from "~/features/catalog/server";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { errorText } from "~/lib/error-text";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/model-detail";

const TABS = ["info", "metrics", "capabilities", "package", "devices"] as const;
type Tab = (typeof TABS)[number];

export function meta() {
  return [{ title: "data2flow" }];
}

async function findModel(ctx: ReturnType<typeof bff>, request: Request, code: string): Promise<ModelDetail> {
  const list = listOrThrow(await callList<ModelSummary>(ctx, request, `/api/v1/core/device-models?code=${encodeURIComponent(code)}&includeDeprecated=true`));
  const hit = list.responses.find((m) => m.code === code);
  if (!hit) throw data({ code: "RESOURCE_NOT_FOUND" }, { status: 404 });
  return orThrow(await callApi<ModelDetail>(ctx, request, `/api/v1/core/device-models/${encodeURIComponent(hit.id)}`));
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "info";
  const model = await findModel(ctx, request, params.modelCode);
  const [metrics, decode, transform, devices] = await Promise.all([
    tab === "metrics" ? callList<MetricRow>(ctx, request, "/api/v1/core/metrics?status=VERIFIED&size=100") : null,
    tab === "package" ? callList<ScriptLite>(ctx, request, "/api/v1/core/scripts?kind=DECODE&size=100") : null,
    tab === "package" ? callList<ScriptLite>(ctx, request, "/api/v1/core/scripts?kind=TRANSFORM&size=100") : null,
    tab === "devices" ? callList<DeviceLite>(ctx, request, `/api/v1/core/devices?modelId=${encodeURIComponent(model.id)}&size=50`) : null,
  ]);
  // 드라이버 목록·상세(API-ACT-30)는 DRIVER_MANAGE(ADMIN·INTEGRATOR)만: 권한이 없으면 부르지 않고 현재 연결만 읽기 전용으로 보여 준다
  const me = tab === "package" ? await getMe(ctx, request) : null;
  const canManageDrivers = Boolean(me?.ok && hasAny(me.data.permissions, ["DRIVER_MANAGE"]));
  const drivers = canManageDrivers ? await callList<DriverRow>(ctx, request, "/api/v1/core/drivers?size=100") : null;
  return {
    tab,
    model,
    metrics: metrics?.ok ? metrics.list.responses : [],
    decodeScripts: decode?.ok ? decode.list.responses : [],
    transformScripts: transform?.ok ? transform.list.responses : [],
    scriptsUnavailable: tab === "package" && !(decode?.ok && transform?.ok),
    devices: devices?.ok ? devices.list.responses : [],
    devicesTotal: devices?.ok ? (devices.list.totalCount ?? devices.list.responses.length) : 0,
    drivers: drivers?.ok ? drivers.list.responses : null,
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const model = await findModel(ctx, request, params.modelCode);
  const base = `/api/v1/core/device-models/${encodeURIComponent(model.id)}`;
  const baseVersion = Number(field(form, "baseVersion"));
  const done = (result: Parameters<typeof outcome>[1]) => outcome(intent, result);
  switch (intent) {
    case "info": {
      const input = readModelForm(form);
      input.metrics = (model.metrics ?? []).map((m) => m.key);
      const errors = checkModelInput(input, { creating: false });
      if (Object.keys(errors).length) return invalid(intent, errors);
      const { metrics: _m, ...body } = modelBody(input, false);
      void _m;
      return done(await callApi(ctx, request, base, { method: "PATCH", body: { ...body, baseVersion } }));
    }
    case "metrics": {
      const keys = form.getAll("metrics").map(String);
      const required = new Set(form.getAll("requiredMetrics").map(String));
      if (model.kind === "SENSOR" && keys.length === 0) return invalid(intent, { metrics: "sensorMetric" });
      return done(await callApi(ctx, request, base, { method: "PATCH", body: { metrics: keys.map((key) => ({ key, required: required.has(key) })), baseVersion } }));
    }
    case "capabilities": {
      const capabilities = parseList(field(form, "capabilities")).map((capability) => ({ capability, constraints: null }));
      return done(await callApi(ctx, request, base, { method: "PATCH", body: { capabilities, baseVersion } }));
    }
    case "package": {
      const schema = parseAttributeSchema(field(form, "attributeSchema"));
      if (!schema.ok) return invalid(intent, { attributeSchema: schema.error });
      const body = {
        decodeScriptId: field(form, "decodeScriptId") || null,
        transformScriptId: field(form, "transformScriptId") || null,
        driverKey: field(form, "driverKey") || null,
        defaultDashboardId: model.package?.defaultDashboardId ?? null,
        defaultRuleTemplateIds: model.package?.defaultRuleTemplateIds ?? [],
        attributeSchema: schema.schema,
      };
      return done(await callApi(ctx, request, `${base}/package`, { method: "PUT", body }));
    }
    case "driver": {
      // DEV-03.03: 연결 전에 드라이버가 모델 기능을 모두 지원하는지 확인한다(API-ACT-30 상세의 capabilities)
      const driverId = field(form, "driverId") || null;
      if (driverId) {
        const driver = await callApi<{ capabilities?: string[] }>(ctx, request, `/api/v1/core/drivers/${encodeURIComponent(driverId)}`);
        if (!driver.ok) return failed(intent, driver);
        const missing = missingCapabilities(model.capabilities, driver.data.capabilities);
        if (missing.length) return data<CatalogActionResult>({ intent, error: { code: "DRIVER_CAPABILITY_MISMATCH", message: missing.join(", ") } }, { status: 400 });
      }
      const result = await callApi(ctx, request, `${base}/driver`, { method: "PUT", body: { driverId } });
      if (!result.ok && result.code === "DRIVER_CAPABILITY_MISMATCH") return data<CatalogActionResult>({ intent, error: { code: result.code, message: (result.errors ?? []).map((e) => e.message).join(", ") } }, { status: 400 });
      return done(result);
    }
    case "clone": {
      const newCode = field(form, "newCode").trim();
      if (!MODEL_CODE_PATTERN.test(newCode)) return invalid(intent, { newCode: "modelCode" });
      const result = await callApi<ModelDetail>(ctx, request, `${base}/clone`, { method: "POST", body: { newCode, name: field(form, "name").trim() || model.name }, idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
      if (!result.ok) return failed(intent, result);
      throw redirect(`/models/${encodeURIComponent(result.data.code)}`);
    }
    case "deprecate":
      return done(await callApi(ctx, request, `${base}/deprecate`, { method: "POST" }));
    case "delete": {
      const result = await callApi(ctx, request, base, { method: "DELETE" });
      if (result.ok) throw redirect("/models");
      return failed(intent, result);
    }
    default:
      return data({ intent, error: { code: "INVALID_REQUEST" } } as CatalogActionResult, { status: 400 });
  }
}

interface DriverRow {
  driverId: string;
  name: string;
  type: string;
  status?: string;
}

/** 모델 기능 중 드라이버가 지원하지 않는 것(DEV-03.03) */
function missingCapabilities(model: ModelDetail["capabilities"], driver: string[] | undefined): string[] {
  const supported = new Set(driver ?? []);
  return (model ?? []).map((c) => c.capability).filter((c) => !supported.has(c));
}

function Hidden({ intent, version }: { intent: string; version: number }) {
  return (
    <>
      <CsrfField />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="baseVersion" value={version} />
    </>
  );
}

export default function ModelDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const { tab, model, metrics, decodeScripts, transformScripts, scriptsUnavailable, devices, devicesTotal, drivers, idempotencyKey } = loaderData;
  const currentDriverId = (model.package as { driverId?: string | null } | null | undefined)?.driverId ?? null;
  const admin = can(root?.me?.permissions, "DEV_ADMIN");
  const editable = admin && !model.builtin;
  const result = actionData as CatalogActionResult | undefined;
  const [cloneOpen, setCloneOpen] = useState(result?.intent === "clone");
  const fieldErr = (key: string) => (result?.fieldErrors?.[key] ? t(`catalog.validation.${result.fieldErrors[key]}`) : undefined);
  const base = `/models/${encodeURIComponent(model.code)}`;
  const modelMetrics = new Map((model.metrics ?? []).map((m) => [m.key, m.required]));
  const schemaText = (() => {
    const schema = model.package?.attributeSchema ?? model.attributeSchema;
    return schema ? JSON.stringify(schema, null, 2) : "";
  })();
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/models" className="hover:underline">
            {t("catalog.models.title")}
          </Link>
        }
        title={`${model.name} (${model.code})`}
        actions={
          <>
            {model.builtin && <Badge tone="info">{t("catalog.models.builtinBadge")}</Badge>}
            {model.status === "DEPRECATED" && <Badge tone="neutral">DEPRECATED</Badge>}
            {admin && <Button onClick={() => setCloneOpen(true)}>{t("catalog.models.clone")}</Button>}
            {editable && model.status !== "DEPRECATED" && (
              <Form method="post" onSubmit={(e) => !window.confirm(t("catalog.models.confirmDeprecate")) && e.preventDefault()}>
                <Hidden intent="deprecate" version={model.version} />
                <Button type="submit">{t("catalog.models.deprecate")}</Button>
              </Form>
            )}
            {editable && (
              <Form method="post" onSubmit={(e) => !window.confirm(t("catalog.models.confirmDelete")) && e.preventDefault()}>
                <Hidden intent="delete" version={model.version} />
                <Button type="submit" variant="danger">
                  {t("common.delete")}
                </Button>
              </Form>
            )}
          </>
        }
      />
      <DeviceAreaTabs current="models" />
      {model.builtin && (
        <div className="mb-3">
          <Alert tone="info">{t("catalog.models.builtinReadonly")}</Alert>
        </div>
      )}
      {result?.done && (
        <div className="mb-3">
          <Alert tone="success">{t("common.saved")}</Alert>
        </div>
      )}
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">
            {errorText(t, result.error)}
            {result.error.code === "MODEL_IN_USE" && ` ${t("catalog.models.inUseHint")}`}
          </Alert>
        </div>
      )}
      <Dialog
        title={t("catalog.models.clone")}
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
      >
        <Form method="post" className="flex flex-col gap-3">
          <Hidden intent="clone" version={model.version} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <TextField label={t("catalog.models.newCode")} name="newCode" defaultValue={`${model.code}-COPY`} error={fieldErr("newCode")} hint={t("catalog.models.codeHint")} />
          <TextField label={t("catalog.models.name")} name="name" defaultValue={model.name} />
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t("catalog.models.clone")}
            </Button>
          </div>
        </Form>
      </Dialog>
      <Tabs current={tab} items={TABS.map((key) => ({ key, label: t(`catalog.models.tab.${key}`), to: `${base}?tab=${key}` }))} />
      {tab === "info" && (
        <Card>
          <Form method="post" className="flex flex-col gap-3">
            <Hidden intent="info" version={model.version} />
            <p className="text-[12.5px] text-muted">
              {t("catalog.models.code")}: <span className="font-mono">{model.code}</span>
            </p>
            <fieldset disabled={!editable} className="contents">
              <ModelFields model={model} metrics={[]} creating={false} fieldErrors={result?.intent === "info" ? result.fieldErrors : undefined} />
            </fieldset>
            {editable && (
              <div className="flex justify-end">
                <Button type="submit" variant="primary">
                  {t("common.save")}
                </Button>
              </div>
            )}
          </Form>
        </Card>
      )}
      {tab === "metrics" && (
        <Card>
          <Form method="post" className="flex flex-col gap-3">
            <Hidden intent="metrics" version={model.version} />
            <Table>
              <thead>
                <tr>
                  <th>{t("catalog.metrics.key")}</th>
                  <th>{t("catalog.metrics.displayName")}</th>
                  <th>{t("catalog.metrics.unit")}</th>
                  <th>{t("catalog.required")}</th>
                  {editable && <th>{t("catalog.models.include")}</th>}
                </tr>
              </thead>
              <tbody>
                {(editable ? metrics.filter((m) => modelMetrics.has(m.key)).concat(metrics.filter((m) => !modelMetrics.has(m.key))) : metrics.filter((m) => modelMetrics.has(m.key))).map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono">{m.key}</td>
                    <td>{m.displayName}</td>
                    <td>{m.unit ?? "–"}</td>
                    <td>
                      <input type="checkbox" name="requiredMetrics" value={m.key} defaultChecked={modelMetrics.get(m.key) ?? true} disabled={!editable} aria-label={t("catalog.models.requiredOf", { key: m.key })} />
                    </td>
                    {editable && (
                      <td>
                        <input type="checkbox" name="metrics" value={m.key} defaultChecked={modelMetrics.has(m.key)} aria-label={t("catalog.models.includeOf", { key: m.key })} />
                      </td>
                    )}
                  </tr>
                ))}
                {[...modelMetrics.keys()]
                  .filter((key) => !metrics.some((m) => m.key === key))
                  .map((key) => (
                    <tr key={key}>
                      <td className="font-mono">{key}</td>
                      <td colSpan={editable ? 4 : 3} className="text-muted">
                        {t("catalog.models.metricMissing")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </Table>
            {fieldErr("metrics") && <Alert tone="danger">{fieldErr("metrics")}</Alert>}
            {editable && (
              <div className="flex justify-end">
                <Button type="submit" variant="primary">
                  {t("common.save")}
                </Button>
              </div>
            )}
          </Form>
        </Card>
      )}
      {tab === "capabilities" && (
        <Card>
          <Form method="post" className="flex flex-col gap-3">
            <Hidden intent="capabilities" version={model.version} />
            <ul className="flex flex-wrap gap-2">
              {(model.capabilities ?? []).length === 0 && <li className="text-[12.5px] text-muted">{t("common.none")}</li>}
              {(model.capabilities ?? []).map((c) => (
                <li key={c.capability}>
                  <Badge tone="neutral">{c.capability}</Badge>
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-muted">{t("catalog.models.capabilitiesHint")}</p>
            {editable && (
              <>
                <TextField label={t("catalog.models.capabilities")} name="capabilities" defaultValue={(model.capabilities ?? []).map((c) => c.capability).join(", ")} />
                <div className="flex justify-end">
                  <Button type="submit" variant="primary">
                    {t("common.save")}
                  </Button>
                </div>
              </>
            )}
          </Form>
        </Card>
      )}
      {tab === "package" && (
        <Card>
          <Form method="post" className="flex flex-col gap-4">
            <Hidden intent="package" version={model.version} />
            {scriptsUnavailable && <Alert tone="warning">{t("catalog.package.scriptsUnavailable")}</Alert>}
            <div className="grid gap-3 md:grid-cols-3">
              <SelectField label={t("catalog.package.decode")} name="decodeScriptId" defaultValue={model.package?.decodeScriptId ?? ""} disabled={!editable}>
                <option value="">{t("common.none")}</option>
                {decodeScripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
              <SelectField label={t("catalog.package.transform")} name="transformScriptId" defaultValue={model.package?.transformScriptId ?? ""} disabled={!editable}>
                <option value="">{t("common.none")}</option>
                {transformScripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
              <input type="hidden" name="driverKey" value={model.package?.driverKey ?? ""} />
            </div>
            {(model.package?.decodeScriptId || model.package?.transformScriptId) && (
              <p className="text-[12.5px]">
                {model.package?.decodeScriptId && (
                  <Link className="text-accent hover:underline" to={`/scripts/${model.package.decodeScriptId}`}>
                    {t("catalog.package.openEditor")} (DECODE)
                  </Link>
                )}{" "}
                {model.package?.transformScriptId && (
                  <Link className="text-accent hover:underline" to={`/scripts/${model.package.transformScriptId}`}>
                    {t("catalog.package.openEditor")} (TRANSFORM)
                  </Link>
                )}
              </p>
            )}
            {fieldErr("attributeSchema") && <Alert tone="danger">{t(`catalog.package.schemaError.${result?.fieldErrors?.attributeSchema}`, { detail: "" })}</Alert>}
            <AttributeSchemaEditor initial={schemaText} readOnly={!editable} />
            {editable && (
              <div className="flex justify-end">
                <Button type="submit" variant="primary">
                  {t("common.save")}
                </Button>
              </div>
            )}
          </Form>
        </Card>
      )}
      {tab === "package" && (
        <Card title={t("catalog.package.driver")} className="mt-4">
          {result?.intent === "driver" && result.error && (
            <Alert tone="danger">{result.error.code === "DRIVER_CAPABILITY_MISMATCH" ? t("catalog.package.driverMismatch", { capability: result.error.message ?? "" }) : errorText(t, result.error)}</Alert>
          )}
          {result?.intent === "driver" && result.done && <Alert tone="success">{t("catalog.package.driverConnected")}</Alert>}
          {drivers ? (
            <Form method="post" className="mt-2 flex flex-wrap items-end gap-2">
              <Hidden intent="driver" version={model.version} />
              <SelectField label={t("catalog.package.driver")} name="driverId" defaultValue={currentDriverId ?? ""}>
                <option value="">{t("common.none")}</option>
                {drivers.map((d) => (
                  <option key={d.driverId} value={d.driverId}>
                    {`${d.name} (${d.type})`}
                  </option>
                ))}
              </SelectField>
              <Button type="submit" variant="primary">
                {t("catalog.package.driverConnect")}
              </Button>
              <p className="w-full text-[12.5px] text-muted">{t("catalog.package.driverHint")}</p>
            </Form>
          ) : (
            <p className="text-[13px]">
              {currentDriverId ? t("catalog.package.driverCurrent", { id: currentDriverId }) : t("catalog.package.driverNone")} <span className="text-muted">{t("catalog.package.driverManageOnly")}</span>
            </p>
          )}
        </Card>
      )}
      {tab === "devices" && (
        <Card actions={<ButtonLink to={`/devices?modelId=${encodeURIComponent(model.id)}`}>{t("catalog.models.allDevices", { n: devicesTotal })}</ButtonLink>}>
          {devices.length === 0 ? (
            <p className="text-muted">{t("catalog.models.noDevices")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {devices.map((d) => (
                <li key={d.id}>
                  <Link to={`/devices/${d.id}`} className="text-accent hover:underline">
                    {d.name}
                  </Link>{" "}
                  <span className="text-[12px] text-muted">{d.space?.path?.join(" › ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
