/**
 * 기기 메뉴 하위 탭(00-navigation.md §2 기기): 전체 기기, 승인 대기(대기 수 배지), 기기 모델, 측정 항목, 그룹, 일괄 작업(UI-DEV-12, M4).
 */
import { useTranslation } from "react-i18next";
import { Tabs } from "~/components/ui";

export type DeviceArea = "all" | "pending" | "models" | "metrics" | "groups" | "jobs";

export function DeviceAreaTabs({ current, pendingCount }: { current: DeviceArea; pendingCount?: number | null }) {
  const { t } = useTranslation();
  const pending = pendingCount ? `${t("devices.area.pending")} (${pendingCount})` : t("devices.area.pending");
  return (
    <Tabs
      current={current}
      items={[
        { key: "all", label: t("devices.area.all"), to: "/devices" },
        { key: "pending", label: pending, to: "/devices/pending" },
        { key: "models", label: t("devices.area.models"), to: "/models" },
        { key: "metrics", label: t("devices.area.metrics"), to: "/metrics" },
        { key: "groups", label: t("devices.area.groups"), to: "/device-groups" },
        { key: "jobs", label: t("devices.area.jobs"), to: "/device-jobs" },
      ]}
    />
  );
}
