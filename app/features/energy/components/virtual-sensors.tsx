/**
 * UI-ENE-05 가상 센서(공간 상세 [가상 센서] 탭, ENE-02.01, UC-ENE-06). 조회 ENE_READ, 켜기·설정 ENE_ADMIN.
 * 환기율(ACH) 카드: 계산식·입력 항목·마지막 계산 시각·부피, 최근 ACH·환기량·신뢰 구간과 일별 차트("추정치" 배지), 실외 CO2 기준·최소 감쇠 구간 설정, [켜기]·[끄기].
 * 409 ENE_SPACE_VOLUME_REQUIRED면 "공간 면적과 층고를 입력하세요"와 공간 속성 탭 링크(TC-ENE-048)
 * 재실 추정 카드(ENE-02.02, UC-ENE-07): 입력 신호 선택(PIR·CO2·소음·조도 중 2개 이상), 현재 상태(사용 중/비어 있음), 정확도 메모,
 * 최근 24시간 타임라인. 인원 숫자는 어디에도 보이지 않는다(BR-ENE-10, TC-ENE-042)
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useRouteLoaderData } from "react-router";
import { EChartView } from "~/components/charts/echart-view";
import type { ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Badge, Button, Card, Checkbox, CsrfField, EmptyState, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import {
  achFormOf,
  achOption,
  failureKind,
  latest,
  OCCUPANCY_SIGNALS,
  occupancyOption,
  occupancySignalsOf,
  type AchForm,
  type AchSeries,
  type OccupancySeries,
  type SensorView,
} from "../model/virtual-sensors";

export interface VirtualSensorFailure {
  code: string;
  message?: string;
  errors?: { field?: string; code?: string; message?: string }[];
}

export interface VirtualSensorTabProps {
  spaceId: string;
  sensors: SensorView[] | null;
  ach: AchSeries | null;
  occupancy?: OccupancySeries | null;
  error?: VirtualSensorFailure | null;
  fieldErrors?: Record<string, string>;
  values?: Partial<AchForm> & { kind?: string; signals?: string[] };
  saved?: boolean;
  chartFactory?: ChartFactory;
}

const STATUS_TONE = { OK: "success", INPUT_MISSING: "warning", DISABLED: "neutral" } as const;

const OCC_TONE = { OCCUPIED: "info", VACANT: "neutral", UNKNOWN: "warning" } as const;

export function VirtualSensorTab({ spaceId, sensors, ach, occupancy, error, fieldErrors = {}, values, saved, chartFactory }: VirtualSensorTabProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canEdit = hasAny(root?.me?.permissions, ["ENE_ADMIN"]);
  const timezone = root?.timezone ?? "Asia/Seoul";
  const lang = i18n.language;
  const items = useMemo(() => ach?.items ?? [], [ach]);
  const option = useCallback((dark: boolean) => achOption(items, { ach: t("energy.virtual.ach.value"), ci: t("energy.virtual.ach.ci") }, dark), [items, t]);
  const occItems = useMemo(() => occupancy?.items ?? [], [occupancy]);
  const occOption = useCallback(
    (dark: boolean) =>
      occupancyOption(occItems, { occupied: t("energy.virtual.occupancy.state.OCCUPIED"), vacant: t("energy.virtual.occupancy.state.VACANT"), series: t("energy.virtual.occupancy.series") }, dark),
    [occItems, t],
  );
  if (!sensors) return <Alert tone="danger">{t("energy.virtual.loadFailed")}</Alert>;
  const sensor = sensors.find((s) => s.kind === "ACH") ?? null;
  const failure = failureKind(error);
  const form = { ...achFormOf(sensor), ...values };
  const last = latest(ach);
  const num = (v: number | null | undefined, precision: number) => formatNumber(v, lang, { precision });
  const fe = (key: string) => (fieldErrors[key] ? t(`energy.virtual.errors.${fieldErrors[key]}`) : undefined);
  const status = sensor?.status ?? "DISABLED";
  const occ = sensors.find((s) => s.kind === "OCCUPANCY") ?? null;
  const occStatus = occ?.status ?? "DISABLED";
  const occSignals = values?.kind === "occupancy" && values.signals ? values.signals : occupancySignalsOf(occ);
  const occInputs = new Map((occ?.inputs ?? []).map((i) => [i.signal ?? i.metricKey, i]));
  const current = occ?.current ?? null;
  return (
    <div className="flex flex-col gap-4" data-virtual-space={spaceId}>
      {saved && <Alert tone="success">{t("energy.virtual.saved")}</Alert>}
      {failure?.kind === "volume" ? (
        <Alert tone="danger">
          <span>{t("errors.ENE_SPACE_VOLUME_REQUIRED")}</span>{" "}
          <Link to={`/spaces/${encodeURIComponent(spaceId)}?tab=props`} className="text-accent underline">
            {t("energy.virtual.editSpace")}
          </Link>
        </Alert>
      ) : failure?.kind === "input" ? (
        <Alert tone="danger">{t("energy.virtual.inputMissing", { metrics: failure.missing.map((m) => t(`energy.virtual.metric.${m}`, { defaultValue: m })).join(", ") })}</Alert>
      ) : (
        error && <Alert tone="danger">{errorText(t, error)}</Alert>
      )}
      <Card
        title={
          <span className="flex items-center gap-2">
            {t("energy.virtual.ach.title")} <Badge tone="info">{t("energy.virtual.estimated")}</Badge>
          </span>
        }
        actions={<Badge tone={STATUS_TONE[status]}>{t(`energy.virtual.status.${status}`)}</Badge>}
      >
        <div className="flex flex-col gap-3" data-sensor="ACH">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-muted">{t("energy.virtual.formula")}</dt>
            <dd data-formula>{t("energy.virtual.ach.formula")}</dd>
            <dt className="text-muted">{t("energy.virtual.inputs")}</dt>
            <dd data-inputs>
              {(sensor?.inputs ?? [{ metricKey: "co2", available: false, deviceIds: [] }]).map((i) => (
                <span key={i.metricKey} className="mr-3">
                  {t(`energy.virtual.metric.${i.metricKey}`, { defaultValue: i.metricKey })}: {i.available ? t("energy.virtual.devices", { n: i.deviceIds.length }) : t("energy.virtual.noDevice")}
                </span>
              ))}
            </dd>
            <dt className="text-muted">{t("energy.virtual.volume")}</dt>
            <dd>
              {sensor?.volumeM3 != null ? (
                `${num(sensor.volumeM3, 1)} ㎥`
              ) : (
                <Link to={`/spaces/${encodeURIComponent(spaceId)}?tab=props`} className="text-accent underline">
                  {t("energy.virtual.volumeMissing")}
                </Link>
              )}
            </dd>
            <dt className="text-muted">{t("energy.virtual.lastComputed")}</dt>
            <dd data-last-computed>{sensor?.lastComputedAt ? formatDateTime(sensor.lastComputedAt, timezone, lang) : t("energy.virtual.notYet")}</dd>
          </dl>
          {last ? (
            <div className="flex flex-wrap gap-6 text-[13px]" data-latest={last.day}>
              <span>
                {t("energy.virtual.ach.latest", { day: last.day })} <strong>{`${num(last.ach, 2)} 1/h`}</strong>
              </span>
              <span>
                {t("energy.virtual.ach.ventilation")} <strong>{last.ventilationM3h != null ? `${num(last.ventilationM3h, 0)} ㎥/h` : "-"}</strong>
              </span>
              {last.ciLow != null && last.ciHigh != null && <span>{t("energy.virtual.ach.ciRange", { low: num(last.ciLow, 2), high: num(last.ciHigh, 2) })}</span>}
            </div>
          ) : (
            sensor?.enabled && <EmptyState title={t("energy.virtual.ach.empty")} />
          )}
          {items.length > 0 && <EChartView option={option} height={200} factory={chartFactory} label={t("energy.virtual.ach.chart")} />}
          {canEdit && (
            <Form method="post" className="flex flex-wrap items-end gap-3" noValidate>
              <CsrfField />
              <input type="hidden" name="intent" value="virtualSensor" />
              <input type="hidden" name="kind" value="ach" />
              <TextField label={t("energy.virtual.ach.outdoor")} name="outdoorCo2Ppm" type="number" min={300} max={600} step="1" defaultValue={form.outdoorCo2Ppm} error={fe("outdoorCo2Ppm")} />
              <TextField label={t("energy.virtual.ach.minDecay")} name="minDecayMinutes" type="number" min={15} max={240} step="1" defaultValue={form.minDecayMinutes} error={fe("minDecayMinutes")} />
              <Button type="submit" name="enabled" value="true" variant="primary">
                {sensor?.enabled ? t("energy.virtual.save") : t("energy.virtual.enable")}
              </Button>
              {sensor?.enabled && (
                <Button type="submit" name="enabled" value="false">
                  {t("energy.virtual.disable")}
                </Button>
              )}
            </Form>
          )}
        </div>
      </Card>
      <Card
        title={
          <span className="flex items-center gap-2">
            {t("energy.virtual.occupancy.title")} <Badge tone="info">{t("energy.virtual.estimated")}</Badge>
          </span>
        }
        actions={<Badge tone={STATUS_TONE[occStatus]}>{t(`energy.virtual.status.${occStatus}`)}</Badge>}
      >
        <div className="flex flex-col gap-3" data-sensor="OCCUPANCY">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-muted">{t("energy.virtual.formula")}</dt>
            <dd data-formula>{t("energy.virtual.occupancy.formula")}</dd>
            <dt className="text-muted">{t("energy.virtual.inputs")}</dt>
            <dd data-inputs>
              {OCCUPANCY_SIGNALS.filter((sig) => occSignals.includes(sig)).map((sig) => {
                const i = occInputs.get(sig);
                return (
                  <span key={sig} className="mr-3">
                    {t(`energy.virtual.metric.${sig}`)}: {i?.available ? t("energy.virtual.devices", { n: i.deviceIds.length }) : t("energy.virtual.noDevice")}
                  </span>
                );
              })}
            </dd>
            <dt className="text-muted">{t("energy.virtual.lastComputed")}</dt>
            <dd data-last-computed>{occ?.lastComputedAt ? formatDateTime(occ.lastComputedAt, timezone, lang) : t("energy.virtual.notYet")}</dd>
          </dl>
          {occ?.enabled && current && (
            <div className="flex flex-wrap items-center gap-3 text-[13px]" data-occupancy-state={current.state}>
              <span>{t("energy.virtual.occupancy.now")}</span>
              <Badge tone={OCC_TONE[current.state]}>{t(`energy.virtual.occupancy.state.${current.state}`)}</Badge>
              {current.band && <span>{t("energy.virtual.occupancy.band", { band: current.band })}</span>}
              {current.at && <span className="text-muted">{formatDateTime(current.at, timezone, lang)}</span>}
            </div>
          )}
          <p className="text-[12px] text-muted" data-accuracy>
            {t("energy.virtual.occupancy.accuracy")}
          </p>
          {occItems.length > 0 && <EChartView option={occOption} height={160} factory={chartFactory} label={t("energy.virtual.occupancy.chart")} />}
          {canEdit && (
            <Form method="post" className="flex flex-col gap-3" noValidate>
              <CsrfField />
              <input type="hidden" name="intent" value="virtualSensor" />
              <input type="hidden" name="kind" value="occupancy" />
              <fieldset className="flex flex-wrap gap-4">
                <legend className="mb-1 text-[13px] text-muted">{t("energy.virtual.occupancy.signals")}</legend>
                {OCCUPANCY_SIGNALS.map((sig) => (
                  <Checkbox
                    key={sig}
                    name="signals"
                    value={sig}
                    defaultChecked={occSignals.includes(sig)}
                    label={`${t(`energy.virtual.metric.${sig}`)}${occInputs.get(sig)?.available === false ? ` (${t("energy.virtual.noDevice")})` : ""}`}
                  />
                ))}
              </fieldset>
              {values?.kind === "occupancy" && fe("signals") && (
                <p className="text-[12px] text-danger" role="alert">
                  {fe("signals")}
                </p>
              )}
              <div className="flex gap-3">
                <Button type="submit" name="enabled" value="true" variant="primary">
                  {occ?.enabled ? t("energy.virtual.save") : t("energy.virtual.enable")}
                </Button>
                {occ?.enabled && (
                  <Button type="submit" name="enabled" value="false">
                    {t("energy.virtual.disable")}
                  </Button>
                )}
              </div>
            </Form>
          )}
        </div>
      </Card>
    </div>
  );
}
