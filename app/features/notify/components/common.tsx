/**
 * 알림 화면 공용 부품: 규칙·알람 알림 설정 탭(정책·템플릿·무음·당직), 심각도 배지, 수신자 이름, 결과 문구.
 */
import { useTranslation } from "react-i18next";
import { Alert, Badge, Tabs } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { Recipient, Severity } from "../model/types";

export type NotifyTab = "policies" | "templates" | "silences" | "onCall";
const PATHS: Record<NotifyTab, string> = { policies: "/notifications/policies", templates: "/notifications/templates", silences: "/notifications/silences", onCall: "/notifications/on-call" };

export function NotifyTabs({ current }: { current: NotifyTab }) {
  const { t } = useTranslation();
  const items = (Object.keys(PATHS) as NotifyTab[]).map((key) => ({ key, label: t(`notify.tabs.${key}`), to: PATHS[key] }));
  return <Tabs section items={items} current={current} />;
}

const SEVERITY_TONE: Record<Severity, "danger" | "major" | "warning" | "neutral"> = { CRITICAL: "danger", MAJOR: "major", MINOR: "warning", WARNING: "warning", INFO: "neutral" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useTranslation();
  return <Badge tone={SEVERITY_TONE[severity] ?? "neutral"}>{t(`notify.severity.${severity}`)}</Badge>;
}

/** 수신자 표시 이름: 서버가 준 이름 → 회원 목록 → 역할 이름 → 종류 */
export function useRecipientLabel(users: { id: string; name: string }[] = []) {
  const { t } = useTranslation();
  return (r: Recipient) => {
    if (r.type === "USER") return r.name || users.find((u) => u.id === r.id)?.name || t("notify.recipient.userLabel", { id: r.id });
    if (r.type === "ROLE") return `${t(`notify.role.${r.id}`, { defaultValue: r.id ?? "" })} (${t("notify.recipient.ROLE")})`;
    return t(`notify.recipient.${r.type}`);
  };
}

/** action 결과 문구(성공 초록, 실패 빨강) */
export function ResultAlert({ result }: { result?: { done?: string; error?: { code: string; message?: string } } | null }) {
  const { t } = useTranslation();
  if (!result) return null;
  if (result.error)
    return (
      <div className="mb-3">
        <Alert tone="danger">{errorText(t, result.error)}</Alert>
      </div>
    );
  if (result.done)
    return (
      <div className="mb-3">
        <Alert tone="success">{t(result.done)}</Alert>
      </div>
    );
  return null;
}
