/**
 * 알림·운영 화면 SSR + BFF 통합(UI-RUL-06·07·09·11, UI-IAM-04 알림 수신, UI-OPS-05·06)과 메신저 콜백(API-RUL-31, auth.md §9.3).
 * 가짜 gateway는 test/msw/handlers/notify.ts. 메신저 콜백의 내부 action 호출은 MSW로 받는다(실제 텔레그램 없음).
 */
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, TestBrowser, startApp, type AppContext } from "./app-harness";
import { notifyState } from "./msw/handlers/notify";

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
const admin = () => as("admin01", "Admin-Pass-123");
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");
const state = () => notifyState(app.gateway.m2);
const sent = (prefix: string) => app.gateway.received.filter((r) => r.path.startsWith(prefix));

const policyFields = (extra: Record<string, string | string[]> = {}) => ({
  intent: "save",
  name: "야간 경영진",
  minSeverity: "CRITICAL",
  spaceId: "",
  timeMode: "ALWAYS",
  recipient: ["ROLE:ADMIN", "ON_CALL:"],
  channel: ["WEB"],
  renotifyMinutes: "60",
  aggregateWindowSec: "0",
  notifyOnClear: "on",
  steps: "[]",
  baseVersion: "0",
  ...extra,
});

describe("UI-RUL-06 알림 정책(RUL-03.02·03.03·03.06)", () => {
  it("VIEWER·ANALYST는 경로 403(NOTIFY_POLICY_WRITE 없음)", async () => {
    expect((await (await viewer()).get("/notifications/policies")).response.status).toBe(403);
    expect((await (await analyst()).get("/notifications/policies")).response.status).toBe(403);
  });

  it("목록: 조건 요약·수신자 수·채널·에스컬레이션 단계, 사용 중 정책 삭제는 POLICY_IN_USE", async () => {
    const browser = await operator();
    const page = await browser.get("/notifications/policies");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("시설팀 기본");
    expect(page.body).toContain("본관");
    expect(page.body).toContain("웹, 텔레그램");
    expect(page.body).toContain("1단계");
    expect(page.body).toContain('href="/notifications/templates"');
    const blocked = await browser.post("/notifications/policies", { policyId: "41" });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toContain("다른 곳에서 쓰는 정책이라 지울 수 없습니다");
    state().policyUsage = {};
    const removed = await browser.post("/notifications/policies", { policyId: "41" });
    expect(removed.response.status).toBe(200);
    expect(state().policies).toHaveLength(0);
    expect((await browser.get("/notifications/policies")).body).toContain("알림 정책이 없습니다");
  });

  it("새 정책: 검증 오류는 서버에 보내지 않고 문구로, 저장하면 201 → 상세로 이동", async () => {
    const browser = await operator();
    const form = await browser.get("/notifications/policies/new");
    expect(form.response.status).toBe(200);
    expect(form.body).toContain("새 알림 정책");
    expect(form.body).toContain("현재 당직자");
    const bad = await browser.post("/notifications/policies/new", policyFields({ name: "", recipient: [], renotifyMinutes: "5" }));
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("이름을 입력하세요");
    expect(bad.body).toContain("수신자를 한 명 이상 고르세요");
    expect(bad.body).toContain("재알림 간격은 10분~24시간입니다");
    expect(sent("/api/v1/core/notification-policies").filter((r) => r.method === "POST")).toHaveLength(0);
    const saved = await browser.post("/notifications/policies/new", policyFields({ steps: JSON.stringify([{ waitMinutes: 15, recipients: ["USER:1"] }]) }));
    expect(saved.response.status).toBe(302);
    const created = state().policies.at(-1)!;
    expect(saved.response.headers.get("Location")).toBe(`/notifications/policies/${created.notificationPolicyId}?saved=1`);
    expect(created).toMatchObject({ name: "야간 경영진", minSeverity: "CRITICAL", spaceId: null, includeChildren: true, recipients: [{ type: "ROLE", id: "ADMIN" }, { type: "ON_CALL", id: null }], channels: ["WEB"], renotifyMinutes: 60, notifyOnClear: true, steps: [{ stepNo: 1, waitMinutes: 15, recipients: [{ type: "USER", id: "1" }] }] });
    const post = sent("/api/v1/core/notification-policies").find((r) => r.method === "POST")!;
    expect(post.headers["idempotency-key"]).toBeTruthy();
    const detail = await browser.get(saved.response.headers.get("Location")!);
    expect(detail.body).toContain("저장했습니다");
  });

  it("TC-RUL-071 TC-RUL-073 설정되지 않은 채널(409 CHANNEL_NOT_CONFIGURED)은 채널 필드 오류로 보인다", async () => {
    state().channels = [];
    const browser = await operator();
    await browser.get("/notifications/policies/41");
    const result = await browser.post("/notifications/policies/41", policyFields({ channel: ["WEB", "TELEGRAM"], baseVersion: "3" }));
    expect(result.response.status).toBe(409);
    expect(result.body).toContain("설정되지 않은 채널입니다. 관리 &gt; 알림 채널에서 먼저 등록하세요.");
  });

  it("편집: baseVersion을 보내고, 다른 사람이 먼저 고쳤으면 409 안내, 최대 3단계 에스컬레이션", async () => {
    const browser = await operator();
    const page = await browser.get("/notifications/policies/41");
    expect(page.body).toContain('name="baseVersion" value="3"');
    expect(page.body).toContain("2분");
    const four = JSON.stringify(Array.from({ length: 4 }, () => ({ waitMinutes: 10, recipients: ["ON_CALL:"] })));
    expect((await browser.post("/notifications/policies/41", policyFields({ steps: four, baseVersion: "3" }))).body).toContain("에스컬레이션은 최대 3단계입니다");
    const ok = await browser.post("/notifications/policies/41", policyFields({ baseVersion: "3", spaceId: "31", includeChildren: "on", timeMode: "WINDOW", days: ["1", "2"], from: "22:00", to: "07:00" }));
    expect(ok.response.status).toBe(200);
    expect(ok.body).toContain("저장했습니다");
    expect(state().policies[0]).toMatchObject({ version: 4, spaceId: "31", timeWindow: { days: [1, 2], from: "22:00", to: "07:00" } });
    const stale = await browser.post("/notifications/policies/41", policyFields({ baseVersion: "3" }));
    expect(stale.response.status).toBe(409);
    expect(stale.body).toContain("다른 사람이 먼저 고쳤습니다");
    state().policyUsage = {};
    const removed = await browser.post("/notifications/policies/41", { intent: "delete" });
    expect(removed.response.status).toBe(302);
    expect(removed.response.headers.get("Location")).toBe("/notifications/policies");
  });

  it("관리자는 회원 목록에서 사용자 수신자를 고른다(OPERATOR는 ID 입력)", async () => {
    const adminPage = await (await admin()).get("/notifications/policies/new");
    expect(adminPage.body).toContain("홍길동");
    const opPage = await (await operator()).get("/notifications/policies/new");
    expect(opPage.response.status).toBe(200);
  });
});

describe("UI-RUL-07 알림 템플릿(RUL-05.01, RUL-03.04)", () => {
  it("채널·언어 필터, 템플릿 편집, TC-RUL-092 알 수 없는 변수는 저장되고 경고, 기본값 되돌리기", async () => {
    const browser = await operator();
    const page = await browser.get("/notifications/templates?channel=TELEGRAM&locale=ko");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("alarm.raised");
    expect(sent("/api/v1/core/notification-templates?").at(-1)!.path).toContain("channel=TELEGRAM");
    const edit = await browser.get("/notifications/templates?channel=TELEGRAM&locale=ko&id=71");
    expect(edit.body).toContain("{{link}}");
    expect(edit.body).toContain('name="baseVersion" value="1"');
    const warned = await browser.post("/notifications/templates?channel=TELEGRAM&locale=ko&id=71", { intent: "save", id: "71", subject: "", body: "{{alarm.title}} {{foo}}", baseVersion: "1" });
    expect(warned.response.status).toBe(200);
    expect(warned.body).toContain("저장했습니다. 알 수 없는 변수: foo");
    expect(state().templates[0].body).toBe("{{alarm.title}} {{foo}}");
    const tooLong = await browser.post("/notifications/templates?channel=TELEGRAM&locale=ko&id=71", { intent: "save", id: "71", subject: "", body: "a".repeat(4097), baseVersion: "2" });
    expect(tooLong.response.status).toBe(400);
    expect(tooLong.body).toContain("본문은 4096자까지입니다");
    const reset = await browser.post("/notifications/templates?channel=TELEGRAM&locale=ko&id=71", { intent: "reset", id: "71" });
    expect(reset.body).toContain("기본값으로 되돌렸습니다");
    expect(state().templates[0].body).toBe("[{{alarm.severity}}] {{alarm.title}}\n{{link}}");
  });

  it("미리 보기는 브라우저에서 BFF로(API-RUL-22 preview)", async () => {
    const browser = await operator();
    await browser.get("/notifications/templates");
    const preview = await browser.request("/bff/api/core/notification-templates/71/preview", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ alarmId: "501" }) });
    expect(preview.response.status).toBe(200);
    expect(preview.body).toContain("https://data2flow.java21.net/alarms/501");
  });
});

describe("UI-RUL-09 당직 일정(RUL-05.03, BR-RUL-19)", () => {
  it("현재 당직자·주간 근무표·대체 근무, 근무표 저장(baseVersion)과 겹침 거부", async () => {
    const browser = await operator();
    const page = await browser.get("/notifications/on-call");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("현재 당직자");
    expect(page.body).toContain("이통합");
    expect(page.body).toContain("18:00–09:00");
    expect(page.body).toContain("홍길동");
    const overlap = JSON.stringify([
      { dayOfWeek: 1, from: "09:00", to: "18:00", userId: "7" },
      { dayOfWeek: 1, from: "12:00", to: "13:00", userId: "8" },
    ]);
    const bad = await browser.post("/notifications/on-call", { intent: "save", name: "시설팀 당직", timezone: "Asia/Seoul", shifts: overlap, baseVersion: "2" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("2번째 근무: 다른 근무와 시간이 겹칩니다");
    const good = JSON.stringify([{ dayOfWeek: 2, from: "09:00", to: "18:00", userId: "7" }]);
    const saved = await browser.post("/notifications/on-call", { intent: "save", name: "시설팀 당직", timezone: "Asia/Seoul", shifts: good, baseVersion: "2" });
    expect(saved.response.status).toBe(200);
    expect(state().onCall).toMatchObject({ version: 3, shifts: [{ dayOfWeek: 2, userId: "7" }] });
    const stale = await browser.post("/notifications/on-call", { intent: "save", name: "시설팀 당직", timezone: "Asia/Seoul", shifts: good, baseVersion: "2" });
    expect(stale.response.status).toBe(409);
  });

  it("대체 근무 추가(조직 시간대 → UTC)와 삭제", async () => {
    const browser = await operator();
    await browser.get("/notifications/on-call");
    const bad = await browser.post("/notifications/on-call", { intent: "addOverride", startsAt: "2026-10-05T18:00", endsAt: "2026-10-05T09:00", originalUserId: "8", substituteUserId: "7" });
    expect(bad.body).toContain("끝은 시작보다 뒤여야 합니다");
    const added = await browser.post("/notifications/on-call", { intent: "addOverride", startsAt: "2026-10-05T18:00", endsAt: "2026-10-06T09:00", originalUserId: "8", substituteUserId: "7" });
    expect(added.body).toContain("대체 근무를 추가했습니다");
    expect(state().overrides.at(-1)).toMatchObject({ startsAt: "2026-10-05T09:00:00Z", endsAt: "2026-10-06T00:00:00Z", originalUserId: "8", substituteUserId: "7" });
    const removed = await browser.post("/notifications/on-call", { intent: "deleteOverride", overrideId: "91" });
    expect(removed.body).toContain("대체 근무를 지웠습니다");
    expect(state().overrides.some((o) => o.overrideId === "91")).toBe(false);
  });
});

describe("UI-IAM-04 알림 수신 탭(OPS-06.05, UI-RUL-11, RUL-05.04)", () => {
  it("모든 역할이 열 수 있고 탭이 보인다. TC-OPS-068 최소 심각도 저장, TC-OPS-070 방해 금지 22~07시 + CRITICAL 예외", async () => {
    const browser = await viewer();
    const page = await browser.get("/me/notifications");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/me/notifications"');
    expect(page.body).toContain("최소 심각도");
    expect(page.body).toContain("연결되지 않음");
    const severity = await browser.post("/me/notifications", { intent: "severity", minSeverity: "MAJOR", pushAlarm: "on" });
    expect(severity.response.status).toBe(200);
    expect(state().pushPrefs["9"]).toMatchObject({ minSeverity: "MAJOR", push: { alarm: true, workOrderAssigned: false, approvalRequest: false } });
    const badDnd = await browser.post("/me/notifications", { intent: "dnd", dndEnabled: "on", dndFrom: "22:00", dndTo: "22:00", locale: "ko" });
    expect(badDnd.response.status).toBe(400);
    expect(badDnd.body).toContain("시작과 끝이 같을 수 없습니다");
    const dnd = await browser.post("/me/notifications", { intent: "dnd", dndEnabled: "on", dndFrom: "22:00", dndTo: "07:00", dndAllowCritical: "on", locale: "ko" });
    expect(dnd.response.status).toBe(200);
    expect(state().dnd["9"]).toEqual({ dndFrom: "22:00", dndTo: "07:00", dndAllowCritical: true, locale: "ko" });
    const again = await browser.get("/me/notifications");
    expect(again.body).toContain('value="22:00"');
  });

  it("메신저 연결 상태: 연결됨이면 연결 시각, 상태 API가 없으면 '확인하지 못함'", async () => {
    state().links["7"] = [{ channel: "TELEGRAM", linkedAt: "2026-10-03T01:00:00Z" }];
    const browser = await operator();
    expect((await browser.get("/me/notifications")).body).toContain("연결됨");
    state().linkStatusApi = false;
    expect((await browser.get("/me/notifications")).body).toContain("연결 상태를 확인하지 못했습니다");
    const start = await browser.request("/bff/api/core/accounts/me/messenger-links/start", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ channel: "TELEGRAM" }) });
    expect(start.body).toContain("K7Q2-9XPA");
  });
});

describe("UI-OPS-05 유지보수 일정(OPS-05.01~05.03)", () => {
  it("VIEWER는 403, OPERATOR는 진행 중·예약·지난 탭", async () => {
    expect((await (await viewer()).get("/admin/maintenance")).response.status).toBe(403);
    const browser = await operator();
    const page = await browser.get("/admin/maintenance");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("에어컨 필터 교체");
    expect(page.body).not.toContain("도색");
    expect(sent("/api/v1/core/maintenance-windows?").at(-1)!.path).toContain("status=ACTIVE");
    const scheduled = await browser.get("/admin/maintenance?tab=scheduled");
    expect(scheduled.body).toContain("도색");
    expect((await browser.get("/admin/maintenance?tab=past")).body).toContain("지난 유지보수가 없습니다");
  });

  it("TC-OPS-049 AT-OPS-10.3 겹치면 409 MAINTENANCE_OVERLAP, TC-OPS-052 종료 ≤ 시작은 400, 자동 제어 멈춤 기본 켬(OPS-05.02)", async () => {
    const browser = await operator();
    const form = await browser.get("/admin/maintenance?new=1");
    expect(form.body).toContain("이 동안 자동 제어 멈춤");
    expect(form.body).toMatch(/name="pauseAutomation"[^>]*checked/);
    const overlap = await browser.post("/admin/maintenance", { intent: "create", targetType: "SPACE", spaceId: "31", startMode: "now", endMode: "at", endsAt: "2026-10-04T18:00", pauseAutomation: "on", excludeFromAnalytics: "on", reason: "필터 교체" });
    expect(overlap.response.status).toBe(409);
    expect(overlap.body).toContain("같은 대상에 겹치는 유지보수가 있습니다");
    const range = await browser.post("/admin/maintenance", { intent: "create", targetType: "SPACE", spaceId: "3", startMode: "at", startsAt: "2026-10-04T18:00", endMode: "at", endsAt: "2026-10-04T09:00", reason: "x" });
    expect(range.response.status).toBe(400);
    expect(range.body).toContain("종료는 시작보다 뒤여야 합니다");
    const created = await browser.post("/admin/maintenance", { intent: "create", targetType: "DEVICE", deviceId: app.gateway.m2.devices[0].id, startMode: "now", endMode: "none", reason: "센서 교체" });
    expect(created.response.status).toBe(200);
    expect(created.body).toContain("유지보수를 등록했습니다");
    expect(state().maintenance.at(-1)).toMatchObject({ targetType: "DEVICE", pauseAutomation: false, excludeFromAnalytics: false, endsAt: null, reason: "센서 교체" });
    const body = sent("/api/v1/core/maintenance-windows").filter((r) => r.method === "POST").at(-1)!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("startsAt");
  });

  it("진행 중은 [종료], 예약은 [취소]", async () => {
    const browser = await operator();
    await browser.get("/admin/maintenance");
    expect((await browser.post("/admin/maintenance", { intent: "end", id: "61" })).body).toContain("유지보수를 끝냈습니다");
    expect(state().maintenance[0].status).toBe("ENDED");
    expect((await browser.post("/admin/maintenance?tab=scheduled", { intent: "cancel", id: "62" })).body).toContain("예약을 취소했습니다");
    expect(state().maintenance[1].status).toBe("CANCELED");
  });
});

describe("UI-OPS-06 알림 채널(OPS-06.01·06.03·06.06)", () => {
  it("관리자만(NOTIFY_CHANNEL_MANAGE), TC-OPS-143 유형 목록은 Telegram만 활성·나머지 준비 중, TC-OPS-058 비밀값은 저장됨 표시만", async () => {
    expect((await (await operator()).get("/admin/channels")).response.status).toBe(403);
    const browser = await admin();
    const page = await browser.get("/admin/channels");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("시설팀 텔레그램");
    expect(page.body).toContain("2개 대상");
    expect(page.body).toContain('href="/admin/channels?new=TELEGRAM"');
    expect(page.body).toContain("준비 중(SPI로 추가 예정)");
    expect(page.body).not.toContain('href="/admin/channels?new=SMS"');
    const edit = await browser.get("/admin/channels?edit=51");
    expect(edit.body).toContain("●●●● 저장됨");
    expect(edit.body).not.toContain("AAH-abcdefghijklmnopqrstuvwxyz");
    expect(edit.body).toContain("-1001234567890");
  });

  it("TC-OPS-055 TC-OPS-057 테스트 발송: 성공 (0.8초), 잘못된 봇 토큰은 502 CHANNEL_TEST_FAILED(401 Unauthorized)", async () => {
    const browser = await admin();
    await browser.get("/admin/channels?edit=51");
    const okTest = await browser.post("/admin/channels?edit=51", { intent: "test", id: "51" });
    expect(okTest.body).toContain("성공 (0.8초)");
    state().testFails = true;
    const failed = await browser.post("/admin/channels?new=TELEGRAM", { intent: "testDraft", type: "TELEGRAM", name: "새 채널", rateLimitPerMin: "20", digestWindowSec: "60", "cfg.chatIds": "42", "secret.botToken": "123456789:AAH-abcdefghijklmnopqrstuvwxyz", "secret.webhookSecret": "s" });
    expect(failed.response.status).toBe(502);
    expect(failed.body).toContain("실패: 401 Unauthorized");
  });

  it("채널 추가: 스키마 검증 → 저장(비밀값은 secret으로), 수정은 비밀값을 비우면 그대로, TC-OPS-059 사용 중 삭제 409", async () => {
    const browser = await admin();
    await browser.get("/admin/channels?new=TELEGRAM");
    const bad = await browser.post("/admin/channels?new=TELEGRAM", { intent: "save", type: "TELEGRAM", name: "경영진", rateLimitPerMin: "20", digestWindowSec: "60", "cfg.chatIds": "abc", "secret.botToken": "nope" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("정수를 입력하세요");
    expect(bad.body).toContain("형식이 맞지 않습니다");
    const created = await browser.post("/admin/channels?new=TELEGRAM", { intent: "save", type: "TELEGRAM", name: "경영진", rateLimitPerMin: "20", digestWindowSec: "60", enabled: "on", "cfg.chatIds": "-100777", "secret.botToken": "123456789:AAH-abcdefghijklmnopqrstuvwxyz", "secret.webhookSecret": "exec_secret" });
    expect(created.response.status).toBe(302);
    const channel = state().channels.at(-1)!;
    expect(channel).toMatchObject({ name: "경영진", config: { chatIds: [-100777] }, secret: { botToken: "123456789:AAH-abcdefghijklmnopqrstuvwxyz", webhookSecret: "exec_secret" } });
    const updated = await browser.post(`/admin/channels?edit=${channel.id}`, { intent: "save", id: channel.id, type: "TELEGRAM", name: "경영진 방", rateLimitPerMin: "30", digestWindowSec: "0", enabled: "on", "cfg.chatIds": "-100777\n-100778", baseVersion: "1" });
    expect(updated.response.status).toBe(200);
    expect(state().channels.at(-1)).toMatchObject({ name: "경영진 방", rateLimitPerMin: 30, config: { chatIds: [-100777, -100778] }, secret: { webhookSecret: "exec_secret" } });
    const put = sent("/api/v1/core/notification-channels/").filter((r) => r.method === "PUT").at(-1)!.body as Record<string, unknown>;
    expect(put).not.toHaveProperty("secret");
    const inUse = await browser.post("/admin/channels?edit=51", { intent: "delete", id: "51" });
    expect(inUse.response.status).toBe(409);
    expect(inUse.body).toContain("지울 수 없습니다");
    const removed = await browser.post(`/admin/channels?edit=${channel.id}`, { intent: "delete", id: channel.id });
    expect(removed.response.status).toBe(302);
  });

  it("발송 이력(API-RUL-27 커서 목록, channelId)과 실패 건 다시 보내기(API-OPS-33), 채널 유형 API가 없으면 기본값", async () => {
    const browser = await admin();
    const history = await browser.get("/admin/channels?edit=51&tab=deliveries");
    expect(history.body).toContain("429 Too Many Requests");
    expect(sent("/api/v1/core/notification-deliveries?").at(-1)!.path).toContain("channelId=51");
    const resent = await browser.post("/admin/channels?edit=51&tab=deliveries", { intent: "resend", deliveryId: "d-2" });
    expect(resent.body).toContain("다시 보냈습니다");
    expect(state().deliveries[0].status).toBe("PENDING");
    state().channelTypes = null;
    const fallback = await browser.get("/admin/channels");
    expect(fallback.body).toContain('href="/admin/channels?new=TELEGRAM"');
  });
});

describe("API-RUL-31 메신저 콜백(auth.md §9.3, RUL-05.02)", () => {
  const SECRET = "tg-webhook-secret-0123456789";

  it("세션·CSRF 없이 시크릿 헤더로 검증하고 action 내부 API로 넘긴다. 세션 쿠키를 만들지 않는다", async () => {
    app.reset({ DATA2FLOW_MESSENGER_TELEGRAM_SECRET: SECRET, DATA2FLOW_ACTION_URL: "http://data2flow-action" });
    const forwarded: { body: string; headers: Headers }[] = [];
    let release!: () => void;
    const arrived = new Promise<void>((resolve) => (release = resolve));
    app.server.use(
      http.post("http://data2flow-action/internal/action/notifications/callbacks/telegram", async ({ request }) => {
        forwarded.push({ body: await request.text(), headers: request.headers });
        release();
        return new HttpResponse(null, { status: 202 });
      }),
    );
    const body = JSON.stringify({ update_id: 900001, callback_query: { id: "cq", from: { id: 7001 }, data: "ACK:501:d-1" } });
    const response = await app.handler(new Request(`${ORIGIN}/hooks/messenger/telegram`, { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET }, body }));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    await arrived;
    expect(forwarded[0].body).toBe(body);
    expect(forwarded[0].headers.get("x-caller-service")).toBe("data2flow-web");
    // gateway는 거치지 않는다
    expect(app.gateway.received.filter((r) => r.path.includes("callbacks"))).toHaveLength(0);
    const wrong = await app.handler(new Request(`${ORIGIN}/hooks/messenger/telegram`, { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "x" }, body }));
    expect(wrong.status).toBe(401);
    expect((await app.handler(new Request(`${ORIGIN}/hooks/messenger/slack`, { method: "POST", body }))).status).toBe(404);
    expect((await app.handler(new Request(`${ORIGIN}/hooks/messenger/telegram`))).status).toBe(405);
  });

  it("비밀값이 설정되지 않으면 텔레그램 콜백도 404", async () => {
    const response = await app.handler(new Request(`${ORIGIN}/hooks/messenger/telegram`, { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET }, body: "{}" }));
    expect(response.status).toBe(404);
  });
});
