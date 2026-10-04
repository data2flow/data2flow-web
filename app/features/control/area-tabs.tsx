/**
 * 제어 메뉴 하위 탭(00-navigation.md §2 제어): 장면, 명령 이력, 예약 제어, 인터락 규칙, 드라이버, 기능 카탈로그.
 * 권한이 없는 탭은 숨긴다(보조 수단, 서버가 다시 거부).
 */
import { useTranslation } from "react-i18next";
import { Tabs } from "~/components/ui";
import { hasAny } from "~/lib/permissions";

export type ControlArea = "scenes" | "commands" | "schedules" | "interlocks" | "drivers" | "capabilities";

const AREAS: { key: ControlArea; to: string; anyOf: string[] }[] = [
  { key: "scenes", to: "/control/scenes", anyOf: ["SCENE_RUN", "SCENE_MANAGE"] },
  { key: "commands", to: "/control/commands", anyOf: ["DEV_READ"] },
  { key: "schedules", to: "/control/schedules", anyOf: ["SCHEDULE_MANAGE"] },
  { key: "interlocks", to: "/control/interlocks", anyOf: ["INTERLOCK_MANAGE"] },
  { key: "drivers", to: "/control/drivers", anyOf: ["DRIVER_MANAGE"] },
  { key: "capabilities", to: "/control/capabilities", anyOf: ["DEVICE_CONTROL", "CAPABILITY_MANAGE"] },
];

export function ControlAreaTabs({ current, permissions }: { current: ControlArea; permissions: readonly string[] | undefined }) {
  const { t } = useTranslation();
  return <Tabs current={current} items={AREAS.filter((a) => hasAny(permissions, a.anyOf)).map((a) => ({ key: a.key, label: t(`control.area.${a.key}`), to: a.to }))} />;
}
