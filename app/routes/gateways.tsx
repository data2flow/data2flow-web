/**
 * UI-DEV-10 게이트웨이 목록(`/gateways`, DEV-05.01·05.02). 연결 점, 이름, EUI, 소스, 공간, 마지막 수신, 24시간 수신 기기 수·업링크 수.
 * API-DEV-60(DEV_READ). 상태 필터는 URL 쿼리.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, useRouteLoaderData, useSearchParams } from "react-router";
import { callList, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Button, Card, EmptyState, PageHeader, Pager, SelectField, StatusDot, Table } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { statusTone, type Gateway } from "~/features/devmodel/model/gateways";
import { formatDateTime, formatRelative } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/gateways";

export function meta() {
  return [{ title: "data2flow" }];
}

const STATUSES = ["ONLINE", "OFFLINE", "UNKNOWN"];

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = new URLSearchParams({ page: String(page), size: "50" });
  const status = url.searchParams.get("status");
  if (status && STATUSES.includes(status)) query.set("status", status);
  const list = listOrThrow(await callList<Gateway>(ctx, request, `/api/v1/core/gateways?${query}`));
  return { gateways: list.responses, totalPages: list.totalPages ?? 1, page, now: ctx.runtime.now() };
}

export default function Gateways({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const [params] = useSearchParams();
  const { gateways, totalPages, page, now } = loaderData;
  return (
    <>
      <PageHeader title={t("devmodel.gateways.title")} />
      <DeviceAreaTabs current="gateways" />
      <Card>
        <Form method="get" className="mb-3 flex flex-wrap items-end gap-3">
          <SelectField label={t("devmodel.gateways.status")} name="status" defaultValue={params.get("status") ?? ""}>
            <option value="">{t("common.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`devmodel.gateways.statuses.${s}`)}
              </option>
            ))}
          </SelectField>
          <Button type="submit">{t("common.filter")}</Button>
        </Form>
        {gateways.length === 0 ? (
          <EmptyState title={t("devmodel.gateways.empty")} body={t("devmodel.gateways.emptyBody")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">{t("devmodel.gateways.status")}</th>
                <th scope="col">{t("devmodel.gateways.name")}</th>
                <th scope="col">EUI</th>
                <th scope="col">{t("devmodel.gateways.source")}</th>
                <th scope="col">{t("devmodel.gateways.space")}</th>
                <th scope="col">{t("devmodel.gateways.lastSeen")}</th>
                <th scope="col">{t("devmodel.gateways.devices24h")}</th>
                <th scope="col">{t("devmodel.gateways.uplinks24h")}</th>
              </tr>
            </thead>
            <tbody>
              {gateways.map((g) => (
                <tr key={g.id}>
                  <td>
                    <StatusDot tone={statusTone(g.status)} label={t(`devmodel.gateways.statuses.${g.status}`, { defaultValue: g.status })} />
                  </td>
                  <td>
                    <Link to={`/gateways/${encodeURIComponent(g.id)}`} className="font-medium text-accent hover:underline">
                      {g.name}
                    </Link>
                  </td>
                  <td className="font-mono">{g.gatewayEui}</td>
                  <td>{g.source?.name ?? "–"}</td>
                  <td>{g.space?.name ?? "–"}</td>
                  <td title={formatDateTime(g.lastSeenAt, timezone, i18n.language, true)}>{formatRelative(g.lastSeenAt, now, i18n.language)}</td>
                  <td className="font-mono">{t("devmodel.gateways.deviceCount", { n: g.deviceCount24h })}</td>
                  <td className="font-mono">{g.uplinks24h}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} totalPages={totalPages} />
      </Card>
    </>
  );
}
