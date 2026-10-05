/**
 * UI-DEV-07 기기 추가 폼과 CSV 가져오기(DEV-02.01, DEV-02.04). 수동 등록 API-DEV-12(Idempotency-Key),
 * CSV 가져오기 API-DEV-19(먼저 dryRun으로 행별 검증, 확인 뒤 실제 가져오기). INTEGRATOR 이상(DEV_ADMIN).
 * ChirpStack 등록은 하지 않는다(ADR-031): LoRaWAN 기기는 ChirpStack 관리자가 등록하고 플랫폼은 업링크로 발견한다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useSearchParams } from "react-router";
import { callApi, callList, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Button, ButtonLink, Card, CsrfField, PageHeader, SelectField, Table, TextField } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { DEVICE_KINDS, checkDeviceInput, csvTemplateHref, kindMismatch, toCreateBody, type DeviceInput, type ImportReport } from "~/features/devices/model/devices";
import { errorText } from "~/lib/error-text";
import type { SpaceNode } from "~/lib/spaces";
import type { Route } from "./+types/devices-new";

export function meta() {
  return [{ title: "data2flow" }];
}

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [sources, models, spaces] = await Promise.all([
    callList<{ id: string; code: string; name: string; lifecycle?: string }>(ctx, request, "/api/v1/core/sources?size=100"),
    callList<{ id: string; code: string; name: string; kind?: string; status?: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
  ]);
  return {
    sources: (sources.ok ? sources.list.responses : []).filter((s) => !s.lifecycle || s.lifecycle === "ACTIVE" || s.lifecycle === "PAUSED"),
    models: (models.ok ? models.list.responses : []).filter((m) => m.status !== "DEPRECATED"),
    spaces: spaces.ok ? (spaces.data ?? []) : [],
    idempotencyKey: newIdempotencyKey(),
  };
}

type ActionResult = {
  intent: string;
  fieldErrors?: Record<string, string>;
  values?: DeviceInput;
  error?: { code: string; message?: string };
  report?: ImportReport;
  csv?: string;
  fileName?: string;
  mode?: string;
  imported?: boolean;
};

function inputOf(form: FormData): DeviceInput {
  return {
    sourceId: field(form, "sourceId"),
    externalId: field(form, "externalId"),
    name: field(form, "name"),
    kind: field(form, "kind"),
    modelId: field(form, "modelId"),
    spaceId: field(form, "spaceId"),
    expectedIntervalSec: field(form, "expectedIntervalSec"),
    offlineMultiplier: field(form, "offlineMultiplier"),
    tags: field(form, "tags"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  if (intent === "create") {
    const values = inputOf(form);
    const fieldErrors = checkDeviceInput(values);
    if (Object.keys(fieldErrors).length) return data({ intent, fieldErrors, values } as ActionResult, { status: 400 });
    const result = await callApi<{ id: string }>(ctx, request, "/api/v1/core/devices", { method: "POST", idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(), body: toCreateBody(values) });
    if (!result.ok) return data({ intent, values, error: { code: result.code, message: result.message } } as ActionResult, { status: result.status });
    throw redirect(`/devices/${encodeURIComponent(result.data.id)}`);
  }
  if (intent === "import-check" || intent === "import") {
    const upload = form.get("file");
    let csv = field(form, "csv");
    let fileName = field(form, "fileName") || "devices.csv";
    if (upload && typeof upload !== "string" && upload.size > 0) {
      if (upload.size > MAX_CSV_BYTES) return data({ intent, error: { code: "DEVICE_IMPORT_TOO_LARGE" } } as ActionResult, { status: 400 });
      csv = await upload.text();
      fileName = upload.name || fileName;
    }
    if (!csv.trim()) return data({ intent, fieldErrors: { file: "fileRequired" } } as ActionResult, { status: 400 });
    const mode = field(form, "mode") === "ALL_OR_NOTHING" ? "ALL_OR_NOTHING" : "SKIP_ERRORS";
    const body = new FormData();
    body.set("file", new Blob([csv], { type: "text/csv" }), fileName);
    const dryRun = intent === "import-check";
    const result = await callApi<ImportReport>(ctx, request, `/api/v1/core/devices/import?dryRun=${dryRun}&mode=${mode}`, { method: "POST", rawBody: body });
    if (!result.ok) return data({ intent, csv, fileName, mode, error: { code: result.code, message: result.message } } as ActionResult, { status: result.status });
    return { intent, report: result.data, csv, fileName, mode, imported: !dryRun } as ActionResult;
  }
  return data({ intent, error: { code: "INVALID_REQUEST" } } as ActionResult, { status: 400 });
}

export default function DevicesNew({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { sources, models, spaces, idempotencyKey } = loaderData;
  const result = actionData as ActionResult | undefined;
  const importing = params.get("import") === "1" || Boolean(result?.intent?.startsWith("import"));
  const values = result?.values;
  const errors = result?.fieldErrors ?? {};
  const [kind, setKind] = useState(values?.kind ?? "SENSOR");
  const [modelId, setModelId] = useState(values?.modelId ?? "");
  const mismatch = kindMismatch(kind, models.find((m) => m.id === modelId));
  const err = (key: string) => (errors[key] ? t(`devices.errors.${errors[key]}`) : undefined);

  return (
    <>
      <PageHeader
        crumb={
          <Link to="/devices" className="hover:underline">
            {t("devices.title")}
          </Link>
        }
        title={importing ? t("devices.import.title") : t("devices.new.title")}
        actions={importing ? <ButtonLink to="/devices/new">{t("devices.new.title")}</ButtonLink> : <ButtonLink to="/devices/new?import=1">{t("devices.importCsv")}</ButtonLink>}
      />
      <DeviceAreaTabs current="all" />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {!importing ? (
        <Card title={t("devices.new.title")}>
          <Form method="post" className="grid gap-3 sm:grid-cols-2" noValidate>
            <CsrfField />
            <input type="hidden" name="intent" value="create" />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <SelectField label={t("devices.source")} name="sourceId" defaultValue={values?.sourceId ?? ""} error={err("sourceId")} required>
              <option value="">{t("devices.new.chooseSource")}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.code}
                </option>
              ))}
            </SelectField>
            <TextField label={t("devices.externalId")} name="externalId" defaultValue={values?.externalId ?? ""} error={err("externalId")} maxLength={128} required hint={t("devices.new.externalIdHint")} />
            <TextField label={t("devices.name")} name="name" defaultValue={values?.name ?? ""} error={err("name")} maxLength={100} required />
            <SelectField label={t("devices.kind")} name="kind" value={kind} onChange={(e) => setKind(e.target.value)} error={err("kind")}>
              {DEVICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`devices.kinds.${k}`)}
                </option>
              ))}
            </SelectField>
            <div>
              <SelectField label={t("devices.model")} name="modelId" value={modelId} onChange={(e) => setModelId(e.target.value)} error={err("modelId")}>
                <option value="">{t("devices.chooseModel")}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.code}
                  </option>
                ))}
              </SelectField>
              {mismatch && <p className="mt-1 text-[12px] text-fair-ink">{t("devices.new.kindMismatch")}</p>}
            </div>
            <SpaceSelect spaces={spaces} label={t("devices.space")} name="spaceId" defaultValue={values?.spaceId ?? ""} error={err("spaceId")} />
            <TextField label={t("devices.new.interval")} name="expectedIntervalSec" type="number" defaultValue={values?.expectedIntervalSec ?? ""} error={err("expectedIntervalSec")} hint={t("devices.new.intervalHint")} />
            <TextField label={t("devices.new.multiplier")} name="offlineMultiplier" type="number" step="0.1" defaultValue={values?.offlineMultiplier ?? ""} error={err("offlineMultiplier")} />
            <TextField label={t("devices.tags")} name="tags" defaultValue={values?.tags ?? ""} error={err("tags")} hint={t("devices.tagHint")} />
            <p className="text-[12px] text-muted sm:col-span-2">{t("devices.new.noChirpstack")}</p>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <ButtonLink to="/devices">{t("common.cancel")}</ButtonLink>
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          </Form>
        </Card>
      ) : (
        <ImportPanel result={result} />
      )}
    </>
  );
}

function ImportPanel({ result }: { result?: ActionResult }) {
  const { t } = useTranslation();
  const report = result?.report;
  const checked = result?.intent === "import-check" && report;
  return (
    <Card title={t("devices.import.title")} actions={<a href={csvTemplateHref()} download="devices-template.csv" className="text-[13px] text-accent hover:underline">{t("devices.import.template")}</a>}>
      {result?.imported && report && (
        <div className="mb-3">
          <Alert tone={report.failed ? "warning" : "success"}>{t("devices.import.done", { ok: report.succeeded, failed: report.failed, total: report.total })}</Alert>
        </div>
      )}
      <Form method="post" encType="multipart/form-data" className="flex flex-col gap-3">
        <CsrfField />
        {checked ? (
          <>
            <input type="hidden" name="csv" value={result.csv ?? ""} />
            <input type="hidden" name="fileName" value={result.fileName ?? ""} />
            <p className="text-[13px]">{t("devices.import.checked", { total: report.total, ok: report.succeeded, failed: report.failed })}</p>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="device-csv" className="text-[12.5px] font-medium text-muted">
              {t("devices.import.file")}
            </label>
            <input id="device-csv" type="file" name="file" accept=".csv,text/csv" />
            {result?.fieldErrors?.file && (
              <p role="alert" className="text-[12px] text-bad-ink">
                {t("devices.errors.fileRequired")}
              </p>
            )}
            <p className="text-[12px] text-muted">{t("devices.import.limits")}</p>
          </div>
        )}
        {report && report.rows.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>{t("devices.import.line")}</th>
                <th>{t("devices.import.result")}</th>
                <th>{t("devices.import.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.line} className={row.ok ? undefined : "bg-bad-soft"}>
                  <td className="font-mono">{row.line}</td>
                  <td>{row.ok ? t("devices.import.rowOk") : t("devices.import.rowFailed")}</td>
                  <td>{row.ok ? "" : row.message || errorText(t, { code: row.errorCode ?? "UNKNOWN" })}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {checked && (
          <fieldset className="flex flex-col gap-1 text-[13px]">
            <legend className="text-[12.5px] font-medium text-muted">{t("devices.import.mode")}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="SKIP_ERRORS" defaultChecked /> {t("devices.import.skipErrors")}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="ALL_OR_NOTHING" /> {t("devices.import.allOrNothing")}
            </label>
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          {checked ? (
            <Button type="submit" name="intent" value="import" variant="primary">
              {t("devices.import.run")}
            </Button>
          ) : (
            <Button type="submit" name="intent" value="import-check" variant="primary">
              {t("devices.import.check")}
            </Button>
          )}
        </div>
      </Form>
    </Card>
  );
}
