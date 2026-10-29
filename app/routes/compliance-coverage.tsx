/**
 * UI-CMP-11 커버리지 점검(`/compliance/coverage?siteId=&profileId=`, CMP-03.01~04). 조회 CMP_READ(VIEWER+), [작업 지시 만들기]는 WORKORDER_WRITE(OPERATOR+).
 * 필터(사이트·프로필) → 점검 4종 신호등(설치 밀도·공개 표시·교정 기한·데이터 품질)과 표. 면적이 없는 공간은 "판단 불가(면적 없음)"와 [면적 입력](공간 편집).
 * 교정 표에서 체크한 기기로 교정 작업 지시를 한 번에 만든다(DEV 작업 지시 API).
 * API: 점검 API-CMP-25, 공간 트리, 프로필 목록 API-CMP-01, 작업 지시 만들기 API-DEV-08.
 */
import { useTranslation } from "react-i18next";
import { Form, Link, data, redirect, useNavigation, useRouteLoaderData } from "react-router";
import { callApi, callList, field, newIdempotencyKey } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, PageHeader, SelectField, Table } from "~/components/ui";
import { calibrationTone, signalTone, summaryCounts, type Coverage, type Signal } from "~/features/compliance/model/coverage";
import { errorText } from "~/lib/error-text";
import { formatNumber } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/compliance-coverage";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const url = new URL(request.url);
  const [spaces, profiles] = await Promise.all([
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ profileId: string; name: string; archived?: boolean }>(ctx, request, "/api/v1/core/compliance/profiles?size=100"),
  ]);
  const sites = spaces.ok ? spaces.data.map((s) => ({ id: String(s.id), name: s.name })) : [];
  const siteId = url.searchParams.get("siteId") ?? sites[0]?.id ?? "";
  const profileId = url.searchParams.get("profileId") ?? "";
  const query = new URLSearchParams({ siteId });
  if (profileId) query.set("profileId", profileId);
  const coverage = siteId ? await callApi<Coverage>(ctx, request, `/api/v1/core/compliance/coverage?${query}`) : null;
  return {
    sites,
    profiles: profiles.ok ? profiles.list.responses.filter((p) => !p.archived).map((p) => ({ id: p.profileId, name: p.name })) : [],
    siteId,
    profileId,
    coverage: coverage?.ok ? coverage.data : null,
    failed: coverage && !coverage.ok ? { code: coverage.code, message: coverage.message } : null,
    idempotencyKey: newIdempotencyKey(),
  };
}

type ActionResult = { error?: { code: string; message?: string }; noDevices?: boolean };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const deviceIds = form.getAll("deviceIds").filter((v): v is string => typeof v === "string" && v !== "");
  if (!deviceIds.length) return data<ActionResult>({ noDevices: true }, { status: 400 });
  const created = await callApi<{ id: string }>(ctx, request, "/api/v1/core/work-orders", {
    method: "POST",
    body: { title: field(form, "title") || "교정 기한 점검", type: "CALIBRATION", priority: "NORMAL", targets: deviceIds.map((deviceId) => ({ deviceId })), origin: "MANUAL" },
    idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
  });
  if (!created.ok) return data<ActionResult>({ error: { code: created.code, message: created.message } }, { status: created.status });
  throw redirect(`/work-orders/${created.data.id}`);
}

function Light({ label, signal, detail }: { label: string; signal: Signal; detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line p-3" data-signal={signal}>
      <span className="text-[12.5px] text-muted">{label}</span>
      <Badge tone={signalTone(signal)}>{detail}</Badge>
    </div>
  );
}

export default function ComplianceCoverage({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canOrder = hasAny(root?.me?.permissions, ["WORKORDER_WRITE"]);
  const { sites, profiles, siteId, profileId, coverage: c, failed } = loaderData;
  const result = actionData as ActionResult | undefined;
  const num = (v?: number | null, precision = 0) => (v === null || v === undefined ? "–" : formatNumber(v, i18n.language, { precision }));
  const counts = c ? summaryCounts(c) : null;
  const light = (key: "density" | "publicDisplay" | "calibration" | "quality") =>
    c!.summary[key] === "NA" ? t("compliance.coverage.na") : c!.summary[key] === "GREEN" ? t("compliance.coverage.ok") : t(`compliance.coverage.signal.${key}`, { n: counts![key] });
  return (
    <>
      <PageHeader title={t("compliance.coverage.title")} crumb={t("nav.compliance")} />
      <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label={t("compliance.coverage.site")} name="siteId" defaultValue={siteId}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("compliance.coverage.profile")} name="profileId" defaultValue={profileId}>
          <option value="">{t("compliance.coverage.noProfile")}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <Button type="submit">{t("compliance.coverage.run")}</Button>
      </Form>
      {result?.error && (
        <div className="mb-3">
          <Alert tone="danger">{errorText(t, result.error)}</Alert>
        </div>
      )}
      {failed ? (
        <Alert tone="warning">{errorText(t, failed)}</Alert>
      ) : !c ? (
        <EmptyState title={t("compliance.coverage.noSite")} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Light label={t("compliance.coverage.density")} signal={c.summary.density} detail={light("density")} />
            <Light label={t("compliance.coverage.publicDisplay")} signal={c.summary.publicDisplay} detail={light("publicDisplay")} />
            <Light label={t("compliance.coverage.calibration")} signal={c.summary.calibration} detail={light("calibration")} />
            <Light label={t("compliance.coverage.quality")} signal={c.summary.quality} detail={light("quality")} />
          </div>

          <Card title={t("compliance.coverage.density")}>
            {c.density.length === 0 ? (
              <p className="text-[13px] text-muted">{t("compliance.coverage.densityNa")}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t("compliance.coverage.col.space")}</th>
                    <th>{t("compliance.coverage.col.usage")}</th>
                    <th>{t("compliance.coverage.col.area")}</th>
                    <th>{t("compliance.coverage.col.required")}</th>
                    <th>{t("compliance.coverage.col.actual")}</th>
                    <th>{t("compliance.coverage.col.shortage")}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.density.map((r) => (
                    <tr key={r.space.id} data-density={r.space.id}>
                      <td>{r.space.name}</td>
                      <td>{r.usage ? t(`compliance.coverage.usage.${r.usage}`, { defaultValue: r.usage }) : "–"}</td>
                      <td>{r.areaM2 ? `${num(r.areaM2)}㎡` : "–"}</td>
                      <td>{num(r.required)}</td>
                      <td>{r.actual}</td>
                      <td>
                        {r.undeterminedReason ? (
                          <span className="flex flex-wrap items-center gap-2">
                            {t("compliance.coverage.noArea")}
                            <Link className="text-accent hover:underline" to={`/spaces/${r.space.id}`}>
                              {t("compliance.coverage.enterArea")}
                            </Link>
                          </span>
                        ) : (r.shortage ?? 0) > 0 ? (
                          <Badge tone="warning">{t("compliance.coverage.needMore", { n: r.shortage })}</Badge>
                        ) : (
                          <Badge tone="success">{t("compliance.coverage.ok")}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title={t("compliance.coverage.publicDisplay")}>
            {!c.publicDisplay ? (
              <p className="text-[13px] text-muted">{t("compliance.coverage.displayNa")}</p>
            ) : (
              <div className="flex flex-col gap-2 text-[13px]">
                <p>
                  {t("compliance.coverage.displayLine", {
                    area: num(c.publicDisplay.scopeAreaM2),
                    required: c.publicDisplay.required,
                    links: c.publicDisplay.actual.links,
                    qr: c.publicDisplay.actual.qr,
                    shortage: c.publicDisplay.shortage,
                  })}
                </p>
                {!c.publicDisplay.actualAvailable && <Alert tone="info">{t("compliance.coverage.displayPending")}</Alert>}
                {c.publicDisplay.recommendations.length > 0 && (
                  <p>{t("compliance.coverage.recommend", { spaces: c.publicDisplay.recommendations.map((r) => `${r.name}(${num(r.areaM2)}㎡)`).join(", ") })}</p>
                )}
              </div>
            )}
          </Card>

          <Card title={t("compliance.coverage.calibration")}>
            {c.calibration.length === 0 ? (
              <p className="text-[13px] text-muted">{t("compliance.coverage.noDevices")}</p>
            ) : (
              <Form method="post" className="flex flex-col gap-3">
                <CsrfField />
                <input type="hidden" name="idempotencyKey" value={loaderData.idempotencyKey} />
                {result?.noDevices && <Alert tone="warning">{t("compliance.coverage.pickDevices")}</Alert>}
                <Table>
                  <thead>
                    <tr>
                      {canOrder && <th className="w-8" />}
                      <th>{t("compliance.coverage.col.device")}</th>
                      <th>{t("compliance.coverage.col.model")}</th>
                      <th>{t("compliance.coverage.col.interval")}</th>
                      <th>{t("compliance.coverage.col.last")}</th>
                      <th>{t("compliance.coverage.col.elapsed")}</th>
                      <th>{t("compliance.coverage.col.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.calibration.map((r) => (
                      <tr key={r.device.id} data-calibration={r.device.id}>
                        {canOrder && (
                          <td>
                            <input type="checkbox" name="deviceIds" value={r.device.id} defaultChecked={r.status === "OVERDUE"} aria-label={r.device.name} />
                          </td>
                        )}
                        <td>
                          <Link className="text-accent hover:underline" to={`/devices/${r.device.id}`}>
                            {r.device.name}
                          </Link>
                          {r.space && <span className="ml-1 text-[12px] text-muted">{r.space.name}</span>}
                        </td>
                        <td>{r.model ?? "–"}</td>
                        <td>{t("compliance.coverage.days", { n: r.intervalDays })}</td>
                        <td>{r.lastCalibratedOn ?? "–"}</td>
                        <td>{r.elapsedDays === null || r.elapsedDays === undefined ? "–" : t("compliance.coverage.days", { n: r.elapsedDays })}</td>
                        <td>
                          <Badge tone={calibrationTone(r.status)}>{t(`compliance.coverage.calibrationStatus.${r.status}`)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {canOrder && (
                  <div>
                    <Button type="submit" variant="primary" disabled={navigation.state === "submitting"}>
                      {t("compliance.coverage.createWorkOrder")}
                    </Button>
                  </div>
                )}
              </Form>
            )}
          </Card>

          <Card title={t("compliance.coverage.quality")}>
            <p className="mb-2 text-[12.5px] text-muted">{t("compliance.coverage.qualityPeriod", { from: c.period.from, to: c.period.to })}</p>
            {c.quality.length === 0 ? (
              <p className="text-[13px] text-muted">{t("compliance.coverage.noDevices")}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>{t("compliance.coverage.col.space")}</th>
                    <th>{t("compliance.coverage.col.devices")}</th>
                    <th>{t("compliance.coverage.col.missing")}</th>
                    <th>{t("compliance.coverage.col.intervalViolations")}</th>
                    <th>{t("compliance.coverage.col.abnormal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.quality.map((r) => (
                    <tr key={r.space.id} data-quality={r.space.id}>
                      <td>{r.space.name}</td>
                      <td>{r.devices}</td>
                      <td>
                        {r.missingRatio === null || r.missingRatio === undefined ? "–" : `${num(r.missingRatio, 1)}%`}
                        {r.belowStandard && (
                          <span className="ml-2">
                            <Badge tone="danger">{t("compliance.coverage.belowStandard")}</Badge>
                          </span>
                        )}
                      </td>
                      <td>{r.intervalViolations > 0 ? <Badge tone="warning">{t("compliance.coverage.violations", { n: r.intervalViolations })}</Badge> : 0}</td>
                      <td>{r.abnormalQualityRatio === null || r.abnormalQualityRatio === undefined ? "–" : `${num(r.abnormalQualityRatio, 1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
