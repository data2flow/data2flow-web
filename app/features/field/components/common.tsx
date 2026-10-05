/**
 * 현장 작업 공용 표시 부품: 상태·우선순위 배지, 오프라인 띠, 사진 고르기.
 */
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, cx } from "~/components/ui";
import { priorityTone, statusTone } from "../model/work-orders";

export function WorkOrderStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge tone={statusTone(status)}>{t(`field.status.${status}`, { defaultValue: status })}</Badge>;
}

export function PriorityBadge({ priority }: { priority?: string | null }) {
  const { t } = useTranslation();
  if (!priority) return null;
  return <Badge tone={priorityTone(priority)}>{t(`field.priority.${priority}`, { defaultValue: priority })}</Badge>;
}

/** 오프라인 띠: 읽기 전용 안내와 대기 중 업로드 개수(UI-DSH-14 상태) */
export function OfflineBand({ online, pending }: { online: boolean; pending: number }) {
  const { t } = useTranslation();
  if (online && pending === 0) return null;
  return (
    <div role="status" className={cx("px-4 py-2 text-[13px]", online ? "bg-accent-soft text-accent" : "bg-fair-soft text-fair-ink")}>
      {online ? t("field.offline.sending", { count: pending }) : t("field.offline.band", { count: pending })}
    </div>
  );
}

/** 큰 터치 버튼(44px 이상, AT-DSH-16.1) */
export function TouchButton({ children, onClick, disabled, variant = "secondary", label }: { children: ReactNode; onClick: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger"; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "min-h-11 min-w-11 flex-1 rounded-md px-3 text-[14px] font-semibold disabled:opacity-50",
        variant === "primary" && "bg-accent text-white",
        variant === "secondary" && "border border-line bg-panel text-text",
        variant === "danger" && "border border-bad text-bad-ink",
      )}
    >
      {children}
    </button>
  );
}

/** 사진 고르기(모바일은 카메라를 바로 연다). 버튼으로 숨은 파일 입력을 연다 */
export function PhotoPicker({ label, onFiles, disabled, multiple = false, accept = "image/*", touch = false }: { label: string; onFiles: (files: File[]) => void; disabled?: boolean; multiple?: boolean; accept?: string; touch?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        capture="environment"
        multiple={multiple}
        className="sr-only"
        aria-label={label}
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {touch ? (
        <TouchButton onClick={() => input.current?.click()} disabled={disabled}>
          {label}
        </TouchButton>
      ) : (
        <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="rounded-md border border-line px-3 py-1.5 text-[13px] disabled:opacity-50">
          {label}
        </button>
      )}
    </>
  );
}
