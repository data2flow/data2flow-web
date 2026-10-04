/**
 * UI-SIM-07 시나리오 목록(SIM-04.01): 이름·대상 공간·길이·기대 결과 수·마지막 실행 결과, [새 시나리오], 행 메뉴(편집·복제·내보내기·삭제).
 * API: 목록 API-SIM-12, 복제 API-SIM-13, 내보내기 API-SIM-26(파일, SIM_MANAGE), 삭제 API-SIM-12 DELETE(실행 중이면 409). 조회 SIM_READ, 쓰기 SIM_MANAGE.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, listOrThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Button, ButtonLink, Card, CsrfField, EmptyState, PageHeader, Pager, Table } from "~/components/ui";
import { RunStatusBadge, SimAreaTabs } from "~/features/sim/components/common";
import { formatDuration } from "~/features/sim/model/sim";
import type { ScenarioRow, SimSpace } from "~/features/sim/model/types";
import { simErrorText, type SimFailure } from "~/features/sim/model/sim-error";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-scenarios";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const [list, spaces] = await Promise.all([callList<ScenarioRow>(ctx, request, `/api/v1/core/sim/scenarios?page=${page}&size=50`), callList<SimSpace>(ctx, request, "/api/v1/core/sim/spaces")]);
  return { page, list: listOrThrow(list), spaceNames: spaces.ok ? Object.fromEntries(spaces.list.responses.map((s) => [String(s.spaceId), s.name])) : {} };
}

type ActionResult = { intent: string; error?: SimFailure };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const id = encodeURIComponent(field(form, "id"));
  const fail = (code: string, status: number, message?: string, errors?: SimFailure["errors"]) => data<ActionResult>({ intent, error: { code, message, errors } }, { status });
  if (intent === "clone") {
    const result = await callApi<{ id: string }>(ctx, request, `/api/v1/core/sim/scenarios/${id}/clone`, { method: "POST", body: { name: field(form, "name").slice(0, 80) } });
    if (!result.ok) return fail(result.code, result.status, result.message, result.errors);
    return redirect(`/sim/scenarios/${encodeURIComponent(result.data.id)}/edit`);
  }
  if (intent === "delete") {
    const result = await callApi(ctx, request, `/api/v1/core/sim/scenarios/${id}`, { method: "DELETE" });
    if (!result.ok) return fail(result.code, result.status, result.message, result.errors);
    return redirect("/sim/scenarios");
  }
  return fail("INVALID_REQUEST", 400);
}

export default function SimScenariosPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canManage = hasAny(root?.me?.permissions, ["SIM_MANAGE"]);
  const { list, spaceNames } = loaderData;
  const result = actionData as ActionResult | undefined;
  const newButton = canManage && (
    <ButtonLink to="/sim/scenarios/new/edit" variant="primary">
      {t("sim.scenario.new")}
    </ButtonLink>
  );
  return (
    <>
      <PageHeader crumb={t("nav.sim")} title={t("sim.scenario.listTitle")} actions={newButton} />
      <SimAreaTabs current="scenarios" />
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{simErrorText(t, result.error)}</Alert>
        </div>
      )}
      <Card>
        {list.responses.length === 0 ? (
          <EmptyState title={t("sim.scenario.empty")} action={newButton} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("sim.scenario.name")}</th>
                <th>{t("sim.scenario.spaces")}</th>
                <th>{t("sim.scenario.length")}</th>
                <th>{t("sim.scenario.expectationCount")}</th>
                <th>{t("sim.scenario.lastResult")}</th>
                <th>{t("sim.scenario.updatedAt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.responses.map((s) => (
                <tr key={s.scenarioId}>
                  <td>
                    <Link className="text-accent hover:underline" to={`/sim/scenarios/${encodeURIComponent(s.scenarioId)}/edit`}>
                      {s.name}
                    </Link>
                  </td>
                  <td>{s.spaceIds.map((id) => spaceNames[id] ?? id).join(", ")}</td>
                  <td className="font-mono">{formatDuration(s.durationSec)}</td>
                  <td className="font-mono">{s.expectationCount ?? 0}</td>
                  <td>
                    {s.lastRun ? (
                      <span className="inline-flex items-center gap-1">
                        <RunStatusBadge status={s.lastRun.status} />
                        <Link className="font-mono text-accent hover:underline" to={`/sim/runs/${encodeURIComponent(s.lastRun.runId)}/report`}>{`${s.lastRun.passed}/${s.lastRun.total}`}</Link>
                      </span>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>{formatDateTime(s.updatedAt, root?.timezone ?? "Asia/Seoul", i18n.language)}</td>
                  <td>
                    <div className="flex gap-1">
                      {canManage && (
                        <>
                          {/* 내보내기(API-SIM-26)는 SIM_MANAGE */}
                          <a className="px-2 py-1 text-[13px] text-accent hover:underline" href={`/bff/api/core/sim/scenarios/${encodeURIComponent(s.scenarioId)}/export?format=json&includeSpaces=true`}>
                            {t("sim.scenario.export")}
                          </a>
                          <Form method="post">
                            <CsrfField />
                            <input type="hidden" name="intent" value="clone" />
                            <input type="hidden" name="id" value={s.scenarioId} />
                            <input type="hidden" name="name" value={t("sim.profiles.copyName", { name: s.name })} />
                            <Button type="submit" variant="ghost">
                              {t("sim.profiles.clone")}
                            </Button>
                          </Form>
                          <Form method="post">
                            <CsrfField />
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={s.scenarioId} />
                            <Button type="submit" variant="ghost">
                              {t("common.delete")}
                            </Button>
                          </Form>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={loaderData.page} totalPages={list.totalPages} />
      </Card>
    </>
  );
}
