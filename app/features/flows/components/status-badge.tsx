/** 플로우 상태 배지(UI-FLW-01·02). 색만으로 구분하지 않도록 글자를 함께 쓴다 */
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui";

const TONE: Record<string, "success" | "danger" | "warning" | "neutral" | "info"> = { ACTIVE: "success", DEGRADED: "danger", PAUSED: "warning", DRAFT: "info", DISABLED: "neutral", DELETED: "neutral" };

export function FlowStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge tone={TONE[status] ?? "neutral"}>{t(`flows.status.${status}`, { defaultValue: status })}</Badge>;
}
