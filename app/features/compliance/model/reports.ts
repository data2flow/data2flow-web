/**
 * 준수 리포트(API-CMP-16~20a) 응답 모양과 화면 도우미. core-api ComplianceReportDtos와 같다.
 * 지금은 자가 점검(KR_SELF_CHECK)만 만들 수 있다(RESET·WELL 보조는 CMP-02.03).
 */
import { addDays } from "./status";

export const REPORT_TYPES = ["KR_SELF_CHECK", "RESET_SUPPORT", "WELL_A08_SUPPORT"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const SUPPORTED_REPORT_TYPES: readonly string[] = ["KR_SELF_CHECK"];
export const REPORT_STATUSES = ["GENERATING", "DRAFT", "PUBLISHED", "FAILED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const FACILITY_TYPES = ["GENERAL", "SENSITIVE", "INDOOR_PARKING"] as const;
export const MAX_REPORT_DAYS = 400;
/** 생성 중인 판을 다시 읽는 간격(ms) */
export const POLL_MS = 3000;

export interface DataRange {
  from: string;
  to: string;
  rows: number;
  missingRatio?: number | null;
  excludedVirtualDevices: number;
  lateRowsSincePrevious: number;
}

export interface UserRef {
  userId: string;
  name?: string | null;
}

export interface ReportRevision {
  reportId: string;
  revisionNo: number;
  status: ReportStatus;
  progress: number;
  sha256?: string | null;
  sizeBytes?: number | null;
  dataRange?: DataRange | null;
  profileVersions: string[];
  generatedBy?: UserRef | null;
  publishedBy?: UserRef | null;
  publishedAt?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  reportId: string;
  type: ReportType;
  title: string;
  spaceIds: string[];
  facilityType?: string | null;
  periodFrom: string;
  periodTo: string;
  options?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  latest?: ReportRevision | null;
  /** 상세에서만 */
  revisions?: ReportRevision[] | null;
}

export interface ReportCreated {
  reportId: string;
  revisionId: string;
  revisionNo: number;
  status: ReportStatus;
}

export interface FileLink {
  url: string;
  sha256?: string | null;
  sizeBytes?: number | null;
  expiresAt: string;
}

export interface VerifyResult {
  matched: boolean;
  reportId?: string | null;
  revisionNo?: number | null;
  status?: ReportStatus | null;
  publishedAt?: string | null;
  sha256?: string | null;
}

export type FileKind = "pdf" | "csv" | "preview";

export function statusTone(status: ReportStatus | undefined | null): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "PUBLISHED") return "success";
  if (status === "DRAFT") return "info";
  if (status === "FAILED") return "danger";
  if (status === "GENERATING") return "warning";
  return "neutral";
}

/** 해시 줄임(앞 4자…뒤 3자). 전체 값은 title로 보인다 */
export function shortHash(sha: string | null | undefined): string {
  if (!sha) return "–";
  return sha.length > 10 ? `${sha.slice(0, 4)}…${sha.slice(-3)}` : sha;
}

/** 실패 사유 `CMP_REPORT_GENERATION_FAILED: SPACE_NOT_FOUND`에서 원인 코드 */
export function failureCode(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const m = /^CMP_REPORT_GENERATION_FAILED:\s*([A-Z0-9_]+)$/.exec(reason.trim());
  return m ? m[1] : null;
}

/** 생성 중인 판이 있으면 다시 읽어야 한다 */
export function needsPolling(revisions: (ReportRevision | null | undefined)[]): boolean {
  return revisions.some((r) => r?.status === "GENERATING");
}

/** core가 주는 서명 주소(`/api/v1/core/...`)를 브라우저가 부를 BFF 주소로 */
export function bffFileUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const replaced = url.replace(/^(https?:\/\/[^/]+)?\/api\/v1\//, "/bff/api/");
  return replaced.startsWith("/bff/api/") ? replaced : undefined;
}

export interface ReportForm {
  type: string;
  title: string;
  spaceIds: string[];
  facilityType: string;
  periodFrom: string;
  periodTo: string;
  includeRawCsv: boolean;
  includeActions: boolean;
  branding: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** UI-CMP-07 마법사 검증(오류는 `compliance.reports.validation.*` 키). today는 조직 시간대 날짜 */
export function validateReportForm(form: ReportForm, today: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!(REPORT_TYPES as readonly string[]).includes(form.type)) errors.type = "typeRequired";
  else if (!SUPPORTED_REPORT_TYPES.includes(form.type)) errors.type = "typeUnsupported";
  if (form.spaceIds.length === 0) errors.spaceIds = "spaceRequired";
  if (form.type === "KR_SELF_CHECK" && form.facilityType && !(FACILITY_TYPES as readonly string[]).includes(form.facilityType)) errors.facilityType = "facilityInvalid";
  if (!DAY.test(form.periodFrom) || !DAY.test(form.periodTo)) errors.period = "periodRequired";
  else if (form.periodTo < form.periodFrom) errors.period = "periodOrder";
  else if (form.periodTo > today) errors.period = "periodFuture";
  else if (addDays(form.periodFrom, MAX_REPORT_DAYS - 1) < form.periodTo) errors.period = "periodTooLong";
  if (form.title.length > 200) errors.title = "titleTooLong";
  return errors;
}

/** API-CMP-16 본문 */
export function reportBody(form: ReportForm) {
  return {
    type: form.type,
    title: form.title.trim() || null,
    spaceIds: form.spaceIds,
    facilityType: form.facilityType || null,
    periodFrom: form.periodFrom,
    periodTo: form.periodTo,
    options: { includeRawCsv: form.includeRawCsv, includeActions: form.includeActions, branding: form.branding },
  };
}

/** 지난달 1일 ~ 말일(기본 기간) */
export function previousMonth(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
