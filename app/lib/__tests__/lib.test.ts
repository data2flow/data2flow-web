import { describe, expect, it, vi } from "vitest";
import { auditQuery } from "../audit";
import { bffFetch, csrfTokenFromDocument } from "../bff-client";
import { errorText, policyErrorText } from "../error-text";
import { buildServiceBody } from "../external-services";
import { COMMON_TIMEZONES, formatDateTime, isValidTimezone, resolveTimezone, zonedDate, zonedDayStartUtc } from "../format";
import { safeNextPath } from "../next-path";
import { MENU, isMenuActive, hasAny, requiredPermissionsFor, visibleMenu } from "../permissions";
import { isPublicPath } from "../public-paths";
import { parseRole, parseScope, roleValue } from "../roles";
import { announceLogout, onLogout } from "../session-broadcast";
import { describeUserAgent } from "../user-agent";
import { checkLoginId, checkName, checkPassword, parseEmails, passwordStrength } from "../validation";

describe("next-path AT-IAM-02.8 복귀 경로 검사", () => {
  it.each([
    ["/me/profile?tab=1#x", "/me/profile?tab=1#x"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["/bff/api/core/x", "/"],
    ["/logout", "/"],
    ["/a\nb", "/"],
    [null, "/"],
    ["", "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input as string | null)).toBe(expected);
  });
});

describe("validation BR-IAM-02·03", () => {
  it("아이디 형식·예약어", () => {
    expect(checkLoginId("")).toBe("required");
    expect(checkLoginId("ab")).toBe("format");
    expect(checkLoginId("Admin")).toBe("reserved");
    expect(checkLoginId("Kim.Op")).toBeUndefined();
  });
  it("비밀번호 길이·아이디·이메일 포함·확인 불일치", () => {
    expect(checkPassword("")).toBe("required");
    expect(checkPassword("short")).toBe("length");
    expect(checkPassword("kim.op-Strong-1", { loginId: "kim.op" })).toBe("containsLoginId");
    expect(checkPassword("Lee-Strong-Pass-1", { email: "lee@school.ac.kr" })).toBe("containsEmail");
    expect(checkPassword("Strong-Pass-123", { confirm: "x" })).toBe("mismatch");
    expect(checkPassword("Strong-Pass-123", { confirm: "Strong-Pass-123", loginId: "ab" })).toBeUndefined();
    expect([passwordStrength(""), passwordStrength("abcdefghij"), passwordStrength("Abcdefghij1!xyz")]).toEqual([0, 1, 4]);
  });
  it("이름·이메일 목록", () => {
    expect(checkName(" ")).toBe("required");
    expect(checkName("x".repeat(51))).toBe("length");
    expect(checkName("김")).toBeUndefined();
    expect(parseEmails("a@b.co\nA@B.co, bad;c@d.io")).toEqual({ emails: ["a@b.co", "c@d.io"], invalid: ["bad"] });
  });
});

describe("format AT-IAM-08.1 시간대 표시", () => {
  it("UTC 저장 → 사용자 시간대 표시", () => {
    expect(formatDateTime("2026-10-03T23:30:00Z", "Asia/Seoul")).toBe("2026-10-04 08:30");
    expect(formatDateTime("2026-10-03T23:30:05Z", "UTC", "en", true)).toBe("2026-10-03 23:30:05");
    expect(formatDateTime(undefined, "UTC")).toBe("–");
    expect(formatDateTime("nope", "UTC")).toBe("–");
    expect(isValidTimezone("Mars/Base")).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
    expect(resolveTimezone("Mars/Base", null, "UTC")).toBe("UTC");
    expect(resolveTimezone()).toBe("Asia/Seoul");
    expect(COMMON_TIMEZONES).toContain("UTC");
  });
  it("시간대 날짜의 0시 → UTC, 오늘 ± n일", () => {
    expect(zonedDayStartUtc("2026-10-01", "Asia/Seoul")).toBe("2026-09-30T15:00:00Z");
    expect(zonedDayStartUtc("2026-10-01", "UTC")).toBe("2026-10-01T00:00:00Z");
    expect(zonedDayStartUtc("2026-03-08", "America/New_York")).toBe("2026-03-08T05:00:00Z");
    expect(zonedDayStartUtc("bad", "UTC")).toBeUndefined();
    expect(zonedDate(Date.parse("2026-10-03T16:00:00Z"), "Asia/Seoul")).toBe("2026-10-04");
    expect(zonedDate(Date.parse("2026-10-03T16:00:00Z"), "UTC", -7)).toBe("2026-09-26");
  });
  it("감사 로그 기간: 기본 최근 7일, to는 다음 날 0시(제외), 1년 초과 표시", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    const q = auditQuery(new URLSearchParams("actor=kim&result=FAILURE"), "UTC", now);
    expect(q.fromDate).toBe("2026-09-27");
    expect(q.query.get("to")).toBe("2026-10-05T00:00:00Z");
    expect(q.query.get("actor")).toBe("kim");
    expect(q.tooLong).toBe(false);
    expect(auditQuery(new URLSearchParams("from=2024-01-01&to=2026-01-01"), "UTC", now).tooLong).toBe(true);
    expect(auditQuery(new URLSearchParams("from=garbage"), "UTC", now).fromDate).toBe("2026-09-27");
  });
});

describe("permissions IAM-04.05 메뉴 숨김", () => {
  it("권한별 메뉴, 비밀번호 변경 필요 시 메뉴 없음, 경로별 필요 권한", () => {
    expect(visibleMenu(["DEV_READ"]).map((m) => m.key)).toEqual(["home", "spaces", "devices"]);
    // M5 data: 시스템 상태(저장 지표)는 OPS_MANAGE, 데이터 보관은 TS_POLICY, 내보내기·가져오기는 데이터 탐색 메뉴 아래
    expect(visibleMenu(["IAM_MANAGE", "AUDIT_READ", "OPS_MANAGE"]).map((m) => m.key)).toEqual(["home", "members", "roles", "security", "audit", "settings", "system"]);
    expect(visibleMenu(["TS_POLICY"]).map((m) => m.key)).toEqual(["home", "dataRetention"]);
    expect(requiredPermissionsFor("/exports")).toEqual(["TS_READ"]);
    expect(requiredPermissionsFor("/imports/9")).toEqual(["TS_IMPORT"]);
    expect(requiredPermissionsFor("/settings/data-retention")).toEqual(["TS_POLICY"]);
    expect(isMenuActive(MENU.find((m) => m.key === "explore")!, "/imports/new")).toBe(true);
    expect(visibleMenu(["IAM_MANAGE", "AUDIT_READ", "OPS_MANAGE", "DEV_READ", "TS_READ", "INGEST_READ", "FLOW_READ", "DEVICE_CONTROL", "SIM_READ", "ALARM_READ", "DEV_PLACE", "NOTIFY_CHANNEL_MANAGE", "TS_POLICY", "DASHBOARD_READ", "BRANDING_MANAGE"])).toHaveLength(MENU.length);
    // M4: 규칙·알람(ALARM_READ, 모든 역할), 유지보수 일정(DEV_PLACE), 알림 채널(NOTIFY_CHANNEL_MANAGE)
    expect(visibleMenu(["ALARM_READ"]).map((m) => m.key)).toEqual(["home", "alarms"]);
    expect(requiredPermissionsFor("/rules/r-1")).toEqual(["RULE_READ"]);
    expect(requiredPermissionsFor("/alarms/a-1")).toEqual(["ALARM_READ"]);
    expect(requiredPermissionsFor("/alarms/stats")).toEqual(["RULE_READ"]);
    expect(requiredPermissionsFor("/notifications/silences")).toEqual(["ALARM_HANDLE", "NOTIFY_POLICY_WRITE"]);
    // M3: 자동화(FLOW_READ)·제어(DEVICE_CONTROL)·가상 환경(SIM_READ)
    expect(visibleMenu(["FLOW_READ", "SIM_READ"]).map((m) => m.key)).toEqual(["home", "automation", "sim"]);
    expect(requiredPermissionsFor("/automation/flows/f-1")).toEqual(["FLOW_READ"]);
    expect(requiredPermissionsFor("/automation/flows/new")).toEqual(["FLOW_WRITE"]);
    expect(requiredPermissionsFor("/automation/templates")).toEqual(["FLOW_WRITE"]);
    expect(requiredPermissionsFor("/sim/runs/r-1")).toEqual(["SIM_READ"]);
    expect(requiredPermissionsFor("/control/commands")).toEqual(["DEV_READ"]);
    expect(isMenuActive(MENU.find((m) => m.key === "automation")!, "/automation/templates")).toBe(true);
    expect(visibleMenu(["IAM_MANAGE"], true)).toEqual([]);
    expect(visibleMenu(undefined).map((m) => m.key)).toEqual(["home"]);
    expect(requiredPermissionsFor("/admin/members/7")).toEqual(["IAM_MANAGE"]);
    expect(requiredPermissionsFor("/admin/audit")).toEqual(["AUDIT_READ"]);
    expect(requiredPermissionsFor("/me")).toEqual([]);
    // M2 경로: 가장 긴 접두사(TC-DSC-008 새 소스는 INTEGRATOR 이상, UI-DEV-07 기기 추가는 DEV_ADMIN)
    expect(requiredPermissionsFor("/sources/new/mqtt")).toEqual(["SRC_ADMIN"]);
    expect(requiredPermissionsFor("/sources/7")).toEqual(["SRC_READ"]);
    expect(requiredPermissionsFor("/devices/new")).toEqual(["DEV_ADMIN"]);
    expect(requiredPermissionsFor("/devices/1042")).toEqual(["DEV_READ"]);
    expect(requiredPermissionsFor("/ingest/failures")).toEqual(["INGEST_READ"]);
    expect(requiredPermissionsFor("/scripts/3")).toEqual(["SCRIPT_READ"]);
    expect(isMenuActive(MENU.find((m) => m.key === "ingest")!, "/sources/7")).toBe(true);
    expect(isMenuActive(MENU.find((m) => m.key === "devices")!, "/models")).toBe(true);
    expect(isMenuActive(MENU[0], "/devices")).toBe(false);
    expect(isMenuActive(MENU[0], "/")).toBe(true);
    expect(hasAny(undefined, ["X"])).toBe(false);
  });
});

describe("기타 도우미", () => {
  it("공개 경로(언어 접두사 포함)", () => {
    expect(isPublicPath("/en/login")).toBe(true);
    expect(isPublicPath("/invitations/x")).toBe(true);
    expect(isPublicPath("/admin/members")).toBe(false);
  });
  it("역할 값·공간 목록", () => {
    expect(parseRole("CUSTOM:31")).toEqual({ role: "CUSTOM", customRoleId: "31" });
    expect(parseRole("ADMIN")).toEqual({ role: "ADMIN" });
    expect(roleValue("CUSTOM", "31")).toBe("CUSTOM:31");
    expect(roleValue("VIEWER", null)).toBe("VIEWER");
    expect(roleValue(undefined)).toBe("");
    expect(parseScope(" 1, 2 3 ")).toEqual(["1", "2", "3"]);
  });
  it("User-Agent → 브라우저/OS", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130 Safari/537")).toBe("Chrome/macOS");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS) Version/17 Safari/604")).toBe("Safari/iOS");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Edg/120")).toBe("Edge/Windows");
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux) Firefox/120")).toBe("Firefox/Linux");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14) OPR/80")).toBe("Opera/Android");
    expect(describeUserAgent("curl/8")).toBe("Browser/OS");
    expect(describeUserAgent(undefined)).toBe("–");
  });
  it("오류 문구는 resultCode로, 없으면 서버 문구·일반 문구", () => {
    const t = ((key: string, options?: { defaultValue?: string; n?: number }) => (key === "errors.AUTH_RATE_LIMITED" ? `wait ${options?.n}` : key === "errors.UNKNOWN" ? "unknown" : (options?.defaultValue ?? key))) as never;
    expect(errorText(t, { code: "AUTH_RATE_LIMITED", retryAfter: 5 })).toBe("wait 5");
    expect(errorText(t, { code: "X_CODE", message: "server says" })).toBe("server says");
    expect(errorText(t, { code: "X_CODE", message: "X_CODE" })).toBe("unknown");
    expect(errorText(t, null)).toBeUndefined();
    expect(policyErrorText(t, { code: "PASSWORD_POLICY_VIOLATION", message: "비밀번호 규칙에 맞지 않습니다: 유출된 비밀번호" })).toContain("유출");
    expect(policyErrorText(t, { code: "PASSWORD_POLICY_VIOLATION" })).toBe("unknown");
  });
  it("외부 서비스 본문: 메일 검증, 빈 비밀값은 보내지 않음(BR-OPS-05), JSON 설정", () => {
    const mail = new FormData();
    for (const [k, v] of Object.entries({ host: "smtp", port: "587", fromAddress: "a@b.co", secret: "pw", enabled: "on", baseVersion: "2" })) mail.set(k, v);
    expect(buildServiceBody("MAIL", mail)).toEqual({ body: { provider: "smtp", settings: { host: "smtp", port: 587, security: "STARTTLS", username: undefined, fromAddress: "a@b.co", fromName: undefined }, enabled: true, baseVersion: 2, secret: "pw" } });
    const bad = new FormData();
    bad.set("port", "0");
    expect(buildServiceBody("MAIL", bad)).toEqual({ invalid: ["host", "port", "fromAddress"] });
    const llm = new FormData();
    llm.set("provider", "anthropic");
    llm.set("settingsJson", '{"model":"x"}');
    expect(buildServiceBody("LLM", llm)).toMatchObject({ body: { provider: "anthropic", settings: { model: "x" }, enabled: false } });
    llm.set("settingsJson", "[1]");
    llm.set("provider", "");
    expect(buildServiceBody("LLM", llm)).toEqual({ invalid: ["settingsJson", "provider"] });
    llm.delete("settingsJson");
    llm.set("provider", "p");
    expect(buildServiceBody("LLM", llm)).toMatchObject({ body: { settings: {} } });
  });
});

describe("session-broadcast·bff-client UI-IAM-13 탭 사이 로그아웃", () => {
  function fakeFactory() {
    const channels: { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void; close: () => void }[] = [];
    const factory = () => {
      const channel = {
        onmessage: null as ((e: MessageEvent) => void) | null,
        postMessage: (message: unknown) => channels.filter((c) => c !== channel).forEach((c) => c.onmessage?.({ data: message } as MessageEvent)),
        close: vi.fn(),
      };
      channels.push(channel);
      return channel;
    };
    return factory;
  }
  it("한 탭의 로그아웃을 다른 탭이 받는다", () => {
    const factory = fakeFactory();
    const handler = vi.fn();
    const stop = onLogout(handler, factory);
    announceLogout("revoked", factory);
    expect(handler).toHaveBeenCalledWith({ type: "logout", reason: "revoked" });
    stop();
    expect(onLogout(handler, undefined)()).toBeUndefined();
    expect(announceLogout("x", undefined)).toBeUndefined();
  });

  it("bffFetch: 상태 변경에 X-CSRF-TOKEN, 401이면 onUnauthorized", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls.push(init as RequestInit);
      return calls.length === 1 ? Response.json({}) : Response.json({ header: { resultCode: "AUTH_SESSION_REVOKED" } }, { status: 401 });
    });
    await bffFetch("/bff/api/core/x", { method: "POST" }, { fetchImpl: fetchImpl as never, csrfToken: "tok" });
    expect(new Headers(calls[0].headers).get("X-CSRF-TOKEN")).toBe("tok");
    const onUnauthorized = vi.fn();
    await bffFetch("/bff/api/core/x", {}, { fetchImpl: fetchImpl as never, onUnauthorized });
    expect(onUnauthorized).toHaveBeenCalledWith("AUTH_SESSION_REVOKED");
    expect(new Headers(calls[1].headers).get("X-CSRF-TOKEN")).toBeNull();
    expect(csrfTokenFromDocument(undefined)).toBeUndefined();
  });
});
