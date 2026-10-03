/**
 * UI-SIM-12 실행 결과 리포트(SIM-04.06, SIM-05.04): 요약(시드·가속·기간·통과 n/n, 부분 판정), 기대 결과별 판정과 근거,
 * 주요 지표(쾌적도·목표 이탈 시간·에너지·제어·알람), 주입한 장애(정답 라벨), [JSON 내려받기]. 조회 SIM_READ. API-SIM-17.
 */
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import { callApi, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Badge, Card, PageHeader, Table } from "~/components/ui";
import { SimAreaTabs, VirtualBadge } from "~/features/sim/components/common";
import { formatElapsed } from "~/features/sim/model/sim";
import type { SimReport } from "~/features/sim/model/types";
import { formatDateTime } from "~/lib/format";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-run-report";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const ctx = bff(context);
  return { report: orThrow(await callApi<SimReport>(ctx, request, `/api/v1/core/sim/runs/${encodeURIComponent(params.runId)}/report`)) };
}

export default function SimRunReportPage({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const { report } = loaderData;
  const scenarioName = typeof report.scenario === "string" ? report.scenario : (report.scenario?.name ?? "");
  const allPassed = report.passed === report.total;
  const json = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`;
  const m = report.metrics ?? {};
  return (
    <>
      <PageHeader
        crumb={t("sim.area.scenarios")}
        title={
          <span className="inline-flex items-center gap-2">
            {t("sim.report.title", { id: report.runId, name: scenarioName })} <VirtualBadge />
          </span>
        }
        actions={
          <a className="rounded-md border border-line px-3 py-1.5 text-[13px]" href={json} download={`sim-run-${report.runId}.json`}>
            {t("sim.report.download")}
          </a>
        }
      />
      <SimAreaTabs current="scenarios" />
      <Card>
        <p className="flex flex-wrap items-center gap-3 text-[13px]">
          <Badge tone={allPassed ? "success" : "danger"}>{t("sim.home.passed", { passed: report.passed, total: report.total })}</Badge>
          {report.partial && <Badge tone="warning">{t("sim.report.partial")}</Badge>}
          <span>{t("sim.report.seed", { seed: report.seed })}</span>
          <span className="font-mono">{`x${report.acceleration}`}</span>
          <span>{`${formatDateTime(report.simFrom, timezone, i18n.language)} ~ ${formatDateTime(report.simTo, timezone, i18n.language)}`}</span>
          <Link className="text-accent hover:underline" to={`/sim/runs/${encodeURIComponent(report.runId)}`}>
            {t("sim.report.backToRun")}
          </Link>
        </p>
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title={t("sim.run.expectations")}>
          <Table>
            <tbody>
              {report.expectations.map((x) => (
                <tr key={x.id}>
                  <td>{t(`sim.expectation.${x.kind}`, { defaultValue: x.kind })}</td>
                  <td>
                    <Badge tone={x.passed ? "success" : "danger"}>{x.passed ? t("sim.expectationState.PASSED") : t("sim.expectationState.FAILED")}</Badge>
                  </td>
                  <td className="font-mono text-[12px]">
                    {x.evidence?.at ? formatDateTime(x.evidence.at, timezone, i18n.language) : ""} {x.evidence?.value !== undefined ? String(x.evidence.value) : ""} {x.evidence?.actual !== undefined ? String(x.evidence.actual) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={t("sim.report.metrics")}>
          <dl className="grid grid-cols-2 gap-2 text-[13px]">
            <dt className="text-muted">{t("sim.report.comfort")}</dt>
            <dd className="font-mono">{m.comfortScore ?? "–"}</dd>
            <dt className="text-muted">{t("sim.report.outOfTarget")}</dt>
            <dd className="font-mono">{m.outOfTargetSec === null || m.outOfTargetSec === undefined ? "–" : formatElapsed(m.outOfTargetSec)}</dd>
            <dt className="text-muted">{t("sim.report.energy")}</dt>
            <dd className="font-mono">{m.energyKwh === null || m.energyKwh === undefined ? "–" : `${m.energyKwh} kWh`}</dd>
            <dt className="text-muted">{t("sim.report.controls")}</dt>
            <dd className="font-mono">{m.controlCount ?? "–"}</dd>
            <dt className="text-muted">{t("sim.report.alarms")}</dt>
            <dd className="font-mono">{m.alarmCount ?? "–"}</dd>
          </dl>
        </Card>
      </div>
      <Card title={t("sim.report.faults")} className="mt-4">
        {report.faults.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t("sim.report.noFaults")}</p>
        ) : (
          <Table>
            <tbody>
              {report.faults.map((f) => (
                <tr key={f.id}>
                  <td>{t(`sim.fault.kinds.${f.kind}`, { defaultValue: f.kind })}</td>
                  <td>{f.target}</td>
                  <td className="font-mono">{`${formatDateTime(f.from, timezone, i18n.language)} ~ ${f.to ? formatDateTime(f.to, timezone, i18n.language) : ""}`}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
