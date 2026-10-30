/**
 * 월간 에너지 리포트(ENE-01.05, API-ENE-13, UC-ENE-05). 생성은 비동기(202) — GENERATING → READY·FAILED, PDF는 READY에만 있다.
 */
export const REPORT_STATUSES = ["GENERATING", "READY", "FAILED"] as const;
export type EnergyReportStatus = (typeof REPORT_STATUSES)[number];

export interface EnergyReport {
  reportId: string;
  scopeSpaceId: string | null;
  scopeName: string | null;
  month: string;
  format: "PDF" | "JSON";
  status: EnergyReportStatus;
  progress: number;
  sha256?: string | null;
  sizeBytes?: number | null;
  fileUrl?: string | null;
  failureReason?: string | null;
  createdBy?: { userId: string; name?: string | null } | null;
  createdAt: string;
}

/** 오늘(조직 시간대 YYYY-MM-DD)의 지난달 YYYY-MM — 생성 폼 기본값 */
export function lastMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/** 달 검증: 형식 YYYY-MM, 이번 달 이후는 안 된다. 틀리면 오류 키 */
export function validateReportMonth(month: string, today: string): "required" | "format" | "future" | null {
  if (!month) return "required";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return "format";
  return month > today.slice(0, 7) ? "future" : null;
}

export const needsPolling = (reports: EnergyReport[]) => reports.some((r) => r.status === "GENERATING");

/** 게이트웨이 경로(`/api/v1/...`) → BFF 내려받기 경로 */
export const fileHref = (url: string | null | undefined) => (url?.startsWith("/api/v1/") ? `/bff/api/${url.slice("/api/v1/".length)}` : (url ?? null));
