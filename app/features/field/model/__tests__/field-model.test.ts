/**
 * 현장 작업 화면 모델 단위 테스트: DEV-08.02·08.06(TC-DEV-213·237 입력 검증·보기 쿼리), DEV-08.01(TC-DEV-207 자산 검증),
 * DEV-09.04·13.05·13.06(TC-DEV-255·327·332 QR 토큰·대기 시간·현황판 계산).
 */
import { describe, expect, it } from "vitest";
import { boardTotals, checkLabelSelection, commissionTone, failedChecks, floorProgress, formatCountdown, qrTokenFrom, remainingWaitMs } from "../commissioning";
import {
  allowedActions,
  assetBody,
  browserUrl,
  checkAssetInput,
  checkAttachment,
  checkPlanInput,
  checkWorkOrderInput,
  checklistProgress,
  completionResult,
  countQuery,
  idFromUrl,
  isDueSoon,
  isOverdue,
  parseView,
  planBody,
  priorityTone,
  statusTone,
  targetDeviceIds,
  warrantyDaysLeft,
  workOrderBody,
  workOrderQuery,
} from "../work-orders";

const NOW = Date.parse("2026-10-04T00:00:00Z");

describe("DEV-08.06 TC-DEV-237 보기 → API-DEV-91 쿼리", () => {
  it("내 작업은 담당자 me + 열린 상태, 마감 임박은 48시간, 지연은 overdue, 전체는 상태 조건 없음", () => {
    expect(workOrderQuery("mine", { nowMs: NOW }).toString()).toBe("status=OPEN&status=ASSIGNED&status=IN_PROGRESS&assigneeId=me&page=1&size=20");
    expect(workOrderQuery("dueSoon", { nowMs: NOW, spaceId: "3" }).get("dueBefore")).toBe("2026-10-06T00:00:00.000Z");
    expect(workOrderQuery("overdue", { nowMs: NOW }).get("overdue")).toBe("true");
    const all = workOrderQuery("all", { nowMs: NOW, page: 2, size: 50 });
    expect(all.getAll("status")).toEqual([]);
    expect(all.get("page")).toBe("2");
    expect(countQuery("open", { nowMs: NOW }).getAll("status")).toEqual(["OPEN", "ASSIGNED", "IN_PROGRESS"]);
    expect(countQuery("overdue", { nowMs: NOW, spaceId: "3" }).get("size")).toBe("1");
    expect(parseView("overdue")).toBe("overdue");
    expect(parseView("x")).toBe("mine");
    expect(parseView(null)).toBe("mine");
  });

  it("마감 임박(48시간 안)·지연은 열린 작업만", () => {
    expect(isOverdue({ dueAt: "2026-10-03T00:00:00Z", status: "OPEN" }, NOW)).toBe(true);
    expect(isOverdue({ dueAt: "2026-10-03T00:00:00Z", status: "DONE" }, NOW)).toBe(false);
    expect(isOverdue({ dueAt: null, status: "OPEN" }, NOW)).toBe(false);
    expect(isDueSoon({ dueAt: "2026-10-05T23:00:00Z", status: "ASSIGNED" }, NOW)).toBe(true);
    expect(isDueSoon({ dueAt: "2026-10-07T00:00:00Z", status: "ASSIGNED" }, NOW)).toBe(false);
    expect(isDueSoon({ dueAt: "2026-10-05T00:00:00Z", status: "CANCELLED" }, NOW)).toBe(false);
  });
});

describe("DEV-08.02 TC-DEV-213 상태 전이·입력 검증", () => {
  it("상태별 동작(core WorkOrderRules와 같음)과 표시 색", () => {
    expect(allowedActions("OPEN")).toEqual(["ASSIGN", "START", "CANCEL"]);
    expect(allowedActions("IN_PROGRESS")).toEqual(["COMPLETE", "CANCEL"]);
    expect(allowedActions("DONE")).toEqual([]);
    expect(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"].map(statusTone)).toEqual(["info", "warning", "success", "neutral"]);
    expect(["URGENT", "HIGH", "LOW", "NORMAL", null].map(priorityTone)).toEqual(["danger", "warning", "neutral", "info", "info"]);
  });

  it("제목 1~150, 대상 1개 이상, 마감은 현재 이후, 체크리스트 50개", () => {
    const base = { title: "배터리 교체", type: "BATTERY", priority: "", deviceIds: ["1042"], spaceIds: [], assigneeId: "", dueAt: "2026-10-05T09:00", checklist: "분리\n\n장착\n" };
    expect(checkWorkOrderInput(base, NOW)).toEqual({});
    expect(checkWorkOrderInput({ ...base, title: " ", type: "X", deviceIds: [] }, NOW)).toEqual({ title: "required", type: "required", targets: "required" });
    expect(checkWorkOrderInput({ ...base, title: "가".repeat(151) }, NOW).title).toBe("tooLong");
    expect(checkWorkOrderInput({ ...base, dueAt: "2026-10-01T00:00" }, NOW).dueAt).toBe("past");
    expect(checkWorkOrderInput({ ...base, dueAt: "nope" }, NOW).dueAt).toBe("invalid");
    expect(checkWorkOrderInput({ ...base, checklist: Array.from({ length: 51 }, (_, i) => `항목${i}`).join("\n") }, NOW).checklist).toBe("tooMany");
    const body = workOrderBody({ ...base, spaceIds: ["31"], assigneeId: "7" });
    expect(body).toMatchObject({ title: "배터리 교체", priority: "NORMAL", targets: [{ deviceId: "1042" }, { spaceId: "31" }], assigneeId: "7", checklist: ["분리", "장착"], origin: "MANUAL" });
    expect(workOrderBody({ ...base, dueAt: "" }).dueAt).toBeUndefined();
  });

  it("첨부는 이미지·PDF 20MB, 완료 결과는 유형별(BR-DEV-22)", () => {
    expect(checkAttachment({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(checkAttachment({ type: "application/pdf", size: 20 * 1024 * 1024 })).toBeNull();
    expect(checkAttachment({ type: "text/plain", size: 10 })).toBe("type");
    expect(checkAttachment({ type: "image/png", size: 20 * 1024 * 1024 + 1 })).toBe("size");
    expect(completionResult("BATTERY", { replacedOn: "2026-10-04" })).toEqual({ replacedOn: "2026-10-04" });
    expect(completionResult("CALIBRATION", { attributeKey: "tempOffset", attributeValue: "-0.5" })).toEqual({ attributes: { tempOffset: -0.5 } });
    expect(completionResult("CALIBRATION", { attributeKey: "mode", attributeValue: "fast" })).toEqual({ attributes: { mode: "fast" } });
    expect(completionResult("REPLACE", { newDeviceId: " 2001 " })).toEqual({ newDeviceId: "2001" });
    expect(completionResult("INSPECTION", {})).toBeUndefined();
    expect(checklistProgress([{ id: "1", text: "a", done: true }, { id: "2", text: "b", done: false }])).toEqual({ done: 1, total: 2 });
    expect(targetDeviceIds({ targets: [{ deviceId: "1" }, { spaceId: "3" }] })).toEqual(["1"]);
  });

  it("다운로드 경로는 /bff/api로, 경로에서 ID", () => {
    expect(browserUrl("/api/v1/core/devices/1/asset-info/photos/9")).toBe("/bff/api/core/devices/1/asset-info/photos/9");
    expect(browserUrl("https://x.test/api/v1/core/a")).toBe("/bff/api/core/a");
    expect(browserUrl(null)).toBeNull();
    expect(idFromUrl("/api/v1/core/devices/1/asset-info/photos/9", "photos")).toBe("9");
    expect(idFromUrl("/api/v1/core/work-orders/1/attachments/5/content", "attachments")).toBe("5");
    expect(idFromUrl("/x", "photos")).toBeNull();
  });
});

describe("DEV-08.05 계획 검증", () => {
  it("주기 7~1,095일, lead는 0 이상 주기 미만, 그룹·다음 마감 필수", () => {
    const base = { name: "반기 점검", targetGroupId: "61", workType: "INSPECTION", intervalDays: "180", leadDays: "7", nextDueOn: "2026-12-01", defaultAssigneeId: "", checklistTemplate: "외관", enabled: true };
    expect(checkPlanInput(base)).toEqual({});
    expect(checkPlanInput({ ...base, intervalDays: "6" }).intervalDays).toBe("range");
    expect(checkPlanInput({ ...base, intervalDays: "1096" }).intervalDays).toBe("range");
    expect(checkPlanInput({ ...base, leadDays: "180" }).leadDays).toBe("range");
    expect(checkPlanInput({ ...base, name: "", targetGroupId: "", nextDueOn: "" })).toMatchObject({ name: "required", targetGroupId: "required", nextDueOn: "required" });
    expect(checkPlanInput({ ...base, name: "가".repeat(101), checklistTemplate: Array.from({ length: 51 }, () => "a").join("\n") })).toMatchObject({ name: "tooLong", checklistTemplate: "tooMany" });
    expect(planBody({ ...base, leadDays: "" })).toMatchObject({ intervalDays: 180, leadDays: 0, checklistTemplate: ["외관"], defaultAssigneeId: undefined });
  });
});

describe("DEV-08.01 TC-DEV-207 자산 정보", () => {
  it("100자, 날짜 순서, 빈 값은 null, 보증 남은 날", () => {
    const base = { serialNo: "SN", purchasedOn: "2026-03-02", installedOn: "2026-03-10", warrantyUntil: "2027-03-02", supplier: "", installer: "" };
    expect(checkAssetInput(base)).toEqual({});
    expect(checkAssetInput({ ...base, installedOn: "2026-03-01", warrantyUntil: "2026-01-01", serialNo: "x".repeat(101) })).toEqual({ installedOn: "order", warrantyUntil: "order", serialNo: "tooLong" });
    expect(assetBody(base)).toMatchObject({ serialNo: "SN", supplier: null, installer: null });
    expect(warrantyDaysLeft("2026-10-20", NOW)).toBe(16);
    expect(warrantyDaysLeft("2026-10-01", NOW)).toBe(-3);
    expect(warrantyDaysLeft(null, NOW)).toBeNull();
    expect(warrantyDaysLeft("bad", NOW)).toBeNull();
  });
});

describe("DEV-09.04·13.05·13.06 QR·설치 계산", () => {
  it("TC-DEV-255: QR 내용(주소·토큰)에서 토큰", () => {
    expect(qrTokenFrom("https://data2flow.java21.net/d/tokAm107x0000000000000001")).toBe("tokAm107x0000000000000001");
    expect(qrTokenFrom(" tokAm107x0000000000000001 ")).toBe("tokAm107x0000000000000001");
    expect(qrTokenFrom("https://evil.test/x?y")).toBeNull();
    expect(qrTokenFrom("")).toBeNull();
    expect(qrTokenFrom(null)).toBeNull();
  });

  it("TC-DEV-332: 진행률·합계·상태 색", () => {
    const floors = [
      { spaceId: "3", name: "3층", planned: 10, installed: 6, verified: 5, problem: 1 },
      { spaceId: "4", name: "1층", planned: 0, installed: 0, verified: 0, problem: 0 },
    ];
    expect(floorProgress(floors[0])).toBe(60);
    expect(floorProgress(floors[1])).toBe(0);
    expect(boardTotals(floors)).toEqual({ planned: 10, installed: 6, verified: 5, problem: 1 });
    expect(["VERIFIED", "PROBLEM", "INSTALLED", "PLANNED"].map(commissionTone)).toEqual(["good", "bad", "accent", "muted"]);
  });

  it("TC-DEV-327 BR-DEV-38: 첫 수신 대기 남은 시간(waitUntil 또는 설치 + 10분), 실패한 점검 항목, 라벨 개수", () => {
    expect(remainingWaitMs({ waitUntil: "2026-10-04T00:04:12Z" }, NOW)).toBe(252_000);
    expect(remainingWaitMs({ installedAt: "2026-10-03T23:55:00Z" }, NOW)).toBe(300_000);
    expect(remainingWaitMs({ installedAt: "2026-10-03T00:00:00Z" }, NOW)).toBe(0);
    expect(remainingWaitMs({}, NOW)).toBe(0);
    expect(formatCountdown(252_000)).toBe("04:12");
    expect(formatCountdown(0)).toBe("00:00");
    expect(failedChecks({ firstData: false, signal: true, battery: false })).toEqual(["firstData", "battery"]);
    expect(failedChecks(null)).toEqual([]);
    expect(checkLabelSelection([])).toBe("empty");
    expect(checkLabelSelection(Array.from({ length: 201 }, (_, i) => String(i)))).toBe("tooMany");
    expect(checkLabelSelection(["1"])).toBeNull();
  });
});
