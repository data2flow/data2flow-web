/** 규칙 상태 배지(UI-RUL-01): ERROR는 붉은 배지 + 사유, ACTIVE 초록, INACTIVE 회색 */
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui";
import type { RuleStatus } from "../model/types";

export function RuleStatusBadge({ status, reason }: { status: RuleStatus | string; reason?: string | null }) {
  const { t } = useTranslation();
  const tone = status === "ERROR" ? "danger" : status === "ACTIVE" ? "success" : "neutral";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={tone}>{t(`rules.status.${status}`, { defaultValue: status })}</Badge>
      {status === "ERROR" && reason && <span className="text-[12px] text-bad-ink">{t(`rules.errorReasons.${reason}`, { defaultValue: reason })}</span>}
    </span>
  );
}
