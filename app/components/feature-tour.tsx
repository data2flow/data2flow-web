/**
 * 기능 안내 투어(DSH-08.04, TC-DSH-086): 처음 방문한 화면에서 3~5단계 안내. [다음]·[이전]·[닫기]와 키보드(→ ← Enter, Esc 닫기).
 * [다시 보지 않기]는 화면 설정 `toursDismissed`(API-DSH-12)에 투어 id를 더하고, 브라우저 저장소에도 남긴다
 * (저장소를 못 쓰는 환경에서도 화면은 그대로 동작한다).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui";

export interface TourStep {
  title: string;
  body: string;
}

const STORAGE_KEY = "data2flow:tours-dismissed";

export function readDismissedLocal(storage: Pick<Storage, "getItem"> | null = safeStorage()): string[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeDismissedLocal(tourId: string, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): void {
  try {
    const next = [...new Set([...readDismissedLocal(storage), tourId])];
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장소를 쓸 수 없으면 서버 설정만 쓴다
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 투어 단계 수는 3~5단계만 보여 준다 */
export function tourSteps(steps: TourStep[]): TourStep[] {
  return steps.slice(0, 5);
}

export function FeatureTour({ tourId, steps, dismissed, onDismiss }: { tourId: string; steps: TourStep[]; dismissed: readonly string[]; onDismiss: (tourId: string) => void | Promise<unknown> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const list = tourSteps(steps);
  useEffect(() => {
    // 서버 렌더 뒤 브라우저에서만 연다(첫 방문 판단에 브라우저 저장소를 쓰므로)
    if (list.length >= 3 && !dismissed.includes(tourId) && !readDismissedLocal().includes(tourId)) setOpen(true);
  }, [tourId, dismissed, list.length]);
  if (!open || list.length < 3) return null;
  const step = list[index];
  const last = index === list.length - 1;
  const close = () => setOpen(false);
  const never = () => {
    writeDismissedLocal(tourId);
    void onDismiss(tourId);
    setOpen(false);
  };
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${tourId}-title`}
      tabIndex={-1}
      className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-accent/40 bg-panel p-4 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
        else if ((e.key === "ArrowRight" || e.key === "Enter") && !last) setIndex((i) => i + 1);
        else if (e.key === "ArrowLeft" && index > 0) setIndex((i) => i - 1);
      }}
    >
      <p className="text-[11px] text-muted">{t("tour.step", { n: index + 1, total: list.length })}</p>
      <h2 id={`${tourId}-title`} className="text-[14px] font-semibold">
        {step.title}
      </h2>
      <p className="mt-1 text-[13px]">{step.body}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-[12px] text-muted underline" onClick={never}>
          {t("tour.never")}
        </button>
        <div className="flex gap-2">
          {index > 0 && <Button onClick={() => setIndex((i) => i - 1)}>{t("tour.prev")}</Button>}
          {last ? (
            <Button variant="primary" onClick={close}>
              {t("tour.done")}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setIndex((i) => i + 1)} autoFocus>
              {t("tour.next")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
