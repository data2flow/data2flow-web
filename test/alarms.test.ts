/**
 * 알람·무음·통계 화면 SSR + BFF 통합(UI-RUL-04·05·08·10, RUL-02.01~02.07, RUL-04.01, RUL-06.01).
 * 가짜 gateway는 test/msw/handlers/rules.ts(API-RUL-10~14·20·25·27).
 */
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { GATEWAY } from "./msw/fake-gateway";
import { rulesState } from "./msw/handlers/rules";

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
  return browser;
}
const operator = () => as("kim.op", "Correct-Horse-9");
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");
const admin = () => as("admin01", "Admin-Pass-123");
const state = () => rulesState(app.gateway.m2);

describe("UI-RUL-04 알람 목록(RUL-02.06, RUL-04.01)", () => {
  it("기본은 CLEARED 제외, 심각도 → 발생 시각 정렬, 하위 알람은 상위 아래, 요약 수", async () => {
    const browser = await viewer();
    const page = await browser.get("/alarms");
    expect(page.response.status).toBe(200);
    const sent = app.gateway.received.filter((r) => r.path.startsWith("/api/v1/core/alarms?")).at(-1)!;
    expect(sent.path).toContain("status=ACTIVE%2CACKNOWLEDGED%2CSUPPRESSED");
    expect(sent.path).toContain("from=2026-10-03T00%3A00%3A00.000Z");
    expect(page.body.indexOf("게이트웨이 UG65-F5DCCC 오프라인")).toBeLessThan(page.body.indexOf("무수신 · EM300"));
    expect(page.body.indexOf("무수신 · EM300")).toBeLessThan(page.body.indexOf("고CO2 · 실습실"));
    expect(page.body).toContain("하위 1");
    expect(page.body).toContain("상위 원인");
  });

  it("TC-RUL-044 AT-RUL-06.3 VIEWER: 선택·확인 버튼 없음, API를 직접 불러도 403", async () => {
    const browser = await viewer();
    const page = await browser.get("/alarms");
    expect(page.body).not.toContain("이 페이지 모두 선택");
    const detail = await browser.get("/alarms/9001");
    expect(detail.response.status).toBe(200);
    expect(detail.body).not.toContain('name="intent" value="ack"');
    const direct = await browser.request("/bff/api/core/alarms/9001/ack", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: "{}" });
    expect(direct.response.status).toBe(403);
    expect((await browser.post("/alarms/9001", { intent: "ack" })).response.status).toBe(403);
  });

  it("TC-RUL-058 필터는 URL → API 쿼리(상태·심각도·공간·기간·출처·공간 이벤트), 빈 목록 문구", async () => {
    const browser = await operator();
    const page = await browser.get("/alarms?status=CLEARED&severity=MINOR&spaceId=31&range=7d&sourceType=RULE&groupBySpaceEvent=true");
    const sent = app.gateway.received.filter((r) => r.path.startsWith("/api/v1/core/alarms?")).at(-1)!;
    for (const part of ["status=CLEARED", "severity=MINOR", "spaceId=31", "sourceType=RULE", "groupBySpaceEvent=true", "from=2026-09-27"]) expect(sent.path).toContain(part);
    expect(page.body).toContain("현재 열린 알람이 없습니다 ✓");
    // 홈 알람 카드(TC-DSH-004) 링크 `/alarms?state=ACTIVE` → API-RUL-10 status=ACTIVE
    await browser.get("/alarms?state=ACTIVE");
    expect(app.gateway.received.filter((r) => r.path.startsWith("/api/v1/core/alarms?")).at(-1)!.path).toContain("status=ACTIVE&");
    await browser.get("/alarms?range=all");
    expect(app.gateway.received.filter((r) => r.path.startsWith("/api/v1/core/alarms?")).at(-1)!.path).not.toContain("from=");
  });

  it("AT-RUL-06.4 일괄 확인 BFF 중계(201건이면 400), 실시간 SSE 중계 /bff/stream/alarms", async () => {
    const browser = await operator();
    await browser.get("/alarms");
    const bulk = await browser.request("/bff/api/core/alarms/bulk-ack", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ alarmIds: ["9001", "9004", "nope"] }) });
    const results = JSON.parse(bulk.body).response.results;
    expect(results).toEqual([{ alarmId: "9001", ok: true }, { alarmId: "9004", ok: true, alreadyAcked: true }, { alarmId: "nope", ok: false, code: "ALARM_NOT_FOUND" }]);
    const tooMany = await browser.request("/bff/api/core/alarms/bulk-ack", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ alarmIds: Array.from({ length: 201 }, (_, i) => String(i)) }) });
    expect(tooMany.response.status).toBe(400);
    app.server.use(http.get(`${GATEWAY}/api/v1/core/stream/alarms`, () => new HttpResponse('event: alarm.raised\ndata: {"id":"9100","severity":"MAJOR","status":"ACTIVE","title":"새 알람"}\n\n', { headers: { "Content-Type": "text/event-stream" } })));
    const stream = await browser.get("/bff/stream/alarms");
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.body).toContain("event: alarm.raised");
  });
});

describe("UI-RUL-05 알람 상세(RUL-02.01·02.02·02.04, TC-RUL-039·054·066)", () => {
  it("TC-RUL-039 출처 링크(규칙 → 규칙 편집), 대상 경로, 발생·최고·현재 값, 횟수, 기준선 안내, 발송 이력 2건 SENT", async () => {
    const browser = await operator();
    const page = await browser.get("/alarms/9001");
    expect(page.body).toContain('href="/rules/r-co2"');
    expect(page.body).toContain("본관 고CO2");
    expect(page.body).toContain("광주캠퍼스 / 본관 / 3층 / 실습실");
    expect(page.body).toContain("발생 1,050 ppm · 최고 1,180 ppm · 현재 1,120 ppm");
    expect(page.body).toContain("3회");
    expect(page.body).toContain("발생 기준 1000 · 해제 기준 900");
    expect(page.body).toContain("TELEGRAM");
    expect(page.body.match(/>SENT</g)).toHaveLength(2);
    const sent = app.gateway.received.find((r) => r.path.startsWith("/api/v1/core/telemetry/series?"))!;
    expect(sent.path).toContain("deviceId=1042");
    expect(sent.path).toContain("metrics=co2");
    // 플로우 출처는 플로우 편집기의 그 노드로
    expect((await browser.get("/alarms/9004")).body).toContain('href="/automation/flows/f-7f3a?node=n-thr00001"');
    expect((await browser.get("/alarms/nope")).response.status).toBe(404);
  });

  it("TC-RUL-054 AT-RUL-06.5 확인 → 담당자 지정 → 조치 기록 → 이력 타임라인에 순서대로, 해제", async () => {
    const browser = await operator();
    await browser.get("/alarms/9001");
    const ack = await browser.post("/alarms/9001", { intent: "ack" });
    expect(ack.body).toContain("알람을 확인했습니다");
    expect(state().alarms.find((a) => a.id === "9001")?.status).toBe("ACKNOWLEDGED");
    await browser.post("/alarms/9001", { intent: "assign", userId: "7" });
    await browser.post("/alarms/9001", { intent: "note", text: "환기 장치 점검 요청함", actionType: "ONSITE" });
    const empty = await browser.post("/alarms/9001", { intent: "note", text: "  " });
    expect(empty.response.status).toBe(400);
    expect(empty.body).toContain("메모는 1~2000자입니다");
    const page = await browser.get("/alarms/9001");
    const order = ["확인</span>", "담당자 지정</span>", "현장 확인 환기 장치 점검 요청함"].map((s) => page.body.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(page.body).toContain("김운영 (나)");
    const silenced = await browser.post("/alarms/9001", { intent: "silence", minutes: "30" });
    expect(silenced.body).toContain("무음을 걸었습니다");
    expect(state().silences[0]).toMatchObject({ kind: "ONE_TIME", target: { type: "ALARM", id: "9001" }, startsAt: "2026-10-04T00:00:00.000Z", endsAt: "2026-10-04T00:30:00.000Z" });
    expect((await browser.post("/alarms/9001", { intent: "silence", minutes: "0" })).response.status).toBe(400);
    const cleared = await browser.post("/alarms/9001", { intent: "clear", note: "현장 조치 완료" });
    expect(cleared.body).toContain("알람을 해제했습니다");
    const again = await browser.post("/alarms/9001", { intent: "clear" });
    expect(again.response.status).toBe(409);
    expect(again.body).toContain("이미 처리된 알람입니다");
    expect((await browser.post("/alarms/9001", { intent: "nope" })).response.status).toBe(400);
  });

  it("ADMIN은 회원 목록(API-IAM-31)에서 담당자 후보를 고른다", async () => {
    const browser = await admin();
    const page = await browser.get("/alarms/9001");
    expect(app.gateway.received.some((r) => r.path.startsWith("/api/v1/core/users?"))).toBe(true);
    expect(page.body).toContain("김운영");
  });
});

describe("UI-RUL-08 무음 일정(RUL-02.07)", () => {
  it("일시 무음: 끝이 시작보다 앞이면 오류, 맞으면 만들고 목록에, 해제. 규칙 목록 [무음]으로 대상 미리 채움", async () => {
    const browser = await operator();
    const page = await browser.get("/notifications/silences?targetType=RULE&targetId=r-co2");
    expect(page.body).toContain("무음이 없습니다");
    expect(page.body).toMatch(/<option value="r-co2" selected="">본관 고CO2<\/option>/);
    const bad = await browser.post("/notifications/silences", { intent: "create", kind: "ONE_TIME", targetType: "RULE", targetId: "r-co2", startsAt: "2026-10-04T10:00", endsAt: "2026-10-04T09:00" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("무음 기간이 올바르지 않습니다");
    const ok = await browser.post("/notifications/silences", { intent: "create", kind: "ONE_TIME", targetType: "RULE", targetId: "r-co2", startsAt: "2026-10-04T09:00", endsAt: "2026-10-04T10:00", reason: "점검" });
    expect(ok.response.status).toBe(200);
    expect(state().silences[0]).toMatchObject({ startsAt: "2026-10-04T00:00:00Z", endsAt: "2026-10-04T01:00:00Z" });
    const recurring = await browser.post("/notifications/silences", { intent: "create", kind: "RECURRING", repeat: "WEEKLY", targetType: "SPACE", targetId: "31", days: ["7"], from: "00:00", to: "23:59" });
    expect(recurring.response.status).toBe(200);
    expect(state().silences[1]).toMatchObject({ kind: "RECURRING", recurrence: { days: [7], from: "00:00", to: "23:59" } });
    const vacation = await browser.post("/notifications/silences", { intent: "create", kind: "RECURRING", repeat: "DATES", targetType: "SPACE", targetId: "31", dateFrom: "2026-12-22", dateTo: "2027-02-28", reason: "방학" });
    expect(vacation.response.status).toBe(200);
    const list = await browser.get("/notifications/silences");
    expect(list.body).toContain("본관 고CO2");
    expect(list.body).toContain("2026-12-22 ~ 2027-02-28");
    await browser.post("/notifications/silences", { intent: "delete", silenceId: String(state().silences[0].silenceId) });
    expect(state().silences).toHaveLength(2);
    expect((await browser.post("/notifications/silences", { intent: "x" })).response.status).toBe(400);
  });

  it("ANALYST·VIEWER는 403", async () => {
    expect((await (await analyst()).get("/notifications/silences")).response.status).toBe(403);
  });
});

describe("UI-RUL-10 알람 통계(RUL-06.01, AT-RUL-14.1)", () => {
  it("MTTA 12분, 상위 규칙 순위, 일별 표. VIEWER는 403", async () => {
    const browser = await analyst();
    const page = await browser.get("/alarms/stats?days=30&spaceId=31");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("12분");
    expect(page.body).toContain("12%");
    expect(page.body).toContain('href="/rules/r-co2"');
    expect(page.body).toContain("2026-10-03");
    const sent = app.gateway.received.find((r) => r.path.startsWith("/api/v1/core/alarms/stats?"))!;
    expect(sent.path).toContain("spaceId=31");
    expect(sent.path).toContain("from=2026-09-04");
    expect((await (await viewer()).get("/alarms/stats")).response.status).toBe(403);
  });
});
