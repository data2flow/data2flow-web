/**
 * UI-FLW-21 확장 노드 패키지(FLW-11.05, UC-FLW-29, BR-FLW-33). 목록은 경로 가드(FLOW_DEPLOY_CONTROL·NODE_PACKAGE_MANAGE),
 * 설치·업그레이드·비활성화는 NODE_PACKAGE_MANAGE(ADMIN).
 * API: 목록 API-FLW-73, 설치 API-FLW-70(multipart `.d2fpkg` 또는 `{registryUrl}`), 업그레이드 API-FLW-71(새 버전을 나란히 설치), 비활성화·활성화 API-FLW-72.
 */
import { useTranslation } from "react-i18next";
import { Form, data, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, PageHeader, Table, TextField } from "~/components/ui";
import { FlowOpsTabs } from "~/features/flowops/components/parts";
import { isValidPackageName, latestVersion, sortedVersions, validateInstallInput, type InstallInputError, type NodePackage } from "~/features/flowops/model/packages";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/flow-packages";

interface Installed {
  packageId: string;
  name: string;
  version: string;
  runtime: string;
  license: string;
  signer: string;
  status: string;
  nodeTypes?: string[];
}

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const list = await callList<NodePackage>(bff(context), request, "/api/v1/core/node-packages?size=100");
  return { list: listOrThrow(list) };
}

type ActionData = { intent: string; installed?: Installed; toggled?: { name: string; status: string; usedFlowCount?: number }; inputError?: InstallInputError; target?: string; error?: { code: string; message?: string } };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const name = field(form, "name");
  const fail = (status: number, body: ActionData) => data<ActionData>(body, { status });
  if (name && !isValidPackageName(name)) return fail(400, { intent, error: { code: "INVALID_REQUEST" } });
  if (intent === "install" || intent === "upgrade") {
    const file = form.get("file");
    const upload = file instanceof File && file.size > 0 ? file : null;
    const registryUrl = field(form, "registryUrl").trim();
    const inputError = validateInstallInput(upload, registryUrl);
    if (inputError) return fail(400, { intent, target: name, inputError });
    const path = intent === "install" ? "/api/v1/core/node-packages" : `/api/v1/core/node-packages/${encodeURIComponent(name)}/versions`;
    let options: Parameters<typeof callApi>[3];
    if (upload) {
      const body = new FormData();
      body.set("file", upload, upload.name);
      options = { method: "POST", rawBody: body, idempotencyKey: newIdempotencyKey() };
    } else options = { method: "POST", body: { registryUrl }, idempotencyKey: newIdempotencyKey() };
    const result = await callApi<Installed>(ctx, request, path, options);
    return result.ok ? ({ intent, installed: result.data } satisfies ActionData) : fail(result.status, { intent, target: name, error: { code: result.code, message: result.message } });
  }
  if (intent === "disable" || intent === "enable") {
    const result = await callApi<ActionData["toggled"]>(ctx, request, `/api/v1/core/node-packages/${encodeURIComponent(name)}/${intent}`, { method: "POST", body: {} });
    return result.ok ? ({ intent, toggled: result.data } satisfies ActionData) : fail(result.status, { intent, target: name, error: { code: result.code, message: result.message } });
  }
  return fail(400, { intent, error: { code: "INVALID_REQUEST" } });
}

function InstallForm({ name, error }: { name?: string; error?: string }) {
  const { t } = useTranslation();
  return (
    <Form method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-2">
      <CsrfField />
      <input type="hidden" name="intent" value={name ? "upgrade" : "install"} />
      {name && <input type="hidden" name="name" value={name} />}
      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="font-medium">{t("flowops.packages.file")}</span>
        <input type="file" name="file" accept=".d2fpkg" aria-label={name ? t("flowops.packages.fileOf", { name }) : t("flowops.packages.file")} />
      </label>
      <TextField label={t("flowops.packages.registryUrl")} name="registryUrl" placeholder="https://" error={error} />
      <Button type="submit" variant={name ? "secondary" : "primary"}>
        {name ? t("flowops.packages.upgrade") : t("flowops.packages.install")}
      </Button>
    </Form>
  );
}

export default function FlowPackages({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const tz = root?.timezone ?? "Asia/Seoul";
  const canManage = hasAny(root?.me?.permissions, ["NODE_PACKAGE_MANAGE"]);
  const result = actionData as ActionData | undefined;
  const rows = loaderData.list.responses;
  const inputErrorText = (target?: string) => (result?.inputError && (result.target ?? "") === (target ?? "") ? t(`flowops.packages.inputErrors.${result.inputError}`) : undefined);
  return (
    <>
      <PageHeader crumb={t("nav.automation")} title={t("flowops.packages.title")} />
      <FlowOpsTabs current="packages" />
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      {result?.installed && (
        <Alert tone="success">
          {t("flowops.packages.installed", { name: result.installed.name, version: result.installed.version, signer: result.installed.signer, license: result.installed.license, runtime: t(`flowops.packages.runtimes.${result.installed.runtime}`, { defaultValue: result.installed.runtime }) })}
          {result.installed.nodeTypes?.length ? ` ${t("flowops.packages.nodeTypes", { list: result.installed.nodeTypes.join(", ") })}` : ""}
          {result.intent === "upgrade" ? ` ${t("flowops.packages.sideBySide")}` : ""}
        </Alert>
      )}
      {result?.toggled && <Alert tone="success">{t(`flowops.packages.${result.toggled.status === "DISABLED" ? "disabledDone" : "enabledDone"}`, { name: result.toggled.name, count: result.toggled.usedFlowCount ?? 0 })}</Alert>}
      <div className="flex flex-col gap-4">
        {canManage ? (
          <Card title={t("flowops.packages.installTitle")}>
            <InstallForm error={inputErrorText()} />
            <p className="mt-2 text-[12px] text-muted">{t("flowops.packages.installHint")}</p>
          </Card>
        ) : (
          <p className="text-[12.5px] text-muted">{t("flowops.packages.readOnly")}</p>
        )}
        <Card>
          {rows.length === 0 ? (
            <EmptyState title={t("flowops.packages.empty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("flowops.packages.name")}</th>
                  <th>{t("flowops.packages.version")}</th>
                  <th>{t("flowops.packages.signer")}</th>
                  <th>{t("flowops.packages.license")}</th>
                  <th>{t("flowops.packages.runtime")}</th>
                  <th>{t("flowops.packages.status")}</th>
                  <th>{t("flowops.packages.usedFlows")}</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((pkg) => {
                  const latest = latestVersion(pkg);
                  const versions = sortedVersions(pkg);
                  return (
                    <tr key={pkg.packageId}>
                      <td>
                        <p className="font-medium">{pkg.name}</p>
                        {versions.length > 1 && <p className="text-[12px] text-muted">{t("flowops.packages.versionsInstalled", { list: versions.map((v) => v.version).join(", ") })}</p>}
                        {latest?.installedAt && <p className="text-[12px] text-muted">{formatDateTime(latest.installedAt, tz, i18n.language)}</p>}
                      </td>
                      <td>{latest?.version ?? "–"}</td>
                      <td>{latest ? t("flowops.packages.signed", { signer: latest.signer }) : "–"}</td>
                      <td>{latest?.license ?? "–"}</td>
                      <td>{latest ? t(`flowops.packages.runtimes.${latest.runtime}`, { defaultValue: latest.runtime }) : "–"}</td>
                      <td>
                        <Badge tone={pkg.status === "ACTIVE" ? "success" : "neutral"}>{t(`flowops.packages.statuses.${pkg.status}`, { defaultValue: pkg.status })}</Badge>
                      </td>
                      <td>{pkg.usedFlowCount}</td>
                      {canManage && (
                        <td>
                          <div className="flex flex-col gap-2">
                            <Form method="post">
                              <CsrfField />
                              <input type="hidden" name="name" value={pkg.name} />
                              <Button type="submit" name="intent" value={pkg.status === "ACTIVE" ? "disable" : "enable"} variant={pkg.status === "ACTIVE" ? "danger" : "secondary"}>
                                {pkg.status === "ACTIVE" ? t("flowops.packages.disable") : t("flowops.packages.enable")}
                              </Button>
                            </Form>
                            {pkg.status === "ACTIVE" && pkg.usedFlowCount > 0 && <p className="text-[12px] text-muted">{t("flowops.packages.disableHint", { count: pkg.usedFlowCount })}</p>}
                            <InstallForm name={pkg.name} error={inputErrorText(pkg.name)} />
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
