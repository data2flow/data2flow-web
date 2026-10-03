import { Link } from "react-router";

/** 로고 "점에서 흐름으로": 작은 점(데이터)이 커지다가 하나의 물결로 이어진다(storyboards/README.md §3) */
export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 text-[15px] font-bold text-text" aria-label="data2flow">
      <svg width="28" height="16" viewBox="0 0 28 16" aria-hidden="true">
        <circle cx="2" cy="11" r="1.4" fill="var(--d2f-accent)" />
        <circle cx="6.5" cy="9.5" r="2" fill="var(--d2f-accent)" />
        <path d="M10 9c3-6 6-6 9 0s6 6 8 0" fill="none" stroke="var(--d2f-accent)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span>data2flow</span>
    </Link>
  );
}
