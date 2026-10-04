/**
 * UI-DEV-12 일괄 작업 목록과 마법사(`/device-jobs`, `?new=1&deviceIds=…`, DEV-02.09).
 * 조회 VIEWER 이상(API-DEV-71), 새 작업 DEV_ADMIN(API-DEV-70, 명령 전송은 DEVICE_CONTROL도). 마법사 후보: 그룹(API-DEV-60)·모델(API-DEV-46)·공간(API-DEV-01)
 */
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useRouteLoaderData } from "react-router";
import { callApi, callList } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Pager, Table } from "~/components/ui";
import { DeviceAreaTabs } from "~/features/devices/area-tabs";
import { JobWizard } from "~/features/devices/device-jobs";
import { creatorName, jobPercent, jobTone, parseDeviceIds, type DeviceJobSummary } from "~/features/devices/model/jobs";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/device-jobs";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const wizard = url.searchParams.get("new") === "1";
  const [jobs, groups, models, spaces] = await Promise.all([
    callList<DeviceJobSummary>(ctx, request, `/api/v1/core/device-jobs?page=${page}&size=20`),
    wizard ? callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/device-groups?size=100") : Promise.resolve(null),
    wizard ? callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/device-models?size=100") : Promise.resolve(null),
    wizard ? callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces") : Promise.resolve(null),
  ]);
  return {
    jobs: jobs.ok ? jobs.list.responses : [],
    totalPages: jobs.ok ? jobs.list.totalPages : 1,
    page,
    failed: !jobs.ok,
    wizard: wizard
      ? {
          deviceIds: parseDeviceIds(url.searchParams.get("deviceIds")),
          groups: groups?.ok ? groups.list.responses.map((g) => ({ id: String(g.id), name: g.name })) : [],
          models: models?.ok ? models.list.responses.map((m) => ({ id: String(m.id), name: m.name })) : [],
          spaces: spaces?.ok ? (spaces.data ?? []) : [],
        }
      : null,
  };
}

export default function DeviceJobs({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  const permissions = root?.me?.permissions;
  const canAdmin = hasAny(permissions, ["DEV_ADMIN"]);
  const { jobs, failed, wizard, page, totalPages } = loaderData;
  const timezone = root?.timezone ?? "Asia/Seoul";
  return (
    <>
      <PageHeader
        title={t("devices.jobs.title")}
        actions={
          canAdmin &&
          !wizard && (
            <ButtonLink to="/device-jobs?new=1" variant="primary">
              {t("devices.jobs.new")}
            </ButtonLink>
          )
        }
      />
      <DeviceAreaTabs current="jobs" />
      {wizard && canAdmin && (
        <div className="mb-4">
          <JobWizard
            deviceIds={wizard.deviceIds}
            groups={wizard.groups}
            models={wizard.models}
            spaces={wizard.spaces}
            canControl={hasAny(permissions, ["DEVICE_CONTROL"])}
            onCreated={(job) => navigate(`/device-jobs/${encodeURIComponent(job.id)}`)}
          />
        </div>
      )}
      <Card>
        {failed && <Alert tone="warning">{t("control.common.loadFailed")}</Alert>}
        {jobs.length === 0 && !failed ? (
          <EmptyState title={t("devices.jobs.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("devices.jobs.type")}</th>
                <th>{t("devices.jobs.targetKind")}</th>
                <th>{t("devices.jobs.progress")}</th>
                <th>{t("devices.status")}</th>
                <th>{t("devices.jobs.createdBy")}</th>
                <th>{t("devices.jobs.createdAt")}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link to={`/device-jobs/${encodeURIComponent(job.id)}`} className="text-accent hover:underline">
                      {`#${job.id} ${t(`devices.jobs.types.${job.type}`, { defaultValue: job.type })}`}
                    </Link>
                  </td>
                  <td className="font-mono">{job.total}</td>
                  <td>
                    <progress max={100} value={jobPercent(job)} aria-label={t("devices.jobs.progress")} />{" "}
                    <span className="text-[12px]">{t("devices.jobs.progressLine", { succeeded: job.succeeded, failed: job.failed, total: job.total })}</span>
                  </td>
                  <td>
                    <Badge tone={jobTone(job.status)}>{t(`devices.jobs.statuses.${job.status}`, { defaultValue: job.status })}</Badge>
                  </td>
                  <td>{creatorName(job.createdBy)}</td>
                  <td>{formatDateTime(job.createdAt, timezone, i18n.language)}</td>
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
