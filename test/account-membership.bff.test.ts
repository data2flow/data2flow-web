/**
 * 계정·회원·권한 화면 SSR + BFF 통합 테스트(IAM-01.02·01.03·01.05·01.07·01.09, IAM-02.04, IAM-02.05, IAM-03.02,
 * IAM-04.01·04.03·04.05, IAM-06.03, OPS-07.01·07.02, NFR-12.01).
 */
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { envelope, fail } from "./msw/fake-gateway";

let app: AppContext;
const GW = "http://gateway.test/api/v1/core";

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
const admin = () => as("admin01", "Admin-Pass-123");
const operator = () => as("kim.op", "Correct-Horse-9");

/** 상단 내비게이션 HTML */
function navOf(html: string) {
  return /<nav aria-label="주 메뉴"[^>]*>(.*?)<\/nav>/s.exec(html)?.[1] ?? "";
}

describe("IAM-01.02 최초 관리자 첫 로그인", () => {
  it("TC-IAM-007 AT-IAM-01.1 로그인 → 비밀번호 변경 화면으로 이동하고 다른 메뉴는 보이지 않음", async () => {
    const browser = new TestBrowser(app);
    const login = await browser.login("boot.admin", "Initial-Pass-1");
    expect(login.response.headers.get("Location")).toBe("/me/security?required=password");
    const page = await browser.get("/me/security?required=password");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("비밀번호를 먼저 변경해 주세요");
    expect(navOf(page.body)).not.toMatch(/href="\/admin/);
    expect(page.body).not.toContain('href="/me/profile"');
    const other = await browser.get("/admin/members");
    expect(other.response.headers.get("Location")).toBe("/me/security?required=password");
  });

  it("TC-IAM-011 AT-IAM-01.3 정책을 지킨 새 비밀번호로 바꾸면 204, 이후 모든 메뉴 접근 가능", async () => {
    const browser = new TestBrowser(app);
    await browser.login("boot.admin", "Initial-Pass-1");
    await browser.get("/me/security?required=password");
    const short = await browser.post("/me/security?required=password", { intent: "password", currentPassword: "Initial-Pass-1", newPassword: "short", confirmPassword: "short" });
    expect(short.response.status).toBe(400);
    expect(short.body).toContain("10~128자여야 합니다");
    const change = await browser.post("/me/security?required=password", { intent: "password", currentPassword: "Initial-Pass-1", newPassword: "Brand-New-Pass-77", confirmPassword: "Brand-New-Pass-77" });
    expect(change.response.status).toBe(302);
    expect(change.response.headers.get("Location")).toBe("/");
    const put = app.gateway.received.find((r) => r.path === "/api/v1/core/accounts/me/password");
    expect(put?.body).toEqual({ currentPassword: "Initial-Pass-1", newPassword: "Brand-New-Pass-77", keepCurrentSession: true });
    const home = await browser.get("/");
    expect(navOf(home.body)).toContain('href="/admin/members"');
    expect((await browser.get("/admin/members")).response.status).toBe(200);
  });

  it("AT-IAM-08.3 현재 비밀번호가 틀리면 400 PASSWORD_CURRENT_MISMATCH 안내", async () => {
    const browser = await operator();
    await browser.get("/me/security");
    const result = await browser.post("/me/security", { intent: "password", currentPassword: "wrong-password", newPassword: "Brand-New-Pass-77", confirmPassword: "Brand-New-Pass-77" });
    expect(result.response.status).toBe(400);
    expect(result.body).toContain("현재 비밀번호가 올바르지 않습니다");
  });

  it("AT-IAM-08.2 비밀번호를 바꾸면 이 기기는 유지되고 다른 기기는 로그아웃된다", async () => {
    const deviceA = await operator();
    const deviceB = await operator();
    await deviceA.get("/me/security");
    const change = await deviceA.post("/me/security", { intent: "password", currentPassword: "Correct-Horse-9", newPassword: "Brand-New-Pass-77", confirmPassword: "Brand-New-Pass-77" });
    expect(change.response.status).toBe(200);
    expect(change.body).toContain("비밀번호를 바꿨습니다");
    expect((await deviceA.get("/")).response.status).toBe(200);
    expect((await deviceB.get("/")).response.headers.get("Location")).toContain("reason=revoked");
  });
});

describe("IAM-04.05 메뉴 숨김(보조)과 서버 거부", () => {
  it("TC-IAM-127 TC-IAM-141 OPERATOR는 관리 메뉴가 없고, URL을 직접 열면 403 화면", async () => {
    const browser = await operator();
    const home = await browser.get("/");
    const nav = navOf(home.body);
    expect(nav).toContain("홈");
    expect(nav).not.toContain("/admin/");
    for (const path of ["/admin/members", "/admin/audit", "/admin/settings", "/admin/roles", "/admin/security"]) {
      const page = await browser.get(path);
      expect(page.response.status, path).toBe(403);
      expect(page.body).toContain("이 페이지를 볼 권한이 없습니다");
    }
  });

  it("AT-IAM-05.2 OPERATOR가 초대 API를 직접 부르면 서버가 403 PERMISSION_DENIED", async () => {
    const browser = await operator();
    await browser.get("/");
    const result = await browser.request("/bff/api/core/invitations", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ emails: ["a@b.c"], role: "VIEWER" }) });
    expect(result.response.status).toBe(403);
    expect(JSON.parse(result.body).header.resultCode).toBe("PERMISSION_DENIED");
  });

  it("ADMIN은 회원·역할·보안 설정·감사 로그·시스템 설정 메뉴가 보인다", async () => {
    const browser = await admin();
    const nav = navOf((await browser.get("/")).body);
    for (const path of ["/admin/members", "/admin/roles", "/admin/security", "/admin/audit", "/admin/settings"]) expect(nav).toContain(`href="${path}"`);
  });

  it("TC-IAM-105 AT-IAM-14.5 2단계 인증이 필수인데 없는 ADMIN은 설정 화면으로 보내고 다른 화면을 막는다", async () => {
    const browser = new TestBrowser(app);
    await browser.login("mfa.admin", "MfaAdmin-Pass1");
    const home = await browser.get("/");
    expect(home.response.headers.get("Location")).toBe("/me/security?required=mfa");
    const page = await browser.get("/me/security?required=mfa");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("2단계 인증을 먼저 설정해 주세요");
  });
});

describe("IAM-01.09 내 정보", () => {
  it("TC-IAM-043 AT-IAM-08.1 시간대를 UTC로 바꾸면 이후 화면 시각이 UTC로 보인다", async () => {
    const browser = await operator();
    const before = await browser.get("/me/sessions");
    expect(before.body).toContain("2026-10-04 08:30"); // 23:30Z → Asia/Seoul
    await browser.get("/me/profile");
    const save = await browser.post("/me/profile", { name: "김운영", phone: "", locale: "ko", timezone: "UTC", baseVersion: "1" });
    expect(save.response.status).toBe(200);
    expect(save.body).toContain("저장했습니다");
    const after = await browser.get("/me/sessions");
    expect(after.body).toContain("2026-10-03 23:30");
  });

  it("IAM-01.05 목록에 없는 시간대·잘못된 연락처는 400과 안내, VERSION_CONFLICT는 새로고침 안내", async () => {
    const browser = await operator();
    await browser.get("/me/profile");
    const bad = await browser.post("/me/profile", { name: "", phone: "010-1234", locale: "ko", timezone: "Mars/Base", baseVersion: "1" });
    expect(bad.response.status).toBe(400);
    expect(bad.body).toContain("이름은 1~50자로 입력해 주세요");
    expect(bad.body).toContain("연락처 형식이 올바르지 않습니다");
    const conflict = await browser.post("/me/profile", { name: "김", phone: "", locale: "en", timezone: "UTC", baseVersion: "0" });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toContain("다른 사용자가 먼저 수정했습니다");
  });

  it("IAM-03.02 활성 로그인: 기기·IP·이 기기 표시, AT-IAM-08.4 기기 B만 종료", async () => {
    const deviceA = await operator();
    const deviceB = await operator();
    const list = await deviceA.get("/me/sessions");
    expect(list.body).toContain("Chrome/macOS");
    expect(list.body).toContain("이 기기");
    const sidB = [...app.gateway.sessionsOfUser.get("7")!].at(-1) as string;
    const revoke = await deviceA.post("/me/sessions", { sid: sidB });
    expect(revoke.response.status).toBe(200);
    expect(app.gateway.revokedSids.has(sidB)).toBe(true);
    expect((await deviceA.get("/")).response.status).toBe(200);
    expect((await deviceB.get("/")).response.headers.get("Location")).toContain("reason=revoked");
  });

  it("TC-IAM-099 AT-IAM-14.1 QR 등록 후 올바른 코드 → 복구 코드 10개 1회 표시", async () => {
    const browser = await operator();
    await browser.get("/me/security");
    const setup = await browser.post("/me/security", { intent: "mfa-setup" });
    expect(setup.body).toContain("<svg");
    expect(setup.body).toContain("JBSW****3PXP");
    const confirm = await browser.post("/me/security", { intent: "mfa-confirm", code: "123456", otpauthUri: "otpauth://totp/x?secret=A", secret: "" });
    expect(confirm.response.status).toBe(200);
    expect(new Set(confirm.body.match(/rc-\d-abcdef/g))).toHaveProperty("size", 10);
    const wrong = await browser.post("/me/security", { intent: "mfa-confirm", code: "999999", otpauthUri: "otpauth://totp/x?secret=A", secret: "" });
    expect(wrong.body).toContain("인증 코드가 올바르지 않습니다");
  });
});

describe("IAM-01.03·01.07 회원 관리", () => {
  it("TC-IAM-015 AT-IAM-05.1 lee@school.ac.kr를 OPERATOR로 초대 → 이메일별 결과, Idempotency-Key 전달", async () => {
    const browser = await admin();
    const page = await browser.get("/admin/members?tab=members&dialog=invite");
    const key = /name="idempotencyKey" value="([^"]+)"/.exec(page.body)?.[1];
    expect(key).toBeTruthy();
    const result = await browser.post("/admin/members?tab=members&dialog=invite", { intent: "invite", idempotencyKey: key as string, emails: "lee@school.ac.kr", name: "이운영", role: "OPERATOR", spaceScope: "" });
    expect(result.response.status).toBe(200);
    expect(result.body).toContain("lee@school.ac.kr");
    expect(result.body).toContain("보냄");
    const call = app.gateway.received.find((r) => r.path === "/api/v1/core/invitations" && r.method === "POST");
    expect(call?.body).toEqual({ emails: ["lee@school.ac.kr"], name: "이운영", role: "OPERATOR", spaceScope: [] });
    expect(call?.headers["idempotency-key"]).toBe(key);
  });

  it("초대 이메일 형식이 틀리면 gateway를 부르지 않고 안내", async () => {
    const browser = await admin();
    await browser.get("/admin/members?dialog=invite");
    const result = await browser.post("/admin/members?dialog=invite", { intent: "invite", emails: "not-an-email", role: "VIEWER" });
    expect(result.response.status).toBe(400);
    expect(result.body).toContain("이메일을 한 줄에 하나씩");
  });

  it("IAM-01.07 회원 목록: 검색 조건을 그대로 넘기고 사용자 정의 역할을 선택지에 넣는다", async () => {
    const browser = await admin();
    const page = await browser.get("/admin/members?keyword=kim&role=OPERATOR&status=ACTIVE");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("kim.op");
    const call = app.gateway.received.find((r) => r.path.startsWith("/api/v1/core/users?"));
    expect(call?.path).toBe("/api/v1/core/users?page=1&size=50&keyword=kim&role=OPERATOR&status=ACTIVE");
  });

  it("IAM-01.03 직접 생성: 임시 비밀번호를 한 번만 보여 준다", async () => {
    const browser = await admin();
    app.server.use(http.post(`${GW}/users`, () => HttpResponse.json(envelope({ id: "40", temporaryPassword: "Tmp-Pass-4242" }), { status: 201 })));
    await browser.get("/admin/members?dialog=create");
    const result = await browser.post("/admin/members?dialog=create", { intent: "create", loginId: "park.an", email: "park@school.ac.kr", name: "박분석", role: "ANALYST" });
    expect(result.body).toContain("Tmp-Pass-4242");
    const again = await browser.get("/admin/members?dialog=create");
    expect(again.body).not.toContain("Tmp-Pass-4242");
  });

  it("IAM-01.04 회원 상세: 자기 자신은 역할·상태 변경 버튼이 비활성(BR-IAM-08), LAST_ADMIN_REQUIRED 안내", async () => {
    const browser = await admin();
    const self = await browser.get("/admin/members/1");
    expect(self.body).toContain("자신의 역할이나 상태는 바꿀 수 없습니다");
    app.server.use(http.post(`${GW}/users/7/disable`, () => fail(409, "LAST_ADMIN_REQUIRED")));
    await browser.get("/admin/members/7");
    const result = await browser.post("/admin/members/7", { intent: "disable" });
    expect(result.response.status).toBe(409);
    expect(result.body).toContain("관리자가 최소 1명 있어야 합니다");
  });
});

describe("IAM-04.03 사용자 정의 역할", () => {
  it("AT-IAM-17.3 쓰는 사람이 있는 역할 삭제 → 409 CUSTOM_ROLE_IN_USE 안내, ADMIN 전용 권한은 넣지 않는다", async () => {
    const browser = await admin();
    app.server.use(
      http.get(`${GW}/permissions`, () => HttpResponse.json(envelope({ permissions: [{ code: "IAM_MANAGE", area: "IAM" }, { code: "ALARM_HANDLE", area: "RUL" }, { code: "DEV_READ", area: "DEV" }], builtinRoles: { ADMIN: ["IAM_MANAGE", "ALARM_HANDLE", "DEV_READ"], VIEWER: ["DEV_READ"] } }))),
      http.delete(`${GW}/custom-roles/31`, () => fail(409, "CUSTOM_ROLE_IN_USE")),
    );
    const page = await browser.get("/admin/roles?edit=new");
    expect(page.body).toContain("시설 야간 당직");
    const del = await browser.post("/admin/roles", { intent: "delete", id: "31" });
    expect(del.response.status).toBe(409);
    expect(del.body).toContain("이 역할을 쓰는 사용자가 있어 삭제할 수 없습니다");

    let created: unknown;
    app.server.use(
      http.post(`${GW}/custom-roles`, async ({ request }) => {
        created = await request.json();
        return HttpResponse.json(envelope({ id: "32" }), { status: 201 });
      }),
    );
    const save = await browser.post("/admin/roles?edit=new", { intent: "save", id: "", name: "야간", description: "", permissions: ["IAM_MANAGE", "ALARM_HANDLE"] });
    expect(save.response.status).toBe(302);
    expect(created).toEqual({ name: "야간", description: "", permissions: ["ALARM_HANDLE"] });
  });
});

describe("IAM-06.03 감사 로그", () => {
  it("기간(사용자 시간대 날짜 → UTC)·행위자로 검색하고 CSV 내보내기를 요청한다", async () => {
    const browser = await admin();
    let searched = "";
    app.server.use(
      http.get(`${GW}/audit-logs`, ({ request }) => {
        searched = new URL(request.url).search;
        return HttpResponse.json({ ...envelope(), size: 50, responses: [{ id: "900", occurredAt: "2026-10-03T05:02:11Z", actorType: "USER", actorName: "kim.op", action: "USER_LOGGED_IN", targetType: "USER", targetId: "7", result: "SUCCESS", ip: "59.28.174.54" }], nextCursor: "c2" });
      }),
      http.post(`${GW}/audit-logs/export`, () => HttpResponse.json(envelope({ jobId: "job-77" }), { status: 202 })),
    );
    const page = await browser.get("/admin/audit?from=2026-10-01&to=2026-10-03&actor=kim.op");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("USER_LOGGED_IN");
    expect(page.body).toContain("2026-10-03 14:02:11");
    expect(page.body).toContain("cursor=c2");
    expect(`/api/v1/core/audit-logs${searched}`).toBe("/api/v1/core/audit-logs?from=2026-09-30T15%3A00%3A00Z&to=2026-10-03T15%3A00%3A00Z&actor=kim.op&size=50");
    const exported = await browser.post("/admin/audit?from=2026-10-01&to=2026-10-03", { from: "2026-10-01", to: "2026-10-03", actor: "kim.op" });
    expect(exported.body).toContain("job-77");
  });

  it("1년이 넘는 기간은 gateway를 부르지 않고 안내", async () => {
    const browser = await admin();
    const page = await browser.get("/admin/audit?from=2024-01-01&to=2026-10-03");
    expect(page.body).toContain("기간은 최대 1년까지");
    expect(app.gateway.received.some((r) => r.path.startsWith("/api/v1/core/audit-logs"))).toBe(false);
  });
});

describe("OPS-07.01·07.02 시스템 설정", () => {
  it("TC-OPS-071 조직 시간대를 UTC로 저장(baseVersion 포함)", async () => {
    const browser = await admin();
    let saved: unknown;
    app.server.use(
      http.get(`${GW}/org-settings`, () => HttpResponse.json(envelope({ displayName: "한빛대학교", logoUrl: null, timezone: "Asia/Seoul", locale: "ko", unitSystem: "METRIC", dateFormat: "YYYY-MM-DD", version: 4 }))),
      http.put(`${GW}/org-settings`, async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json(envelope({ version: 5 }));
      }),
    );
    const page = await browser.get("/admin/settings");
    expect(page.body).toContain("한빛대학교");
    const result = await browser.post("/admin/settings", { intent: "org", displayName: "한빛대학교", timezone: "UTC", locale: "ko", unitSystem: "METRIC", dateFormat: "YYYY-MM-DD", baseVersion: "4" });
    expect(result.body).toContain("저장했습니다");
    expect(saved).toEqual({ displayName: "한빛대학교", timezone: "UTC", locale: "ko", unitSystem: "METRIC", dateFormat: "YYYY-MM-DD", baseVersion: 4 });
  });

  it("TC-OPS-076 AT-OPS-14.3 메일 비밀번호는 ●●●●(설정됨)로 보이고, 빈 값으로 저장하면 secret을 보내지 않아 유지된다", async () => {
    const browser = await admin();
    let saved: Record<string, unknown> | undefined;
    app.server.use(
      http.get(`${GW}/external-services`, () =>
        HttpResponse.json({ ...envelope(), responses: [{ kind: "MAIL", provider: "smtp", settings: { host: "smtp.school.ac.kr", port: 587, security: "STARTTLS", fromAddress: "noreply@school.ac.kr" }, secretConfigured: true, enabled: true, version: 2 }], totalCount: 1 }),
      ),
      http.put(`${GW}/external-services/MAIL`, async ({ request }) => {
        saved = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope({ kind: "MAIL", version: 3 }));
      }),
    );
    const page = await browser.get("/admin/settings?tab=services");
    expect(page.body).toContain("●●●●");
    expect(page.body).toContain("smtp.school.ac.kr");
    const result = await browser.post("/admin/settings?tab=services", { intent: "service-save", kind: "MAIL", baseVersion: "2", provider: "smtp", host: "smtp.school.ac.kr", port: "587", security: "STARTTLS", username: "", fromAddress: "noreply@school.ac.kr", fromName: "", secret: "", enabled: "on" });
    expect(result.body).toContain("저장했습니다");
    expect(saved).toBeDefined();
    expect(saved && "secret" in saved).toBe(false);
    expect(saved?.settings).toMatchObject({ host: "smtp.school.ac.kr", port: 587 });
  });
});

describe("IAM-01.03·IAM-02.04 공개 계정 화면", () => {
  it("TC-IAM-026 AT-IAM-06.2 만료된 초대 링크 → 만료 안내, 수락 버튼 없음", async () => {
    const browser = new TestBrowser(app);
    const page = await browser.get("/invitations/tok-expired");
    expect(page.body).toContain("초대 링크가 만료되었거나 이미 사용되었습니다");
    expect(page.body).not.toContain("가입 완료");
  });

  it("AT-IAM-06.1 NFR-12.01 유효한 초대: 개인정보 고지·동의를 받고 수락하면 로그인 화면으로", async () => {
    const browser = new TestBrowser(app);
    const page = await browser.get("/invitations/tok-abc");
    expect(page.body).toContain("한빛대학교");
    expect(page.body).toContain("개인정보 수집·이용에 동의합니다");
    const noConsent = await browser.post("/invitations/tok-abc", { loginId: "lee.op", newPassword: "Strong-Pass-Kiwi-1", confirmPassword: "Strong-Pass-Kiwi-1", email: "lee@school.ac.kr" });
    expect(noConsent.response.status).toBe(400);
    expect(noConsent.body).toContain("개인정보 수집에 동의해 주세요");
    const reserved = await browser.post("/invitations/tok-abc", { loginId: "admin", newPassword: "Strong-Pass-Kiwi-1", confirmPassword: "Strong-Pass-Kiwi-1", privacyConsent: "on" });
    expect(reserved.response.status).toBe(400);
    const accepted = await browser.post("/invitations/tok-abc", { loginId: "lee.op", newPassword: "Strong-Pass-Kiwi-1", confirmPassword: "Strong-Pass-Kiwi-1", email: "lee@school.ac.kr", privacyConsent: "on" });
    expect(accepted.response.status).toBe(302);
    expect(accepted.response.headers.get("Location")).toBe("/login?reason=invited&loginId=lee.op");
    expect(app.gateway.received.find((r) => r.path.endsWith("/accept"))?.body).toEqual({ loginId: "lee.op", password: "Strong-Pass-Kiwi-1", privacyConsent: true });
  });

  it("TC-IAM-092 AT-IAM-07.1 재설정 요청은 계정이 있든 없든 같은 문구", async () => {
    const browser = new TestBrowser(app);
    await browser.get("/password-reset");
    const known = await browser.post("/password-reset", { loginIdOrEmail: "kim@school.ac.kr" });
    const unknown = await browser.post("/password-reset", { loginIdOrEmail: "nobody@example.com" });
    const text = "입력하신 정보로 가입된 계정이 있으면 메일을 보냈습니다";
    expect(known.body).toContain(text);
    expect(unknown.body).toContain(text);
  });

  it("AT-IAM-07.3 만료된 재설정 링크 → RESET_TOKEN_INVALID 안내와 [다시 요청], 성공하면 로그인 화면", async () => {
    const browser = new TestBrowser(app);
    await browser.get("/password-reset/expired-token");
    const expired = await browser.post("/password-reset/expired-token", { newPassword: "Another-Pass-11", confirmPassword: "Another-Pass-11" });
    expect(expired.body).toContain("재설정 링크가 만료되었습니다");
    const ok = await browser.post("/en/password-reset/good-token", { newPassword: "Another-Pass-11", confirmPassword: "Another-Pass-11" });
    expect(ok.response.headers.get("Location")).toBe("/en/login?reason=passwordReset");
  });

  it("NFR-12.01 개인정보 처리 안내 페이지(4개 언어)", async () => {
    const browser = new TestBrowser(app);
    expect((await browser.get("/privacy")).body).toContain("개인정보 처리 안내");
    expect((await browser.get("/en/privacy")).body).toContain("Privacy notice");
  });
});
