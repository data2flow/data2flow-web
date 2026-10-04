/**
 * 수집 화면 공용 부품: 수집 구역 탭(모니터·소스·스크립트·실패 메시지), 스파크라인, 소스 상태 배지, 권한 훅.
 */
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import { Badge, StatusDot, Term, cx } from "~/components/ui";
import type { RootData } from "~/root";
import { lifecycleTone, sparklinePath, stateTone } from "../model/source";

export function usePermissions(): string[] {
  const root = useRouteLoaderData("root") as RootData | undefined;
  return root?.me?.permissions ?? [];
}

export function useTimezone(): string {
  const root = useRouteLoaderData("root") as RootData | undefined;
  return root?.timezone ?? "Asia/Seoul";
}

const SECTIONS = [
  { key: "monitor", to: "/ingest/monitor", permission: "INGEST_READ" },
  { key: "sources", to: "/sources", permission: "SRC_READ" },
  { key: "scripts", to: "/scripts", permission: "SCRIPT_READ" },
  { key: "failures", to: "/ingest/failures", permission: "INGEST_READ" },
  { key: "context", to: "/sources/context", permission: "SRC_READ" },
] as const;

/** 수집 구역 보조 탭(00-navigation §2 수집 메뉴) */
export function IngestTabs({ current }: { current: (typeof SECTIONS)[number]["key"] }) {
  const { t } = useTranslation();
  const permissions = usePermissions();
  return (
    <nav aria-label={t("sources.section.label")} className="mb-4 flex gap-1 border-b border-line">
      {SECTIONS.filter((s) => permissions.includes(s.permission)).map((s) => (
        <Link
          key={s.key}
          to={s.to}
          aria-current={s.key === current ? "page" : undefined}
          className={cx("-mb-px border-b-2 px-3 py-2 text-[13px]", s.key === current ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text")}
        >
          {t(`sources.section.${s.key}`)}
        </Link>
      ))}
    </nav>
  );
}

export function Sparkline({ values, label }: { values?: number[] | null; label: string }) {
  const path = sparklinePath(values);
  if (!path) return null;
  return (
    <svg width="60" height="16" role="img" aria-label={label} className="inline-block align-middle text-accent">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function StateBadge({ state }: { state?: string | null }) {
  const { t } = useTranslation();
  const value = state ?? "DISABLED";
  return (
    <Term term="runtimeState">
      <StatusDot tone={stateTone(value)} label={t(`sources.state.${value}`, { defaultValue: value })} />
    </Term>
  );
}

export function LifecycleBadge({ lifecycle }: { lifecycle: string }) {
  const { t } = useTranslation();
  return (
    <Term term="lifecycle">
      <Badge tone={lifecycleTone(lifecycle)}>{t(`sources.lifecycle.${lifecycle}`, { defaultValue: lifecycle })}</Badge>
    </Term>
  );
}
