/**
 * UI-SIM-01 가상 환경 홈(SIM-04.05, SIM-11.01): 사용량(가상 기기 n/500, 실행 n/5, 가상 처리 비율 — 80% 넘으면 주황),
 * 데모 프리셋 5종([준비] API-SIM-18 SIM_MANAGE, [실행] API-SIM-14 SIM_RUN, 가속 기본 x30·최대 x60), 실행 중 목록, 가상 공간, 최근 결과.
 * M3 시연: "폭염 오후"(heatwave-afternoon) 준비 → x60 실행 → 실행 패널.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useRouteLoaderData } from "react-router";
import { callApi, callList, field, newIdempotencyKey, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, PageHeader, SelectField, cx } from "~/components/ui";
import { SimAreaTabs, VirtualBadge } from "~/features/sim/components/common";
import { ACCELERATION_CHOICES, DEFAULT_DEMO_ACCELERATION, checkAcceleration, usageTone } from "~/features/sim/model/sim";
import type { SimOverview, SimPreset } from "~/features/sim/model/types";
import { simErrorText, type SimFailure } from "~/features/sim/model/sim-error";
import { formatDateTime } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-home";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const overview = orThrow(await callApi<SimOverview>(ctx, request, "/api/v1/core/sim/overview"));
  return { overview, idempotencyKey: newIdempotencyKey() };
}

type ActionResult = { intent: string; presetKey?: string; error?: SimFailure; prepared?: { reused: boolean; deviceIds?: string[] } };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const presetKey = field(form, "presetKey");
  const fail = (code: string, status: number, message?: string, errors?: SimFailure["errors"]) => data<ActionResult>({ intent, presetKey, error: { code, message, errors } }, { status });
  if (!/^[a-z0-9-]{1,40}$/.test(presetKey)) return fail("INVALID_REQUEST", 400);
  if (intent === "prepare") {
    const result = await callApi<{ scenarioId: string; reused: boolean; deviceIds?: string[] }>(ctx, request, `/api/v1/core/sim/presets/${encodeURIComponent(presetKey)}/prepare`, { method: "POST", idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey() });
    if (!result.ok) return fail(result.code, result.status, result.message, result.errors);
    return { intent, presetKey, prepared: { reused: result.data.reused, deviceIds: result.data.deviceIds } } satisfies ActionResult;
  }
  if (intent === "run") {
    const acceleration = Number(field(form, "acceleration"));
    if (checkAcceleration(acceleration)) return fail("INVALID_REQUEST", 400);
    // 프리셋 시나리오 ID는 overview·프리셋 목록(API-SIM-18 GET)의 scenarioId(준비 전이면 null)
    let scenarioId = field(form, "scenarioId");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(scenarioId)) {
      const presets = await callList<SimPreset>(ctx, request, "/api/v1/core/sim/presets");
      if (!presets.ok) return fail(presets.code, presets.status, presets.message, presets.errors);
      scenarioId = presets.list.responses.find((p) => p.key === presetKey)?.scenarioId ?? "";
    }
    if (!scenarioId) return fail("SIM_PRESET_NOT_PREPARED", 409);
    const run = await callApi<{ runId: string }>(ctx, request, "/api/v1/core/sim/runs", {
      method: "POST",
      idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
      body: { scenarioId, acceleration, timestampPolicy: "SIMULATED", notificationPolicy: "PREFIX" },
    });
    if (!run.ok) return fail(run.code, run.status, run.message, run.errors);
    return redirect(`/sim/runs/${encodeURIComponent(run.data.runId)}`);
  }
  return fail("INVALID_REQUEST", 400);
}

export default function SimHome({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const permissions = root?.me?.permissions;
  const canManage = hasAny(permissions, ["SIM_MANAGE"]);
  const canRun = hasAny(permissions, ["SIM_RUN"]);
  const { overview, idempotencyKey } = loaderData;
  const result = actionData as ActionResult | undefined;
  const timezone = root?.timezone ?? "Asia/Seoul";
  const usage = overview.usage;
  const firstUse = usage.devices === 0 && overview.runs.length === 0 && overview.spaces.length === 0;
  return (
    <>
      <PageHeader
        crumb={t("nav.sim")}
        title={t("sim.home.title")}
        actions={
          <p className="flex flex-wrap gap-3 text-[12.5px]" aria-label={t("sim.home.usage")}>
            <span className={cx(usageTone(usage.devices, usage.devicesLimit) === "warn" && "font-semibold text-fair-ink")}>{t("sim.home.devices", { n: usage.devices, max: usage.devicesLimit })}</span>
            <span className={cx(usageTone(usage.runningRuns, usage.runsLimit) === "warn" && "font-semibold text-fair-ink")}>{t("sim.home.runs", { n: usage.runningRuns, max: usage.runsLimit })}</span>
            <span className={cx(usage.virtualThroughputPct >= 40 && "font-semibold text-fair-ink")}>{t("sim.home.throughput", { n: usage.virtualThroughputPct })}</span>
          </p>
        }
      />
      <SimAreaTabs current="home" />
      {firstUse && (
        <div className="mb-3">
          <Alert tone="info">{t("sim.home.firstUse")}</Alert>
        </div>
      )}
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{simErrorText(t, result.error)}</Alert>
        </div>
      )}
      {result?.prepared && (
        <div className="mb-3">
          <Alert tone="success">{result.prepared.reused ? t("sim.home.reused") : t("sim.home.prepared")}</Alert>
        </div>
      )}
      <Card title={t("sim.home.demos")} className="mb-4">
        <div className="grid gap-3 md:grid-cols-5">
          {overview.presets.map((p) => (
            <PresetCard key={p.key} preset={p} canManage={canManage} canRun={canRun} idempotencyKey={idempotencyKey} highlight={firstUse} />
          ))}
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t("sim.home.running")}>
          {overview.runs.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("sim.home.noRuns")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-[13px]">
              {overview.runs.map((r) => (
                <li key={r.runId}>
                  <Link className="text-accent hover:underline" to={`/sim/runs/${encodeURIComponent(r.runId)}`}>
                    {r.scenarioName}
                  </Link>
                  <span className="ml-2 text-muted">{Array.isArray(r.spaces) ? r.spaces.join(", ") : (r.spaces ?? "")}</span>
                  <span className="ml-2 font-mono">{`x${r.accelerationEffective}`}</span>
                  <progress className="ml-2 h-2 w-24 align-middle" max={100} value={r.progressPct} aria-label={t("sim.run.progress")} />
                  <span className="ml-1 font-mono">{`${Math.round(r.progressPct)}%`}</span>
                  <span className="ml-2 font-mono text-muted">{formatDateTime(r.simClock, timezone, i18n.language)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("sim.home.recent")}>
          {overview.recentResults.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t("sim.home.noResults")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {overview.recentResults.slice(0, 10).map((r) => (
                <li key={r.runId}>
                  <Link className="text-accent hover:underline" to={`/sim/runs/${encodeURIComponent(r.runId)}/report`}>
                    {`R-${r.runId}`}
                  </Link>
                  <span className={cx("ml-2", r.passed === r.total ? "text-good-ink" : "text-bad-ink")}>{t("sim.home.passed", { passed: r.passed, total: r.total })}</span>
                  <span className="ml-2 text-muted">{formatDateTime(r.finishedAt, timezone, i18n.language)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title={t("sim.home.spaces")} className="mt-4">
        {overview.spaces.length === 0 ? (
          <EmptyState title={t("sim.home.noSpaces")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-4">
            {overview.spaces.map((s) => (
              <Link key={s.spaceId} to={`/sim/spaces/${encodeURIComponent(s.spaceId)}`} className="rounded-md border border-line p-3 hover:border-accent">
                <p className="flex items-center gap-2 font-semibold">
                  {s.name} <VirtualBadge />
                </p>
                <p className="text-[12.5px] text-muted">{t("sim.home.spaceDevices", { sensors: s.sensors, actuators: s.actuators })}</p>
                <p className="font-mono text-[12.5px]">{`${s.current?.temperature ?? "–"}℃ · ${s.current?.co2 ?? "–"}ppm`}</p>
                {s.running && <Badge tone="info">{t("sim.home.spaceRunning")}</Badge>}
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function PresetCard({ preset, canManage, canRun, idempotencyKey, highlight }: { preset: SimOverview["presets"][number]; canManage: boolean; canRun: boolean; idempotencyKey: string; highlight: boolean }) {
  const { t } = useTranslation();
  const [acceleration, setAcceleration] = useState(String(DEFAULT_DEMO_ACCELERATION));
  return (
    <section aria-label={preset.name} className={cx("flex flex-col gap-2 rounded-md border p-3", highlight ? "border-accent" : "border-line")}>
      <p className="font-semibold">{preset.name}</p>
      {preset.description && <p className="text-[12.5px] text-muted">{preset.description}</p>}
      {preset.estimatedMinutes ? <p className="text-[12px] text-muted">{t("sim.home.estimated", { n: preset.estimatedMinutes })}</p> : null}
      <Badge tone={preset.state === "NOT_PREPARED" ? "neutral" : preset.state === "RUNNING" ? "info" : "success"}>{t(`sim.presetState.${preset.state}`)}</Badge>
      {preset.state === "NOT_PREPARED" ? (
        canManage && (
          <Form method="post">
            <CsrfField />
            <input type="hidden" name="intent" value="prepare" />
            <input type="hidden" name="presetKey" value={preset.key} />
            <input type="hidden" name="idempotencyKey" value={`${idempotencyKey}-${preset.key}`} />
            <Button type="submit">{t("sim.home.prepare")}</Button>
          </Form>
        )
      ) : (
        canRun &&
        preset.state === "PREPARED" && (
          <Form method="post" className="flex items-end gap-2">
            <CsrfField />
            <input type="hidden" name="intent" value="run" />
            <input type="hidden" name="presetKey" value={preset.key} />
            {preset.scenarioId && <input type="hidden" name="scenarioId" value={preset.scenarioId} />}
            <input type="hidden" name="idempotencyKey" value={`${idempotencyKey}-${preset.key}-run`} />
            <SelectField label={t("sim.run.acceleration")} name="acceleration" value={acceleration} onChange={(e) => setAcceleration(e.target.value)}>
              {ACCELERATION_CHOICES.map((n) => (
                <option key={n} value={n}>{`x${n}`}</option>
              ))}
            </SelectField>
            <Button type="submit" variant="primary">
              {t("sim.home.run")}
            </Button>
          </Form>
        )
      )}
    </section>
  );
}
