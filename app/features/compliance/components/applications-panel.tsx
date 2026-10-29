/**
 * UI-CMP-04 프로필 적용 범위(프로필 상세 [적용 범위] 탭): 적용 목록·측정 가능성·적용 추가·해제(CMP-01.03·01.04).
 * 국내법처럼 시설 유형이 필요한 프로필은 유형을 골라야 한다(CMP_FACILITY_TYPE_REQUIRED).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Badge, Button, Card, Checkbox, CsrfField, EmptyState, SelectField, Table } from "~/components/ui";
import { SpaceSelect } from "~/components/space-picker";
import { formatDate } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import { TARGET_TYPES, type Application, type MeasurabilityItem } from "../model/types";

export const SPACE_USAGES = ["CLASSROOM", "OFFICE", "MEETING", "LAB", "CORRIDOR", "OTHER"];

const STATUS_TONE = { MEASURABLE: "success", PARTIAL: "warning", NOT_MEASURABLE: "danger" } as const;

function targetLabel(t: (k: string, o?: Record<string, unknown>) => string, a: Application) {
  if (a.targetType === "SPACE_USAGE") return t("compliance.apply.usageTarget", { usage: t(`spaces.usage.${a.targetUsage}`, { defaultValue: a.targetUsage ?? "" }) });
  return a.targetName ?? a.targetSpaceId ?? "";
}

export function ApplicationsPanel({
  applications,
  measurability,
  spaces,
  facilityTypes,
  facilityRequired,
  currentVersion,
  canAdmin,
  archived,
  timezone,
  fieldErrors = {},
}: {
  applications: Application[];
  measurability: Record<string, MeasurabilityItem[]>;
  spaces: SpaceNode[];
  facilityTypes: string[];
  facilityRequired: boolean;
  currentVersion: number;
  canAdmin: boolean;
  archived: boolean;
  timezone: string;
  fieldErrors?: Record<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const [targetType, setTargetType] = useState<string>("SPACE");
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {applications.length === 0 ? (
        <EmptyState title={t("compliance.apply.empty")} body={t("compliance.apply.emptyBody")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("compliance.apply.target")}</th>
              <th>{t("compliance.apply.descendants")}</th>
              <th>{t("compliance.apply.facilityType")}</th>
              <th>{t("compliance.apply.version")}</th>
              <th>{t("compliance.apply.appliedAt")}</th>
              <th>{t("compliance.apply.measurability")}</th>
              {canAdmin && <th aria-label={t("compliance.list.actions")} />}
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.applicationId} data-application={a.applicationId}>
                <td>
                  {targetLabel(t, a)} <Badge tone="neutral">{t(`compliance.apply.type.${a.targetType}`)}</Badge>
                </td>
                <td>{a.includeDescendants ? t("common.yes") : t("common.no")}</td>
                <td>{a.facilityType ? t(`compliance.facility.${a.facilityType}`, { defaultValue: a.facilityType }) : "-"}</td>
                <td>{a.pinnedVersionNo ? t("compliance.apply.pinned", { n: a.pinnedVersionNo }) : t("compliance.apply.latest", { n: a.versionNo })}</td>
                <td className="whitespace-nowrap">{formatDate(a.appliedAt, timezone, i18n.language)}</td>
                <td>
                  <MeasurabilityList items={measurability[a.applicationId]} summary={a.measurability} />
                </td>
                {canAdmin && (
                  <td>
                    <Form method="post">
                      <CsrfField />
                      <input type="hidden" name="intent" value="unapply" />
                      <input type="hidden" name="applicationId" value={a.applicationId} />
                      <Button type="submit">{t("compliance.apply.remove")}</Button>
                    </Form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {canAdmin && !archived && !adding && (
        <div>
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t("compliance.apply.add")}
          </Button>
        </div>
      )}
      {canAdmin && archived && <p className="text-[12.5px] text-muted">{t("compliance.apply.archivedNote")}</p>}
      {canAdmin && !archived && adding && (
        <Card title={t("compliance.apply.add")}>
          <Form method="post" className="flex flex-col gap-3">
            <CsrfField />
            <input type="hidden" name="intent" value="apply" />
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-[12.5px] font-medium">{t("compliance.apply.targetType")}</legend>
              {TARGET_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-1.5 text-[13px]">
                  <input type="radio" name="targetType" value={type} checked={targetType === type} onChange={() => setTargetType(type)} />
                  {t(`compliance.apply.type.${type}`)}
                </label>
              ))}
            </fieldset>
            {targetType === "SPACE_USAGE" ? (
              <SelectField label={t("compliance.apply.usage")} name="targetUsage" defaultValue="CLASSROOM">
                {SPACE_USAGES.map((u) => (
                  <option key={u} value={u}>
                    {t(`spaces.usage.${u}`)}
                  </option>
                ))}
              </SelectField>
            ) : (
              <SpaceSelect spaces={spaces} name="targetSpaceId" label={t("compliance.apply.space")} emptyLabel={t("compliance.apply.chooseSpace")} error={fieldErrors.targetSpaceId ? t("compliance.validation.spaceRequired") : undefined} />
            )}
            {targetType === "SPACE" && <Checkbox name="includeDescendants" value="true" defaultChecked label={t("compliance.apply.includeDescendants")} />}
            {facilityTypes.length > 0 && (
              <SelectField label={t("compliance.apply.facilityType")} name="facilityType" defaultValue="" error={fieldErrors.facilityType ? t("compliance.validation.facilityRequired") : undefined}>
                <option value="">{facilityRequired ? t("compliance.apply.chooseFacility") : t("common.all")}</option>
                {facilityTypes.map((f) => (
                  <option key={f} value={f}>
                    {t(`compliance.facility.${f}`, { defaultValue: f })}
                  </option>
                ))}
              </SelectField>
            )}
            <Checkbox name="pinVersion" value={String(currentVersion)} label={t("compliance.apply.pin", { n: currentVersion })} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary">
                {t("compliance.apply.submit")}
              </Button>
            </div>
          </Form>
        </Card>
      )}
    </div>
  );
}

/** 항목별 측정 가능성(API-CMP-08). 상세가 없으면 요약 수만 */
export function MeasurabilityList({ items, summary }: { items?: MeasurabilityItem[]; summary: Application["measurability"] }) {
  const { t } = useTranslation();
  if (!items) return <span className="text-[12.5px]">{t("compliance.apply.summary", summary)}</span>;
  return (
    <ul className="flex flex-col gap-0.5 text-[12.5px]">
      {items.map((m) => (
        <li key={m.metricKey} data-measurability={m.metricKey}>
          <Badge tone={STATUS_TONE[m.status]}>{t(`compliance.measurability.${m.status}`)}</Badge> {m.metricKey}
          {m.status === "PARTIAL" && m.spacesWithout && m.spacesWithout.length > 0 && <span className="text-muted"> — {t("compliance.measurability.without", { names: m.spacesWithout.map((s) => s.name).join(", ") })}</span>}
        </li>
      ))}
    </ul>
  );
}
