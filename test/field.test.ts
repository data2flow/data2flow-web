/**
 * M5 현장 작업 화면 SSR + BFF 통합(실제 라우트 + 가짜 gateway, test/msw/handlers/field.ts):
 * UI-DEV-13 작업 지시·계획(DEV-08.02·08.05·08.06), UI-DEV-06 자산 탭(DEV-08.01), UI-DEV-17 QR 딥링크(DEV-09.04),
 * UI-DEV-21 현장 설치(DEV-13.05), UI-DEV-22 설치 현황판(DEV-13.06), UI-DSH-14 모바일 셸(DSH-13.04).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { fieldState } from "./msw/handlers/field";

let app: AppContext;

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => app.reset());

async function as(loginId: string, password: string) {
  const browser = new TestBrowser(app);
  const result = await browser.login(loginId, password);
  expect(result.response.status).toBe(302);
  await browser.get("/");
  return browser;
}
const operator = () => as("kim.op", "Correct-Horse-9");
const integrator = () => as("lee.int", "Integrator-Pass1");
const viewer = () => as("view.er", "Viewer-Pass-123");
const analyst = () => as("ana.lyst", "Analyst-Pass-123");

const json = (browser: TestBrowser, path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, ...headers }, body: JSON.stringify(body) });
const state = () => fieldState(app.gateway.m2);
const text = (html: string) => html.replace(/<!-- -->/g, "");

describe("DEV-08.06 UI-DEV-13 작업 지시 목록", () => {
  it("TC-DEV-237 TC-DEV-213: 내 작업 기본 보기, 통계 카드(열린·지연·평균 처리 시간), 마감 임박·지연 개수, 생성 버튼은 OPERATOR만", async () => {
    const op = await operator();
    const page = await op.get("/work-orders");
    expect(page.response.status).toBe(200);
    const html = text(page.body);
    expect(html).toContain("실습실 AM107 배터리 교체");
    expect(html).not.toContain("실습실 센서 교정"); // 담당자가 내가 아님
    expect(html).toContain("열린 2 · 지연 1 · 평균 처리 6.2시간");
    expect(html).toContain("마감 임박 (1)");
    expect(html).toContain("지연 (1)");
    expect(html).toContain("+ 새 작업 지시");
    expect(html).not.toContain("정기 점검 계획"); // 계획 관리는 INTEGRATOR 이상
    const received = app.gateway.received.filter((r) => r.path.startsWith("/api/v1/core/work-orders?"));
    expect(received.some((r) => r.path.includes("assigneeId=me") && r.path.includes("status=OPEN"))).toBe(true);
    expect(received.some((r) => r.path.includes("dueBefore=2026-10-06T00%3A00%3A00.000Z"))).toBe(true);
  });

  it("TC-DEV-237: 지연 보기·공간 필터(하위 포함), VIEWER는 조회만", async () => {
    const view = await viewer();
    const overdue = text((await view.get("/work-orders?view=overdue&spaceId=3")).body);
    expect(overdue).toContain("실습실 센서 교정");
    expect(overdue).not.toContain("+ 새 작업 지시");
    expect(app.gateway.received.some((r) => r.path.includes("overdue=true") && r.path.includes("spaceId=3"))).toBe(true);
  });

  it("TC-DEV-213: 기기별 보기는 그 기기 공간으로 거른 뒤 대상 기기만", async () => {
    const html = text((await (await operator()).get("/work-orders?view=all&deviceId=1042")).body);
    expect(html).toContain("AM107-067999의 작업 지시");
    expect(html).toContain("실습실 AM107 배터리 교체");
    expect(html).not.toContain("실습실 센서 교정");
  });
});

describe("DEV-08.02 UI-DEV-13 작업 지시 상세와 상태 전이", () => {
  it("TC-DEV-213 AT-DEV-16.1: 상세(체크리스트·댓글·출처 알람 링크), BFF 중계로 전이·체크·댓글·첨부(multipart)", async () => {
    const op = await operator();
    const page = text((await op.get("/work-orders/1042")).body);
    expect(page).toContain("#1042 실습실 AM107 배터리 교체");
    expect(page).toContain("체크리스트 1/2");
    expect(page).toContain('href="/alarms/55"');
    expect(page).toContain("AA 배터리 2개 필요");
    expect(page).toContain("작업 시작");

    const start = await json(op, "/bff/api/core/work-orders/1042/transition", "POST", { action: "START" }, { "Idempotency-Key": "k-start" });
    expect(start.response.status).toBe(200);
    expect(JSON.parse(start.body).response.status).toBe("IN_PROGRESS");
    const again = await json(op, "/bff/api/core/work-orders/1042/transition", "POST", { action: "START" }, { "Idempotency-Key": "k-start" });
    expect(again.response.status).toBe(200); // 같은 키는 한 번만 반영(TC-DSH-126)
    const conflict = await json(op, "/bff/api/core/work-orders/1042/transition", "POST", { action: "START" }, { "Idempotency-Key": "k-other" });
    expect(conflict.response.status).toBe(409);
    expect(JSON.parse(conflict.body).header.resultCode).toBe("WORKORDER_STATE_CONFLICT");

    expect((await json(op, "/bff/api/core/work-orders/1042/checklist/2", "PATCH", { done: true })).response.status).toBe(200);
    expect((await json(op, "/bff/api/core/work-orders/1042/comments", "POST", { text: "교체 완료" })).response.status).toBe(201);
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "after.jpg", { type: "image/jpeg" }));
    const upload = await op.request("/bff/api/core/work-orders/1042/attachments", { method: "POST", headers: { "X-CSRF-TOKEN": op.csrf, "Idempotency-Key": "k-photo" }, body: form });
    expect(upload.response.status).toBe(201);
    expect(JSON.parse(upload.body).response).toMatchObject({ kind: "PHOTO", fileName: "after.jpg" });
    expect(state().attachmentKeys).toEqual(["k-photo"]);

    const done = await json(op, "/bff/api/core/work-orders/1042/transition", "POST", { action: "COMPLETE", result: { replacedOn: "2026-10-04" } }, { "Idempotency-Key": "k-done" });
    expect(JSON.parse(done.body).response.status).toBe("DONE");
    expect(text((await op.get("/work-orders/1042")).body)).toContain("체크리스트 2/2");
  });

  it("TC-DEV-212: VIEWER는 상태 버튼이 없고 쓰기는 서버가 403", async () => {
    const view = await viewer();
    const page = text((await view.get("/work-orders/1042")).body);
    expect(page).not.toContain("작업 시작");
    expect((await json(view, "/bff/api/core/work-orders/1042/transition", "POST", { action: "START" })).response.status).toBe(403);
  });

  it("없는 작업 지시는 404 화면", async () => {
    expect((await (await operator()).get("/work-orders/999")).response.status).toBe(404);
  });
});

describe("DEV-08.05 UI-DEV-13 정기 점검 계획", () => {
  it("TC-DEV-213: 계획 탭은 INTEGRATOR(DEV_ADMIN)만, 목록에 그룹 이름·주기", async () => {
    const int = await integrator();
    const html = text((await int.get("/work-orders/plans")).body);
    expect(html).toContain("배터리 반기 점검");
    expect(html).toContain("180일마다(마감 7일 전 생성)");
    expect(html).toContain("2026-12-01");
    expect((await (await operator()).get("/work-orders/plans")).response.status).toBe(403);
  });
});

describe("DEV-08.01 UI-DEV-06 자산 탭", () => {
  it("TC-DEV-207: 기기 상세에 [자산] 탭, 자산 정보 API 중계(PUT은 DEV_ADMIN)", async () => {
    const int = await integrator();
    const page = text((await int.get("/devices/1042?tab=asset")).body);
    expect(page).toContain(">자산<");
    const info = await int.get("/bff/api/core/devices/1042/asset-info");
    expect(JSON.parse(info.body).response).toMatchObject({ serialNo: "6136D1518000", photoUrls: ["/api/v1/core/devices/1042/asset-info/photos/901"] });
    const photo = await int.get("/bff/api/core/devices/1042/asset-info/photos/901");
    expect(photo.response.headers.get("content-type")).toBe("image/jpeg");
    const op = await operator();
    expect((await json(op, "/bff/api/core/devices/1042/asset-info", "PUT", { serialNo: "X" })).response.status).toBe(403);
    expect((await json(int, "/bff/api/core/devices/1042/asset-info", "PUT", { serialNo: "X", supplier: "공급" })).response.status).toBe(200);
  });
});

describe("DEV-09.04 UI-DEV-17 QR 딥링크 /d/{token}", () => {
  it("TC-DEV-260 AT-DEV-21.1: 로그인 안 된 휴대폰 → 로그인 화면(next) → 로그인 후 모바일 기기 상세로 302", async () => {
    const phone = new TestBrowser(app, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1");
    const first = await phone.get("/d/tokAm107x0000000000000001");
    expect(first.response.status).toBe(302);
    expect(first.response.headers.get("location")).toBe("/login?next=%2Fd%2FtokAm107x0000000000000001");
    const login = await phone.login("kim.op", "Correct-Horse-9", "/d/tokAm107x0000000000000001");
    expect(login.response.headers.get("location")).toBe("/d/tokAm107x0000000000000001");
    const open = await phone.get("/d/tokAm107x0000000000000001");
    expect(open.response.status).toBe(302);
    expect(open.response.headers.get("location")).toBe("/m/devices/1042");
    const detail = text((await phone.get("/m/devices/1042")).body);
    expect(detail).toContain("AM107-067999");
    expect(detail).toContain("열린 작업 지시 1");
    expect(detail).toContain("실습실 AM107 배터리 교체");
    expect(detail).toContain("92%");
  });

  it("TC-DEV-259 AT-DEV-21.2: 재발급 뒤 이전 QR은 친절한 404", async () => {
    const op = await operator();
    expect((await json(op, "/bff/api/core/devices/1042/reissue-qr", "POST", {})).response.status).toBe(200);
    const old = await op.get("/d/tokAm107x0000000000000001");
    expect(old.response.status).toBe(404);
    expect(text(old.body)).toContain("이 QR 라벨은 쓸 수 없습니다");
  });

  it("TC-DEV-256: 라벨 PDF는 BFF를 거쳐 그대로 내려받는다(DEV_PLACE), ANALYST는 403", async () => {
    const op = await operator();
    const pdf = await json(op, "/bff/api/core/devices/qr-labels", "POST", { deviceIds: ["1042"], layout: "A4_3x8" });
    expect(pdf.response.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.response.headers.get("content-disposition")).toContain("qr-labels.pdf");
    expect(pdf.body.startsWith("%PDF")).toBe(true);
    expect((await json(await analyst(), "/bff/api/core/devices/qr-labels", "POST", { deviceIds: ["1042"] })).response.status).toBe(403);
  });
});

describe("DEV-13.05 UI-DEV-21 현장 설치(BFF 중계)", () => {
  it("TC-DEV-327 AT-DEV-27.5: multipart 저장은 clientOpId로 멱등, 더 새로운 서버 기록이면 409 COMMISSION_CONFLICT + 서버 값", async () => {
    const op = await operator();
    expect((await op.get("/m/commission")).response.status).toBe(200);
    const form = (clientOpId: string, installedAt: string) => {
      const f = new FormData();
      f.set("clientOpId", clientOpId);
      f.set("spaceId", "31");
      f.set("x", "0.4200");
      f.set("y", "0.3100");
      f.set("installedAt", installedAt);
      f.append("photos", new File([new Uint8Array([1])], "p1.jpg", { type: "image/jpeg" }));
      return f;
    };
    const send = (f: FormData) => op.request("/bff/api/core/devices/1050/commission", { method: "POST", headers: { "X-CSRF-TOKEN": op.csrf }, body: f });
    const saved = await send(form("4c1f0c3e-0d55-4d0e-9a51-6b1f1c2d3e4f", "2026-10-04T00:00:00Z"));
    expect(saved.response.status).toBe(200);
    expect(JSON.parse(saved.body).response.status).toBe("INSTALLED");
    expect(state().commissions["1050"]).toMatchObject({ spaceId: "31", x: 0.42, y: 0.31, photos: 1 });
    const replay = await send(form("4c1f0c3e-0d55-4d0e-9a51-6b1f1c2d3e4f", "2026-10-04T00:00:00Z"));
    expect(replay.response.status).toBe(200);
    const late = await send(form("9d2e1f00-1111-4222-8333-944455556666", "2026-10-03T23:00:00Z"));
    expect(late.response.status).toBe(409);
    const body = JSON.parse(late.body);
    expect(body.header.resultCode).toBe("COMMISSION_CONFLICT");
    expect(body.response).toMatchObject({ spaceId: "31", installedByName: "김운영" });
  });

  it("현장 설치 화면은 DEV_PLACE만(ANALYST 403)", async () => {
    expect((await (await analyst()).get("/m/commission")).response.status).toBe(403);
  });
});

describe("DEV-13.06 UI-DEV-22 설치 현황판", () => {
  it("TC-DEV-332 AT-DEV-28.1: 사이트 기본 선택, 3층 10/6/5/1, 진행률, 칸 기기 목록 API(responses)", async () => {
    const op = await operator();
    const html = text((await op.get("/devices/installation")).body);
    expect(html).toContain("설치 현황 · 광주캠퍼스");
    expect(html).toMatch(/3층<\/td><td>.*>10<\/button><\/td><td>.*>6<\/button><\/td><td>.*>5<\/button><\/td><td>.*>1<\/button>/);
    expect(html).toContain("60%");
    expect(app.gateway.received.some((r) => r.path === "/api/v1/core/installation-board?siteId=1")).toBe(true);
    const drawer = JSON.parse((await op.get("/bff/api/core/installation-board/devices?spaceId=3&status=PROBLEM")).body);
    expect(drawer.responses).toEqual([expect.objectContaining({ deviceId: "1050", status: "PROBLEM" })]);
  });
});

describe("DSH-13.04 UI-DSH-14 모바일 셸", () => {
  it("TC-DSH-123: /m은 작업 탭으로, 하단 탭 5개, 작업 화면 하단 버튼(QR 스캔·사진·작업 시작)", async () => {
    const op = await operator();
    const index = await op.get("/m");
    expect(index.response.headers.get("location")).toBe("/m/work-orders");
    const list = text((await op.get("/m/work-orders")).body);
    expect(list).toContain('aria-label="모바일 메뉴"');
    for (const tab of ["알람", "공간", "작업", "내 알림", "QR"]) expect(list).toContain(`${tab}</a>`);
    expect(list).toContain('href="/m/work-orders/1042"');
    const work = text((await op.get("/m/work-orders/1042")).body);
    expect(work).toContain('aria-label="작업 버튼"');
    expect(work).toContain("QR 스캔");
    expect(work).toContain(">사진<");
    expect(work).toContain("작업 시작");
    expect(work).toContain("min-h-11");
  });

  it("알람·공간·내 알림·QR 탭과 권한(VIEWER는 현장 설치 링크 없음)", async () => {
    const view = await viewer();
    expect(text((await view.get("/m/alarms")).body)).toContain("모바일 메뉴");
    expect(text((await view.get("/m/spaces")).body)).toContain("실습실");
    expect(text((await view.get("/m/notifications")).body)).toContain("새 알림이 없습니다");
    const scan = text((await view.get("/m/scan")).body);
    expect(scan).toContain("카메라로 스캔");
    expect(scan).not.toContain("현장 설치 열기");
  });

  it("로그인하지 않으면 /m/* 도 로그인으로", async () => {
    const anon = new TestBrowser(app);
    const res = await anon.get("/m/work-orders");
    expect(res.response.status).toBe(302);
    expect(res.response.headers.get("location")).toBe("/login?next=%2Fm%2Fwork-orders");
  });
});
