/**
 * 리포트 화면 부품(UI-CMP-08, TC-CMP-050·051 화면 쪽): 해시 검증 결과(일치·불일치·PDF 아님), [PDF 다운로드] 서명 링크, 판 메타.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderRoute } from "../../../../../test/render";
import type { ReportsApi } from "../../api";
import type { Report, ReportRevision } from "../../model/reports";
import { FileButton, HashVerifyPanel, RevisionMeta } from "../report-views";

const pdf = () => new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" });

const api = (overrides: Partial<ReportsApi> = {}): ReportsApi => ({
  fileLink: vi.fn(async () => ({ ok: true as const, status: 200, data: { url: "/api/v1/core/compliance/reports/801/revisions/2/content/pdf?expires=1&signature=a", sha256: "a".repeat(64), sizeBytes: 10, expiresAt: "2026-10-04T00:10:00Z" } })),
  verifyHash: vi.fn(async () => ({ ok: true as const, status: 200, data: { matched: true, reportId: "801", revisionNo: 1, status: "PUBLISHED" as const, publishedAt: "2026-10-01T01:00:00Z", sha256: "a".repeat(64) } })),
  ...overrides,
});

describe("HashVerifyPanel", () => {
  it("일치하면 판·발행일과 리포트 링크", async () => {
    const fake = api();
    await renderRoute(<HashVerifyPanel api={fake} timezone="Asia/Seoul" lang="ko" />);
    await userEvent.upload(await screen.findByLabelText("PDF 파일"), pdf());
    expect(await screen.findByText(/원본과 일치합니다: 판 r1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "리포트 열기" })).toHaveAttribute("href", "/compliance/reports/801?rev=1");
    expect(fake.verifyHash).toHaveBeenCalledTimes(1);
  });

  it("불일치·PDF 아님 안내", async () => {
    const fake = api({ verifyHash: vi.fn().mockResolvedValueOnce({ ok: true, status: 200, data: { matched: false } }).mockResolvedValueOnce({ ok: false, status: 400, code: "INVALID_REQUEST", message: "" }) });
    await renderRoute(<HashVerifyPanel api={fake} timezone="Asia/Seoul" lang="ko" />);
    await userEvent.upload(await screen.findByLabelText("PDF 파일"), pdf());
    expect(await screen.findByText(/일치하는 리포트가 없습니다/)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText("PDF 파일"), pdf());
    expect(await screen.findByText("PDF 파일만 검증할 수 있습니다.")).toBeInTheDocument();
  });
});

describe("FileButton", () => {
  it("서명 링크를 받아 BFF 주소로 연다, 실패하면 오류 문구", async () => {
    const open = vi.fn();
    await renderRoute(<FileButton reportId="801" revisionNo={2} kind="pdf" label="PDF 다운로드" api={api()} open={open} />);
    await userEvent.click(await screen.findByRole("button", { name: "PDF 다운로드" }));
    expect(open).toHaveBeenCalledWith("/bff/api/core/compliance/reports/801/revisions/2/content/pdf?expires=1&signature=a");

    const failing = api({ fileLink: vi.fn(async () => ({ ok: false as const, status: 404, code: "CMP_REPORT_NOT_FOUND", message: "" })) });
    await renderRoute(<FileButton reportId="801" revisionNo={2} kind="csv" label="CSV" api={failing} open={open} />);
    await userEvent.click(await screen.findByRole("button", { name: "CSV" }));
    expect(await screen.findByText("리포트를 찾을 수 없습니다.")).toBeInTheDocument();
  });
});

describe("RevisionMeta", () => {
  it("결측률 경고, 가상 기기 제외, 늦게 온 데이터, 해시 줄임", async () => {
    const revision: ReportRevision = {
      reportId: "801",
      revisionNo: 2,
      status: "DRAFT",
      progress: 100,
      sha256: "9f2a" + "0".repeat(57) + "c41",
      dataRange: { from: "2026-08-31T15:00:00Z", to: "2026-09-30T15:00:00Z", rows: 43200, missingRatio: 12.5, excludedVirtualDevices: 1, lateRowsSincePrevious: 30 },
      profileVersions: ["70"],
      generatedBy: { userId: "7", name: "김운영" },
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:05:00Z",
    };
    const report: Report = { reportId: "801", type: "KR_SELF_CHECK", title: "점검", spaceIds: ["31"], facilityType: "GENERAL", periodFrom: "2026-09-01", periodTo: "2026-09-30", createdAt: "", updatedAt: "" };
    await renderRoute(<RevisionMeta report={report} revision={revision} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText(/결측률이 12.5%로 10%를 넘습니다/)).toBeInTheDocument();
    expect(screen.getByText("1대 제외")).toBeInTheDocument();
    expect(screen.getByText("이전 판 이후 30건 추가")).toBeInTheDocument();
    expect(screen.getByText("9f2a…c41")).toHaveAttribute("title", revision.sha256);
    expect(screen.getByText("일반 다중이용시설")).toBeInTheDocument();
  });
});
