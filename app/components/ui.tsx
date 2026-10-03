/**
 * 공용 화면 부품. 색은 app.css의 토큰만 쓴다(라이트·다크). 그라데이션·이모지 금지(storyboards/README.md §3).
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { Link, useRouteLoaderData } from "react-router";

export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="text-[14px] font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white border-accent hover:opacity-90",
  secondary: "bg-panel text-text border-line hover:bg-bg",
  danger: "bg-panel text-bad border-bad hover:bg-bad-soft",
  ghost: "bg-transparent text-accent border-transparent hover:underline",
};

export function Button({ variant = "secondary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function ButtonLink({ to, children, variant = "secondary" }: { to: string; children: ReactNode; variant?: Variant }) {
  return (
    <Link to={to} className={cx("inline-flex items-center rounded-md border px-3 py-1.5 text-[13px] font-medium", VARIANTS[variant])}>
      {children}
    </Link>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13.5px] text-text outline-none focus:border-accent aria-[invalid=true]:border-bad";

export function TextField({ label, error, hint, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string; hint?: ReactNode }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted">
        {label}
      </label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className={inputClass} {...props} />
      {hint && !error && <p className="text-[12px] text-muted">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({ label, error, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted">
        {label}
      </label>
      <textarea id={id} aria-invalid={error ? true : undefined} className={inputClass} {...props} />
      {error && (
        <p role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({ label, children, error, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted">
        {label}
      </label>
      <select id={id} className={inputClass} aria-invalid={error ? true : undefined} {...props}>
        {children}
      </select>
      {error && (
        <p role="alert" className="text-[12px] text-bad">
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
        <p role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

type Tone = "info" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  info: "bg-accent-soft text-accent border-accent/30",
  success: "bg-good-soft text-good border-good/30",
  warning: "bg-warn-soft text-warn border-warn/30",
  danger: "bg-bad-soft text-bad border-bad/30",
};

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-[13px]", TONES[tone])}>
      {children}
    </div>
  );
}

export function Badge({ tone = "info", children }: { tone?: Tone | "neutral"; children: ReactNode }) {
  const toneClass = tone === "neutral" ? "bg-bg text-muted border-line" : TONES[tone];
  return <span className={cx("inline-flex items-center rounded border px-1.5 py-0.5 text-[11.5px] font-medium", toneClass)}>{children}</span>;
}

export function PageHeader({ title, crumb, actions }: { title: ReactNode; crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {crumb && <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{crumb}</p>}
        <h1 className="text-[20px] font-bold">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ items, current }: { items: { key: string; label: ReactNode; to: string }[]; current: string }) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-line" aria-label="tabs">
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          aria-current={item.key === current ? "page" : undefined}
          className={cx("-mb-px border-b-2 px-3 py-2 text-[13px]", item.key === current ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text")}
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
      <table className="w-full border-collapse text-left text-[13px] [&_td]:border-t [&_td]:border-line [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2 [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-muted">
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
