/**
 * UI-ENE-04 기준선 설정(대시보드 범위의 [기준선] 탭, ENE-01.04, UC-ENE-04). 조회 ENE_READ, 계산·적용 ENE_ANALYZE.
 * 결과 패널(방식·기간·R²·계수 표·실측 vs 예측, R² < 0.5 경고), 버전 목록([적용]), 계산 폼(방식·학습 기간·냉방/난방 기준 온도·평일/주말 분리·기온 원천).
 * 409 ENE_BASELINE_INSUFFICIENT_DATA면 "N일 더 필요"를 보여 준다(TC-ENE-028).
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useRouteLoaderData } from "react-router";
import { EChartView } from "~/components/charts/echart-view";
import { Alert, Badge, Button, Card, Checkbox, CsrfField, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatNumber } from "~/lib/format";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import { METHODS, lowFit, neededDaysOf, residualOption, type BaselineDetail, type BaselineForm, type BaselineSummary, type BaselineVersion } from "../model/baseline";

export interface BaselineFailure {
  code: string;
  message?: string;
  errors?: { field?: string; code?: string; message?: string }[];
}

export interface BaselineSettingsProps {
  scopeSpaceId: string;
  baseline: BaselineSummary | null;
  versions: BaselineVersion[];
  detail: BaselineDetail | null;
  devices: { id: string; name: string }[];
  defaults: { trainFrom: string; trainTo: string };
  /** 버전 상세 링크(?version=) */
  versionHref: (versionId: string) => string;
  error?: BaselineFailure | null;
  fieldErrors?: Record<string, string>;
  values?: Partial<BaselineForm>;
}

const STATUS_TONE = { TRAINING: "info", READY: "success", FAILED: "danger", ACTIVE: "success", RETIRED: "neutral" } as const;
const COEFFICIENTS = ["intercept", "cdd", "hdd", "weekend"] as const;

export function BaselineSettings({ scopeSpaceId, baseline, versions, detail, devices, defaults, versionHref, error, fieldErrors = {}, values }: BaselineSettingsProps) {
  const { t, i18n } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const canAnalyze = hasAny(root?.me?.permissions, ["ENE_ANALYZE"]);
  const lang = i18n.language;
  const num = (v: number | null | undefined, precision = 0) => formatNumber(v, lang, { precision });
  const needed = neededDaysOf(error);
  const fe = (key: string) => (fieldErrors[key] ? t(`energy.baseline.errors.${fieldErrors[key]}`) : undefined);
  const residuals = useMemo(() => detail?.residuals ?? [], [detail]);
  const option = useCallback(
    (dark: boolean) => residualOption(residuals, { actual: t("energy.baseline.actual"), predicted: t("energy.baseline.predicted"), unit: "kWh" }, dark),
    [residuals, t],
  );
  const v = values ?? {};
  return (
    <div className="flex flex-col gap-4" data-baseline-scope={scopeSpaceId}>
      {error && <Alert tone="danger">{needed ? t("energy.baseline.needed", { n: needed }) : errorText(t, error)}</Alert>}
      {baseline?.activeVersion ? (
        <p className="text-[12.5px] text-muted" data-active>
          {t("energy.baseline.activeSummary", {
            method: t(`energy.baseline.methods.${baseline.activeVersion.method}`),
            from: baseline.activeVersion.trainFrom,
            to: baseline.activeVersion.trainTo,
            r2: num(baseline.activeVersion.r2, 3),
          })}
        </p>
      ) : (
        <Alert tone="info">{t("energy.baseline.noActive")}</Alert>
      )}

      {detail && (
        <Card title={t("energy.baseline.result")}>
          <div className="flex flex-col gap-3 p-3" data-version={detail.versionId}>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span>{t(`energy.baseline.methods.${detail.method}`)}</span>
              <span className="text-muted">
                {detail.trainFrom} ~ {detail.trainTo}
              </span>
              <span>R² {num(detail.r2, 3)}</span>
              <Badge tone={STATUS_TONE[detail.status]}>{t(`energy.baseline.statuses.${detail.status}`)}</Badge>
              {lowFit(detail) && <Badge tone="warning">{t("energy.baseline.lowFit")}</Badge>}
            </div>
            {detail.status === "FAILED" && (
              <Alert tone="warning">
                {detail.errorCode === "INSUFFICIENT_DATA" && detail.neededDays
                  ? t("energy.baseline.needed", { n: detail.neededDays })
                  : t(`energy.baseline.failures.${detail.errorCode ?? "INTERNAL_ERROR"}`, { defaultValue: t("energy.baseline.failures.INTERNAL_ERROR") })}
              </Alert>
            )}
            {detail.status === "TRAINING" && <Alert tone="info">{t("energy.baseline.training")}</Alert>}
            {detail.coefficients && (
              <Table>
                <thead>
                  <tr>
                    {COEFFICIENTS.map((c) => (
                      <th key={c}>{t(`energy.baseline.coefficients.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {COEFFICIENTS.map((c) => (
                      <td key={c}>{num(detail.coefficients?.[c], 2)}</td>
                    ))}
                  </tr>
                </tbody>
              </Table>
            )}
            {residuals.length > 0 && <EChartView option={option} height={220} label={t("energy.baseline.fitChart")} />}
          </div>
        </Card>
      )}

      <Card title={t("energy.baseline.versions")}>
        {versions.length === 0 ? (
          <div className="p-3">
            <EmptyState title={t("energy.baseline.noVersions")} />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("energy.baseline.columns.method")}</th>
                <th>{t("energy.baseline.columns.period")}</th>
                <th>R²</th>
                <th>{t("energy.baseline.columns.status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((row) => (
                <tr key={row.versionId} data-version-row={row.versionId}>
                  <td>
                    <Link to={versionHref(row.versionId)} className="text-accent">
                      {t(`energy.baseline.methods.${row.method}`)}
                    </Link>
                  </td>
                  <td>
                    {row.trainFrom} ~ {row.trainTo}
                  </td>
                  <td>
                    {num(row.r2, 3)} {lowFit(row) && <Badge tone="warning">{t("energy.baseline.lowFit")}</Badge>}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[row.status]}>{t(`energy.baseline.statuses.${row.status}`)}</Badge>
                  </td>
                  <td>
                    {canAnalyze && row.status === "READY" && (
                      <Form method="post">
                        <CsrfField />
                        <input type="hidden" name="intent" value="activateBaseline" />
                        <input type="hidden" name="versionId" value={row.versionId} />
                        <Button type="submit">{t("energy.baseline.activate")}</Button>
                      </Form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {canAnalyze && (
        <Card title={t("energy.baseline.create")}>
          <Form method="post" className="flex flex-col gap-3 p-3">
            <CsrfField />
            <input type="hidden" name="intent" value="createBaseline" />
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField label={t("energy.baseline.method")} name="method" defaultValue={v.method ?? "DEGREE_DAY_REGRESSION"} error={fe("method")}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`energy.baseline.methods.${m}`)}
                  </option>
                ))}
              </SelectField>
              <TextField label={t("energy.baseline.trainFrom")} type="date" name="trainFrom" defaultValue={v.trainFrom ?? defaults.trainFrom} error={fe("trainFrom")} />
              <TextField label={t("energy.baseline.trainTo")} type="date" name="trainTo" defaultValue={v.trainTo ?? defaults.trainTo} error={fe("trainTo")} />
              <TextField label={t("energy.baseline.coolingBaseC")} name="coolingBaseC" inputMode="decimal" defaultValue={v.coolingBaseC ?? "24"} error={fe("coolingBaseC")} />
              <TextField label={t("energy.baseline.heatingBaseC")} name="heatingBaseC" inputMode="decimal" defaultValue={v.heatingBaseC ?? "18"} error={fe("heatingBaseC")} />
              <div className="flex items-end pb-2">
                <Checkbox label={t("energy.baseline.splitWeekday")} name="splitWeekday" value="true" defaultChecked={v.splitWeekday ?? true} />
              </div>
              <SelectField label={t("energy.baseline.temperatureDevice")} name="temperatureDeviceId" defaultValue={v.temperatureDeviceId ?? ""} error={fe("temperatureDeviceId")}>
                <option value="">{t("energy.baseline.noTemperature")}</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </SelectField>
              <TextField label={t("energy.baseline.temperatureMetric")} name="temperatureMetricKey" defaultValue={v.temperatureMetricKey ?? "temperature"} />
            </div>
            <p className="text-[12px] text-muted">{t("energy.baseline.hint")}</p>
            <div>
              <Button type="submit" variant="primary">
                {t("energy.baseline.calculate")}
              </Button>
            </div>
          </Form>
        </Card>
      )}
    </div>
  );
}
