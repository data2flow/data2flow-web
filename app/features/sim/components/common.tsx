/**
 * 가상 환경 공용 부품: [가상] 보라 배지(SIM-01.01, BR-SIM-10), 구역 탭(00-navigation.md §2 "가상 환경"),
 * 실행 상태 배지, 시뮬레이션 시각·실제 시각 함께 표시(SIM screens 공통), 문제 문구.
 */
import { useTranslation } from "react-i18next";
import { Badge, Tabs } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import type { Problem } from "../model/sim";
import type { RunStatus } from "../model/types";

/** 가상 표시 배지(보라, 토큰 virt) */
export function VirtualBadge() {
  const { t } = useTranslation();
  return <Badge tone="virtual">{t("sim.virtual")}</Badge>;
}

export type SimArea = "home" | "catalog" | "profiles" | "spaces" | "scenarios" | "replay";

export function SimAreaTabs({ current }: { current: SimArea }) {
  const { t } = useTranslation();
  const items: { key: SimArea; to: string }[] = [
    { key: "home", to: "/sim" },
    { key: "catalog", to: "/sim/catalog" },
    { key: "profiles", to: "/sim/profiles" },
    { key: "spaces", to: "/sim/spaces" },
    { key: "scenarios", to: "/sim/scenarios" },
    { key: "replay", to: "/sim/replay" },
  ];
  return <Tabs section current={current} items={items.map((i) => ({ key: i.key, label: t(`sim.area.${i.key}`), to: i.to }))} />;
}

const STATUS_TONE: Record<RunStatus, "info" | "success" | "warning" | "danger" | "neutral"> = {
  CREATED: "neutral",
  RUNNING: "info",
  PAUSED: "warning",
  EVALUATING: "info",
  COMPLETED: "success",
  STOPPED: "neutral",
  FAILED: "danger",
  PURGED: "neutral",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{t(`sim.runStatus.${status}`, { defaultValue: status })}</Badge>;
}

/** 시뮬레이션 시각과 실제 시각을 나란히 */
export function Clocks({ simClock, now, timezone, lang }: { simClock: string | null | undefined; now: number; timezone: string; lang: string }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap gap-3 text-[12.5px]">
      <span>
        <span className="text-muted">{t("sim.clock.sim")}</span> <span className="font-mono">{formatDateTime(simClock, timezone, lang, true)}</span>
      </span>
      <span>
        <span className="text-muted">{t("sim.clock.wall")}</span> <span className="font-mono">{formatDateTime(new Date(now).toISOString(), timezone, lang, true)}</span>
      </span>
    </span>
  );
}

/** 문제 → 문구(`sim.validation.{key}`) */
export function useProblemText() {
  const { t } = useTranslation();
  return (problem: Problem | undefined) => (problem ? t(`sim.validation.${problem.key}`, problem.values ?? {}) : undefined);
}
