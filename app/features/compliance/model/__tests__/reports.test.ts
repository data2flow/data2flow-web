/** CMP-02.02 리포트 마법사 검사·본문(UI-CMP-07), 실패 사유·해시 표시 도우미 */
import { describe, expect, it } from "vitest";
import { bffFileUrl, failureCode, needsPolling, previousMonth, reportBody, shortHash, validateReportForm, type ReportForm } from "../reports";

const form = (extra: Partial<ReportForm> = {}): ReportForm => ({
  type: "KR_SELF_CHECK",
  title: "",
  spaceIds: ["31"],
  facilityType: "",
  periodFrom: "2026-09-01",
  periodTo: "2026-09-30",
  includeRawCsv: false,
  includeActions: true,
  branding: false,
  ...extra,
});

describe("validateReportForm", () => {
  const today = "2026-10-04";
  it("올바른 입력은 오류가 없다", () => {
    expect(validateReportForm(form(), today)).toEqual({});
    expect(validateReportForm(form({ periodTo: today, facilityType: "SENSITIVE" }), today)).toEqual({});
  });
  it("유형·공간·기간 순서·미래·400일·시설 유형을 검사한다", () => {
    expect(validateReportForm(form({ type: "" }), today).type).toBe("typeRequired");
    expect(validateReportForm(form({ type: "RESET_SUPPORT" }), today).type).toBe("typeUnsupported");
    expect(validateReportForm(form({ spaceIds: [] }), today).spaceIds).toBe("spaceRequired");
    expect(validateReportForm(form({ periodFrom: "2026-09-30", periodTo: "2026-09-01" }), today).period).toBe("periodOrder");
    expect(validateReportForm(form({ periodTo: "2026-10-05" }), today).period).toBe("periodFuture");
    expect(validateReportForm(form({ periodFrom: "2025-08-01", periodTo: "2026-10-04" }), today).period).toBe("periodTooLong");
    // 2025-09-01부터 400일째(2026-10-05)까지는 되고 401일째는 안 된다
    expect(validateReportForm(form({ periodFrom: "2025-09-01", periodTo: "2026-10-05" }), "2026-10-06").period).toBeUndefined();
    expect(validateReportForm(form({ periodFrom: "2025-09-01", periodTo: "2026-10-06" }), "2026-10-06").period).toBe("periodTooLong");
    expect(validateReportForm(form({ periodFrom: "" }), today).period).toBe("periodRequired");
    expect(validateReportForm(form({ facilityType: "OFFICE" }), today).facilityType).toBe("facilityInvalid");
  });
});

describe("도우미", () => {
  it("본문: 빈 제목·시설 유형은 null, 옵션은 묶는다", () => {
    expect(reportBody(form())).toEqual({ type: "KR_SELF_CHECK", title: null, spaceIds: ["31"], facilityType: null, periodFrom: "2026-09-01", periodTo: "2026-09-30", options: { includeRawCsv: false, includeActions: true, branding: false } });
  });
  it("지난달 1일~말일, 해시 줄임, 실패 원인 코드, 서명 주소 → BFF 주소, 생성 중이면 폴링", () => {
    expect(previousMonth("2026-10-04")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousMonth("2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(shortHash("9f2a" + "0".repeat(57) + "c41")).toBe("9f2a…c41");
    expect(shortHash(null)).toBe("–");
    expect(failureCode("CMP_REPORT_GENERATION_FAILED: SPACE_NOT_FOUND")).toBe("SPACE_NOT_FOUND");
    expect(failureCode("CMP_REPORT_GENERATION_FAILED: 리포트가 없습니다")).toBeNull();
    expect(bffFileUrl("/api/v1/core/compliance/reports/1/revisions/2/content/pdf?expires=1&signature=a")).toBe("/bff/api/core/compliance/reports/1/revisions/2/content/pdf?expires=1&signature=a");
    expect(bffFileUrl("https://evil.example/x")).toBeUndefined();
    expect(needsPolling([null, { status: "GENERATING" } as never])).toBe(true);
    expect(needsPolling([{ status: "DRAFT" } as never])).toBe(false);
  });
});
