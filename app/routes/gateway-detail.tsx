/**
 * UI-DEV-10 게이트웨이 상세(`/gateways/{id}?period=24h|7d|30d`, DEV-05.02). 시간대별 업링크 막대, 기기별 평균 rssi·snr·최적 경로 비율 표,
 * rssi 분포 히스토그램, 편집 패널(이름·공간·오프라인 기준, DEV_ADMIN). API-DEV-60(상세)·61(분포)·62(수정).
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, useRouteLoaderData } from "react-router";
import { callApi, field, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Button, Card, CsrfField, PageHeader, StatusDot, Table, Tabs, TextField } from "~/components/ui";
import { GatewayCharts } from "~/features/devmodel/components/gateway-charts";
import { GATEWAY_PERIODS, checkGatewayInput, gatewayRange, sharePercent, signal, statusTone, type Gateway, type GatewayStats } from "~/features/devmodel/model/gateways";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/gateway-detail";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const id = encodeURIComponent(params.gatewayId);
  const range = gatewayRange(url.searchParams.get("period"), ctx.runtime.now());
  const [gateway, stats, spaces] = await Promise.all([
    callApi<Gateway>(ctx, request, `/api/v1/core/gateways/${id}`),
    callApi<GatewayStats>(ctx, request, `/api/v1/core/gateways/${id}/stats?${new URLSearchParams({ from: range.from, to: range.to })}`),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
  ]);
  return { gateway: orThrow(gateway), stats: stats.ok ? stats.data : null, period: range.period, spaces: spaces.ok ? (spaces.data ?? []) : [] };
}

type ActionResult = { saved?: boolean; fieldErrors?: Record<string, string>; error?: { code: string; message?: string } };

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  const input = { name: field(form, "name"), offlineAfterSec: field(form, "offlineAfterSec") };
  const fieldErrors = checkGatewayInput(input);
  if (Object.keys(fieldErrors).length) return data({ fieldErrors } as ActionResult, { status: 400 });
  const spaceId = field(form, "spaceId");
  const result = await callApi<Gateway>(bff(context), request, `/api/v1/core/gateways/${encodeURIComponent(params.gatewayId)}`, {
    method: "PATCH",
    body: { name: input.name.trim(), spaceId: spaceId || null, offlineAfterSec: Number(input.offlineAfterSec) },
  });
  if (!result.ok) return data({ error: { code: result.code, message: result.message } } as ActionResult, { status: result.status });
  return { saved: true } as ActionResult;
}

export default function GatewayDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const canEdit = hasAny(root?.me?.permissions, ["DEV_ADMIN"]);
  const { gateway, stats, period, spaces } = loaderData;
  const result = actionData as ActionResult | undefined;
  const fe = result?.fieldErrors ?? {};
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/gateways" className="hover:underline">
            {t("devmodel.gateways.title")}
          </Link>
        }
        title={`${gateway.name} (${gateway.gatewayEui})`}
        actions={<StatusDot tone={statusTone(gateway.status)} label={t(`devmodel.gateways.statuses.${gateway.status}`, { defaultValue: gateway.status })} />}
      />
      <Tabs current={period} items={GATEWAY_PERIODS.map((p) => ({ key: p, label: t(`range.${p}`), to: `?period=${p}` }))} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {!stats ? (
            <Alert tone="warning">{t("devmodel.gateways.statsFailed")}</Alert>
          ) : (
            <>
              <Card title={t("devmodel.gateways.receivedDevices", { n: stats.deviceCount })}>
                <GatewayCharts stats={stats} timezone={timezone} lang={i18n.language} />
              </Card>
              <Card title={t("devmodel.gateways.perDevice")}>
                {stats.devices.length === 0 ? (
                  <p className="text-muted">{t("devmodel.gateways.noDevices")}</p>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">{t("devmodel.gateways.device")}</th>
                        <th scope="col">{t("devmodel.gateways.avgRssi")}</th>
                        <th scope="col">{t("devmodel.gateways.avgSnr")}</th>
                        <th scope="col">{t("devmodel.gateways.uplinks")}</th>
                        <th scope="col">{t("devmodel.gateways.share")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.devices.map((d) => (
                        <tr key={d.deviceId}>
                          <td>
                            <Link to={`/devices/${encodeURIComponent(d.deviceId)}`} className="text-accent hover:underline">
                              {d.name}
                            </Link>
                          </td>
                          <td className="font-mono">{signal(d.avgRssi)}</td>
                          <td className="font-mono">{signal(d.avgSnr)}</td>
                          <td className="font-mono">{d.uplinks}</td>
                          <td className="font-mono">{sharePercent(d.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            </>
          )}
        </div>
        <Card title={t("devmodel.gateways.info")}>
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted">{t("devmodel.gateways.source")}</dt>
            <dd>{gateway.source?.name ?? "–"}</dd>
            <dt className="text-muted">{t("devmodel.gateways.lastSeen")}</dt>
            <dd>{formatDateTime(gateway.lastSeenAt, timezone, i18n.language, true)}</dd>
          </dl>
          {canEdit ? (
            <Form method="post" className="flex flex-col gap-3">
              <CsrfField />
              {result?.saved && <Alert tone="success">{t("common.saved")}</Alert>}
              {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
              <TextField label={t("devmodel.gateways.name")} name="name" defaultValue={gateway.name} maxLength={100} error={fe.name ? t("devmodel.gateways.nameInvalid") : undefined} />
              <SpaceSelect spaces={spaces} label={t("devmodel.gateways.space")} name="spaceId" defaultValue={gateway.space?.id ?? ""} emptyLabel={t("devmodel.gateways.noSpace")} />
              <TextField
                label={t("devmodel.gateways.offlineAfter")}
                name="offlineAfterSec"
                type="number"
                min={60}
                max={86400}
                defaultValue={gateway.offlineAfterSec}
                error={fe.offlineAfterSec ? t("devmodel.gateways.offlineInvalid") : undefined}
              />
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </Form>
          ) : (
            <p className="text-[13px] text-muted">{t("devmodel.gateways.offlineAfterValue", { sec: gateway.offlineAfterSec })}</p>
          )}
        </Card>
      </div>
    </>
  );
}
