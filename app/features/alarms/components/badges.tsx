/**
 * 알람 공용 표시(UI-RUL-04·05, 홈·기기 상세 등 다른 화면에서도 쓴다): 심각도 배지, 상태 칩(플래핑·하위 N건·억제 사유).
 * 색만으로 구분하지 않도록 글자를 함께 쓴다(DSH-07).
 */
import { useTranslation } from "react-i18next";
import { Badge, StatusDot } from "~/components/ui";
import type { Alarm, AlarmStatus, Severity } from "../model/alarms";

const SEVERITY_TONE: Record<Severity, "bad" | "warn" | "accent" | "muted"> = { CRITICAL: "bad", MAJOR: "bad", MINOR: "warn", WARNING: "warn", INFO: "accent" };
const STATUS_TONE: Record<AlarmStatus, "danger" | "warning" | "info" | "success" | "neutral"> = { ACTIVE: "danger", ACKNOWLEDGED: "warning", SUPPRESSED: "neutral", CLEARED: "success" };

export function SeverityBadge({ severity, short = false }: { severity: Severity | string; short?: boolean }) {
  const { t } = useTranslation();
  const tone = SEVERITY_TONE[severity as Severity] ?? "muted";
  return (
    <span className={severity === "CRITICAL" ? "font-semibold text-bad" : undefined} data-severity={severity}>
      <StatusDot tone={tone} label={short ? t(`alarms.severityShort.${severity}`, { defaultValue: severity }) : t(`alarms.severity.${severity}`, { defaultValue: severity })} />
    </span>
  );
}

export function AlarmStatusChip({ alarm }: { alarm: Pick<Alarm, "status" | "flapping" | "childCount" | "suppressedReason"> }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={STATUS_TONE[alarm.status] ?? "neutral"}>{t(`alarms.status.${alarm.status}`, { defaultValue: alarm.status })}</Badge>
      {alarm.flapping && <Badge tone="warning">{t("alarms.flapping")}</Badge>}
      {(alarm.childCount ?? 0) > 0 && <Badge tone="neutral">{t("alarms.children", { n: alarm.childCount })}</Badge>}
      {alarm.status === "SUPPRESSED" && alarm.suppressedReason && <Badge tone="neutral">{t(`alarms.suppressed.${alarm.suppressedReason}`, { defaultValue: alarm.suppressedReason })}</Badge>}
    </span>
  );
}
