/**
 * 공용 화면 부품. 색은 app.css의 토큰만 쓴다(라이트·다크). 그라데이션·이모지 금지(storyboards/README.md §3).
 * 모양은 목업 부품 라이브러리(storyboards/lib.js)의 card·btn·st·kpi·table·fld·chip·ai를 따른다(DSH-07.02):
 * 카드 1px 테두리·모서리 8px·옅은 그림자, 버튼·입력 높이 34·36px·모서리 6px, 칩·배지 모서리 4px.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData, useSearchParams } from "react-router";

export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-panel shadow-card", className)}>
      {(title || actions) && (
        <header className="flex min-h-[46px] items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-[14px] font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "ai";

/** 목업 .btn(기본)·.btn.pri(파랑)·.btn.dng(빨강)·.btn.ai(옅은 파랑 + "AI" 표시) */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white border-accent shadow-card hover:brightness-95",
  secondary: "bg-panel text-text border-line shadow-card hover:bg-panel2",
  danger: "bg-bad text-white border-bad shadow-card hover:brightness-95",
  ghost: "bg-transparent text-accent border-transparent hover:underline",
  ai: "bg-accent-soft text-accent border-accent before:rounded-[3px] before:bg-accent before:px-1 before:py-px before:text-[9px] before:font-bold before:text-white before:content-['AI']",
};

const BUTTON_BASE = "inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-[13px] font-medium";

export function Button({ variant = "secondary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        BUTTON_BASE,
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function ButtonLink({ to, children, variant = "secondary" }: { to: string; children: ReactNode; variant?: Variant }) {
  return (
    <Link to={to} className={cx(BUTTON_BASE, VARIANTS[variant])}>
      {children}
    </Link>
  );
}

/** 목업 .fld .in: 높이 36px, 모서리 6px, 오류는 빨간 테두리 + 옅은 빨강 고리 */
const inputClass =
  "w-full min-h-9 rounded-md border border-line bg-panel px-[11px] py-1.5 text-[13px] text-text outline-none placeholder:text-text3 focus:border-accent focus:ring-3 focus:ring-accent-soft dark:bg-panel2 aria-[invalid=true]:border-bad aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-bad-soft";
const labelClass = "text-[12.5px] font-medium text-text";

export function TextField({ label, error, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string; hint?: ReactNode }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className={inputClass} {...props} />
      {hint && !error && <p className="text-[11.5px] text-muted">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-[11.5px] text-bad-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({ label, error, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <textarea id={id} aria-invalid={error ? true : undefined} className={inputClass} {...props} />
      {error && (
        <p role="alert" className="text-[11.5px] text-bad-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({ label, children, error, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} className={inputClass} aria-invalid={error ? true : undefined} {...props}>
        {children}
      </select>
      {error && (
        <p role="alert" className="text-[11.5px] text-bad-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input id={id} type="checkbox" className="h-4 w-4 accent-[var(--d2f-accent)]" {...props} />
        <label htmlFor={id} className="text-[13px]">
          {label}
        </label>
      </div>
      {error && (
        <p role="alert" className="text-[11.5px] text-bad-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/** 상태 단계(README §3): 정상(success)·주의(warning=fair)·주요(major=poor)·위험(danger=bad), 가상(virtual=virt) */
export type Tone = "info" | "success" | "warning" | "major" | "danger" | "virtual";
const TONES: Record<Tone, string> = {
  info: "bg-accent-soft text-accent border-accent/30",
  success: "bg-good-soft text-good-ink border-good/30",
  warning: "bg-fair-soft text-fair-ink border-fair/40",
  major: "bg-poor-soft text-poor-ink border-poor/40",
  danger: "bg-bad-soft text-bad-ink border-bad/30",
  virtual: "bg-virt-soft text-virt-ink border-virt/40",
};

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2.5 text-[13px]", TONES[tone])}>
      {children}
    </div>
  );
}

export function Badge({ tone = "info", children }: { tone?: Tone | "neutral"; children: ReactNode }) {
  // 목업: 상태 배지는 옅게 물든 배경 + 진한 글자(테두리 없음), 중립은 칩(.chip) 모양
  const toneClass = tone === "neutral" ? "bg-panel2 text-muted border-line" : cx(TONES[tone], "border-transparent");
  return <span className={cx("inline-flex min-h-[22px] items-center gap-1 whitespace-nowrap rounded border px-2 text-[11.5px] font-medium", toneClass)}>{children}</span>;
}

/** 페이지 제목줄(목업 .ph): 회색 대문자 경로 + ID 칩, 20px 굵은 제목, 오른쪽 동작 버튼 */
export function PageHeader({ title, crumb, actions, id }: { title: ReactNode; crumb?: ReactNode; actions?: ReactNode; id?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {(crumb || id) && (
          <p className="flex items-center gap-2">
            {id && <IdChip>{id}</IdChip>}
            {crumb && <span className="cap">{crumb}</span>}
          </p>
        )}
        <h1 className="mt-0.5 text-[20px] leading-[1.3] font-bold tracking-[-0.02em]">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** ID·코드 칩(목업 .sheet .id): 고정폭 10px 글자, 옅은 채움 + 1px 테두리 */
export function IdChip({ children }: { children: ReactNode }) {
  return <span className="rounded border border-line bg-panel2 px-1.5 py-px font-mono text-[10px] text-muted">{children}</span>;
}

/** 칩(목업 .chip): 필터·태그·보조 표시 */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded border border-line bg-panel2 px-2 text-[11.5px] font-medium text-muted", className)}>{children}</span>;
}

/** 단계 색(카드 점·큰 숫자): good·fair·poor·bad·virt */
export type Level = "good" | "fair" | "poor" | "bad" | "virt";
const LEVEL_DOT: Record<Level, string> = { good: "bg-good", fair: "bg-fair", poor: "bg-poor", bad: "bg-bad", virt: "bg-virt" };
const LEVEL_TEXT: Record<Level, string> = { good: "text-text", fair: "text-fair-ink", poor: "text-poor-ink", bad: "text-bad-ink", virt: "text-virt-ink" };

/**
 * 지표 타일(목업 H.kpi): 회색 대문자 이름(단계 점), 26px 숫자 + 단위, 보조 문장. 정상(good)은 숫자를 기본 글자색으로 둔다
 */
export function Kpi({ label, value, unit, level, sub, className }: { label: ReactNode; value: ReactNode; unit?: ReactNode; level?: Level; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-lg border border-line bg-panel px-4 py-3.5 shadow-card", className)}>
      <div className="cap flex items-center gap-1.5">
        {level && <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", LEVEL_DOT[level])} />}
        {label}
      </div>
      <div className="mt-1">
        <span className={cx("text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] [font-feature-settings:'tnum']", level ? LEVEL_TEXT[level] : "text-text")}>{value}</span>
        {unit && <span className="ml-[3px] text-[12px] text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

/** AI 문장(목업 H.ai): 그라데이션 없이 "AI" 배지와 왼쪽 파란 막대 */
export function AiNote({ tag, children }: { tag?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-l-0 border-line bg-panel py-3 pr-3.5 pl-4 shadow-[inset_3px_0_0_var(--d2f-accent)]">
      <div className="cap mb-1.5 flex items-center gap-1.5">
        <AiMark />
        {tag}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** 작은 "AI" 표시(목업 .orb) */
export function AiMark() {
  return (
    <span aria-hidden className="inline-flex h-[14px] items-center rounded-[3px] bg-accent px-1 text-[9px] leading-none font-bold tracking-normal text-white normal-case">
      AI
    </span>
  );
}

/**
 * 탭. `section`은 메뉴 하위 구역 탭으로, 넓은 화면에서는 왼쪽 막대(app-shell)가 같은 항목을 보여 주므로 숨긴다
 */
export function Tabs({ items, current, section = false }: { items: { key: string; label: ReactNode; to: string }[]; current: string; section?: boolean }) {
  return (
    <nav className={cx("mb-4 flex gap-1 overflow-x-auto border-b border-line", section && "lg:hidden")} aria-label="tabs">
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          aria-current={item.key === current ? "page" : undefined}
          className={cx("-mb-px border-b-2 px-3 py-2 text-[13px] whitespace-nowrap", item.key === current ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text")}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      {/* 목업 table.t: 머리줄은 옅은 채움 + 회색 대문자 10.5px, 줄 사이는 옅은 선 */}
      <table className="w-full border-collapse text-left text-[13px] [&_td]:border-b [&_td]:border-line2 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_th]:border-b [&_th]:border-line [&_th]:bg-panel2 [&_th]:px-3 [&_th]:py-[9px] [&_th]:text-[10.5px] [&_th]:font-semibold [&_th]:tracking-[0.06em] [&_th]:text-muted [&_th]:uppercase [&_tr[aria-selected=true]_td]:bg-accent-soft">
        {children}
      </table>
    </div>
  );
}

interface RootData {
  csrfToken?: string;
}

/** 폼에 넣는 CSRF 토큰(이중 제출, BR-IAM-22) */
export function CsrfField() {
  const root = useRouteLoaderData("root") as RootData | undefined;
  return <input type="hidden" name="_csrf" value={root?.csrfToken ?? ""} />;
}

/**
 * 빈 화면 안내(DSH-08.02, BR-DSH-14): 이유 문장 + 다음 행동 버튼. 권한이 없으면 버튼 대신 안내 문장을 보여 준다.
 */
export function EmptyState({ title, body, action, children }: { title: ReactNode; body?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div data-empty-state className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-panel px-6 py-10 text-center">
      <p className="text-[14px] font-semibold">{title}</p>
      {body && <p className="max-w-lg text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
      {children}
    </div>
  );
}

/** 쪽 이동(오프셋 목록, api-rules §3). 현재 주소의 다른 쿼리는 유지한다 */
export function Pager({ page, totalPages }: { page: number; totalPages?: number }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const link = (target: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(target));
    return `?${next}`;
  };
  if (page <= 1 && (totalPages === undefined || page >= totalPages)) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[12.5px] text-muted">
      {page > 1 && <ButtonLink to={link(page - 1)}>{t("common.prev")}</ButtonLink>}
      {totalPages !== undefined && <span>{`${page} / ${Math.max(1, totalPages)}`}</span>}
      {totalPages !== undefined && page < totalPages && <ButtonLink to={link(page + 1)}>{t("common.next")}</ButtonLink>}
    </div>
  );
}

/** 대화상자(모달 대신 화면 위 카드). 열려 있을 때만 그린다 */
export function Dialog({ title, open, onClose, children, footer }: { title: ReactNode; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-[rgba(29,39,59,0.32)] p-4 pt-[10vh] dark:bg-black/55" role="presentation" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <section role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className="w-full max-w-lg rounded-[10px] border border-line bg-panel shadow-[0_24px_48px_-16px_rgba(0,0,0,0.35)]">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-[13px] text-muted hover:text-text" aria-label={t("common.close")}>
            {t("common.close")}
          </button>
        </header>
        <div className="flex flex-col gap-3 p-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </section>
    </div>
  );
}

/** 점 색. warn은 예전 이름으로 주의(fair)와 같다 */
export type DotTone = "good" | "fair" | "warn" | "poor" | "bad" | "virt" | "muted" | "accent";
const DOT: Record<DotTone, string> = { good: "bg-good", fair: "bg-fair", warn: "bg-fair", poor: "bg-poor", bad: "bg-bad", virt: "bg-virt", muted: "bg-text3", accent: "bg-accent" };
const DOT_TEXT: Record<DotTone, string> = {
  good: "text-good-ink",
  fair: "text-fair-ink",
  warn: "text-fair-ink",
  poor: "text-poor-ink",
  bad: "text-bad-ink",
  virt: "text-virt-ink",
  muted: "text-muted",
  accent: "text-accent",
};

/** 상태 점 + 글자(목업 H.st: 7px 점 + 옅은 고리, 글자도 단계 색). 색만으로 구분하지 않는다(DSH-07) */
export function StatusDot({ tone, label }: { tone: DotTone; label: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap", DOT_TEXT[tone])}>
      <span aria-hidden className={cx("inline-block h-[7px] w-[7px] flex-none rounded-full shadow-[0_0_0_3px_rgba(29,39,59,0.05)] dark:shadow-[0_0_0_3px_rgba(255,255,255,0.06)]", DOT[tone])} />
      <span>{label}</span>
    </span>
  );
}

/**
 * 용어 툴팁(DSH-08.03): 측정 항목·품질 코드·상태 값 같은 용어에 점선 밑줄과 설명. 설명은 `glossary.{key}` 문구(4개 언어)
 */
export function Term({ term, children }: { term: string; children: ReactNode }) {
  const { t } = useTranslation();
  const text = t(`glossary.${term}`, { defaultValue: "" });
  if (!text) return <>{children}</>;
  return (
    <abbr title={text} className="cursor-help no-underline decoration-dotted underline-offset-2 [text-decoration-line:underline]">
      {children}
    </abbr>
  );
}

/** 탭 안 보조 숫자 배지 */
export function CountBadge({ n }: { n?: number | null }) {
  if (n === undefined || n === null) return null;
  return <span className="ml-1 rounded bg-panel2 px-1 text-[11px] text-muted [font-feature-settings:'tnum']">{n}</span>;
}
