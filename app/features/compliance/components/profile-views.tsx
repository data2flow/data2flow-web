/**
 * 기준 프로필 목록·상세 부품(UI-CMP-01·02): 목록 표, 기준값 표, 버전 이력, 복제 대화상자.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Badge, Button, CsrfField, Dialog, EmptyState, Table, TextField } from "~/components/ui";
import { formatDate, formatDateTime } from "~/lib/format";
import { limitText } from "../model/format";
import type { MetricCriterion, ProfileSummary, ProfileVersion, VersionSummary } from "../model/types";

export function KindBadge({ kind }: { kind: string }) {
  const { t } = useTranslation();
  return <Badge tone={kind === "SYSTEM" ? "info" : "neutral"}>{t(`compliance.kind.${kind}`, { defaultValue: kind })}</Badge>;
}

/** UI-CMP-01 목록 표. 시스템 → 조직, 이름순(서버 정렬) */
export function ProfileTable({ profiles, timezone, canAdmin, onClone }: { profiles: ProfileSummary[]; timezone: string; canAdmin: boolean; onClone: (p: ProfileSummary) => void }) {
  const { t, i18n } = useTranslation();
  if (profiles.length === 0) return <EmptyState title={t("compliance.list.empty")} body={t("compliance.list.emptyBody")} />;
  return (
    <Table>
      <thead>
        <tr>
          <th>{t("compliance.list.name")}</th>
          <th>{t("compliance.list.kind")}</th>
          <th>{t("compliance.list.source")}</th>
          <th>{t("compliance.list.effectiveDate")}</th>
          <th>{t("compliance.list.version")}</th>
          <th>{t("compliance.list.applications")}</th>
          <th>{t("compliance.list.updatedAt")}</th>
          {canAdmin && <th aria-label={t("compliance.list.actions")} />}
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => (
          <tr key={p.profileId} data-profile={p.profileId}>
            <td>
              <Link to={`/compliance/profiles/${p.profileId}`} className="font-semibold text-accent-ink hover:underline">
                {p.name}
              </Link>
              {p.archived && (
                <span className="ml-1">
                  <Badge tone="neutral">{t("compliance.archived")}</Badge>
                </span>
              )}
            </td>
            <td>
              <KindBadge kind={p.kind} />
            </td>
            <td className="max-w-[280px] truncate" title={p.sourceTitle}>
              {p.sourceTitle}
            </td>
            <td className="whitespace-nowrap">{p.effectiveDate}</td>
            <td>v{p.currentVersionNo}</td>
            <td>{p.applicationCount}</td>
            <td className="whitespace-nowrap text-muted">{formatDate(p.updatedAt, timezone, i18n.language)}</td>
            {canAdmin && (
              <td>
                <Button type="button" onClick={() => onClone(p)}>
                  {t("compliance.clone.open")}
                </Button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** [복제해 수정](API-CMP-06): 이름을 받아 복제하고 편집 화면으로 간다 */
export function CloneDialog({ source, error, onClose }: { source: { profileId: string; name: string } | null; error?: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={Boolean(source)} onClose={onClose} title={t("compliance.clone.title")}>
      {source && (
        <Form method="post" className="flex flex-col gap-3">
          <CsrfField />
          <input type="hidden" name="intent" value="clone" />
          <input type="hidden" name="profileId" value={source.profileId} />
          <p className="text-[12.5px] text-muted">{t("compliance.clone.body", { name: source.name })}</p>
          <TextField label={t("compliance.clone.name")} name="name" defaultValue={t("compliance.clone.defaultName", { name: source.name })} maxLength={100} required error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("compliance.clone.submit")}
            </Button>
          </div>
        </Form>
      )}
    </Dialog>
  );
}

/** 목록·상세에서 함께 쓰는 복제 상태 */
export function useCloneDialog() {
  const [source, setSource] = useState<{ profileId: string; name: string } | null>(null);
  return { source, open: (p: { profileId: string; name: string }) => setSource({ profileId: p.profileId, name: p.name }), close: () => setSource(null) };
}

function bandText(m: MetricCriterion) {
  return (m.bands ?? []).map((b) => `${b.name} ${limitText(b.lower, b.upper, m.inclusive)}`).join(" · ");
}

/** UI-CMP-02 [기준값] 탭: 출처·기준일·연속 달성과 항목별 기준 */
export function CriteriaView({ version, metricNames }: { version: ProfileVersion; metricNames: Record<string, string> }) {
  const { t } = useTranslation();
  const facility = version.facilityTypes.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[120px_1fr]">
        <dt className="text-muted">{t("compliance.detail.source")}</dt>
        <dd>
          {version.sourceUrl ? (
            <a href={version.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-accent-ink hover:underline">
              {version.sourceTitle}
            </a>
          ) : (
            version.sourceTitle
          )}
        </dd>
        <dt className="text-muted">{t("compliance.detail.effectiveDate")}</dt>
        <dd>{version.effectiveDate}</dd>
        {version.streak?.days && (
          <>
            <dt className="text-muted">{t("compliance.detail.streak")}</dt>
            <dd>{t("compliance.detail.streakText", { days: version.streak.days, ratio: version.streak.dailyRatio ?? 100 })}</dd>
          </>
        )}
        {version.description && (
          <>
            <dt className="text-muted">{t("compliance.detail.description")}</dt>
            <dd>{version.description}</dd>
          </>
        )}
      </dl>
      <Table>
        <thead>
          <tr>
            <th>{t("compliance.criteria.metric")}</th>
            {facility && <th>{t("compliance.criteria.facilityType")}</th>}
            <th>{t("compliance.criteria.unit")}</th>
            <th>{t("compliance.criteria.evalWindow")}</th>
            <th>{t("compliance.criteria.limit")}</th>
            <th>{t("compliance.criteria.bands")}</th>
            <th>{t("compliance.criteria.note")}</th>
          </tr>
        </thead>
        <tbody>
          {version.metrics.map((m) => (
            <tr key={`${m.metricKey}:${m.facilityType ?? ""}`} data-metric={m.metricKey}>
              <td>
                {metricNames[m.metricKey] ?? m.metricKey}
                {m.requirement === "RECOMMENDED" && (
                  <span className="ml-1">
                    <Badge tone="neutral">{t("compliance.requirement.RECOMMENDED")}</Badge>
                  </span>
                )}
              </td>
              {facility && <td>{m.facilityType ? t(`compliance.facility.${m.facilityType}`, { defaultValue: m.facilityType }) : t("common.all")}</td>}
              <td>{m.unit}</td>
              <td>{t(`compliance.window.${m.evalWindow}`, { defaultValue: m.evalWindow })}</td>
              <td className="whitespace-nowrap font-mono">{m.requirement === "CONTINUOUS_MONITORING_ONLY" ? t("compliance.requirement.CONTINUOUS_MONITORING_ONLY") : limitText(m.lower, m.upper, m.inclusive)}</td>
              <td className="text-[12.5px]">{m.requirement === "CONTINUOUS_MONITORING_ONLY" ? "" : bandText(m)}</td>
              <td className="text-[12.5px] text-muted">{m.note}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** UI-CMP-02 [버전 이력] 탭 */
export function VersionsView({ profileId, versions, current, timezone }: { profileId: string; versions: VersionSummary[]; current: number; timezone: string }) {
  const { t, i18n } = useTranslation();
  return (
    <Table>
      <thead>
        <tr>
          <th>{t("compliance.versions.version")}</th>
          <th>{t("compliance.versions.createdBy")}</th>
          <th>{t("compliance.versions.createdAt")}</th>
          <th>{t("compliance.versions.changeNote")}</th>
          <th>{t("compliance.versions.usage")}</th>
          <th aria-label={t("compliance.list.actions")} />
        </tr>
      </thead>
      <tbody>
        {versions.map((v) => (
          <tr key={v.versionNo} data-version={v.versionNo}>
            <td>
              v{v.versionNo}
              {v.versionNo === current && (
                <span className="ml-1">
                  <Badge tone="success">{t("compliance.versions.current")}</Badge>
                </span>
              )}
              {v.locked && (
                <span className="ml-1">
                  <Badge tone="neutral">{t("compliance.versions.locked")}</Badge>
                </span>
              )}
            </td>
            <td>{v.createdBy?.name ?? t("compliance.versions.system")}</td>
            <td className="whitespace-nowrap">{formatDateTime(v.createdAt, timezone, i18n.language)}</td>
            <td>{v.changeNote}</td>
            <td>{t("compliance.versions.usageText", { applications: v.usage.applications, reports: v.usage.reports })}</td>
            <td>
              <Link to={`/compliance/profiles/${profileId}?version=${v.versionNo}`} className="text-accent-ink hover:underline">
                {t("compliance.versions.view")}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
