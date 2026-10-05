import { useId } from "react";
import { Link } from "react-router";

/**
 * 로고 "점에서 흐름으로": 작은 점(데이터)이 커지다가 하나의 물결로 이어진다(storyboards/README.md §3, lib.js H.logo).
 * 색은 토큰(ai2 → accent)을 따르므로 다크 테마와 조직 주 색상(DSH-13.01)에도 맞는다.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = `lg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--d2f-ai2)" }} />
          <stop offset="1" style={{ stopColor: "var(--d2f-accent)" }} />
        </linearGradient>
      </defs>
      <circle cx="3" cy="16" r="1.2" fill={`url(#${id})`} opacity=".5" />
      <circle cx="7" cy="16" r="1.7" fill={`url(#${id})`} opacity=".75" />
      <path d="M11 16c2.2-6.5 5.3-6.5 7.5 0s5.3 6.5 7.5 0c.9-2.6 2-4 3.5-4.4" stroke={`url(#${id})`} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 pr-1.5 text-[16px] font-bold tracking-[-0.02em] text-text" aria-label="data2flow">
      <LogoMark />
      <span>data2flow</span>
    </Link>
  );
}
