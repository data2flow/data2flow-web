/**
 * M5 사용자 정의 대시보드 SSR + BFF 통합: UI-DSH-04 목록·보기·편집(DSH-04.01·04.05·04.07, NFR-01.09), UI-DSH-06 키오스크(DSH-06.02),
 * UI-DSH-07 공유 링크(DSH-06.03, 로그인 없음), UI-DSH-13 브랜딩(DSH-13.01). 가짜 gateway: test/msw/handlers/dashboards.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { DASH_ID, PRIVATE_DASH_ID, SHARE_TOKEN, dashState } from "./msw/handlers/dashboards";

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
  await browser.get("/dashboards");
  return browser;
}
const operator = () => as("kim.op", "Correct-Horse-9");
const integrator = () => as("lee.int", "Integrator-Pass1");
const viewer = () => as("view.er", "Viewer-Pass-123");
const admin = () => as("admin01", "Admin-Pass-123");
const state = () => dashState(app.gateway.m2);
const received = (prefix: string) => app.gateway.received.filter((r) => r.path.startsWith(prefix));

function json(browser: TestBrowser, path: string, method: string, body: unknown) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify(body) });
}

describe("DSH-04.07 UI-DSH-04 대시보드 목록", () => {
  it("TC-DSH-049: 탭(내 것·공유), 기본 대시보드 별 표시, 위젯 수·공개 범위", async () => {
    const op = await operator();
    const mine = await op.get("/dashboards");
    expect(mine.response.status).toBe(200);
    expect(mine.body).toContain("실습실 운영");
    expect(mine.body).toContain("내 개인 보드");
    expect(mine.body).toContain("위젯 5개");
    expect(mine.body).toContain('aria-current="page"');

    const shared = await op.get("/dashboards?tab=shared");
    expect(shared.body).toContain("실습실 운영");
    expect(shared.body).not.toContain("내 개인 보드");

    const set = await op.post("/dashboards", { intent: "default", id: DASH_ID });
    expect(set.response.status).toBe(200);
    const after = await op.get("/dashboards");
    expect(after.body).toContain("★ 기본");
  });

  it("TC-DSH-046 AT-DSH-04.1: 기본 대시보드로 지정하면 로그인 뒤 첫 화면(/)이 그 대시보드로 열린다, /?summary는 홈 요약", async () => {
    const op = await operator();
    await op.post("/dashboards", { intent: "default", id: DASH_ID });
    const home = await op.get("/");
    expect(home.response.status).toBe(302);
    expect(home.response.headers.get("Location")).toBe(`/dashboards/${DASH_ID}`);
    const summary = await op.get("/?summary");
    expect(summary.response.status).toBe(200);
    const unset = await op.post("/dashboards", { intent: "default", id: "" });
    expect(unset.response.status).toBe(200);
    expect((await op.get("/")).response.status).toBe(200);
  });

  it("TC-DSH-046: 새 대시보드는 편집 화면으로, 복제는 PRIVATE 사본, 삭제는 목록에서 사라짐, 이름 없으면 400", async () => {
    const op = await operator();
    const empty = await op.post("/dashboards", { intent: "create", name: " " });
    expect(empty.response.status).toBe(400);
    const created = await op.post("/dashboards", { intent: "create", name: "복도 환경" });
    expect(created.response.status).toBe(302);
    expect(created.response.headers.get("Location")).toMatch(/^\/dashboards\/\d+\/edit$/);

    const dup = await op.post("/dashboards", { intent: "duplicate", id: DASH_ID });
    expect(dup.response.status).toBe(302);
    expect(state().dashboards.find((d) => d.name === "실습실 운영 (복사본)")?.visibility).toBe("PRIVATE");

    const del = await op.post("/dashboards", { intent: "delete", id: PRIVATE_DASH_ID });
    expect(del.response.status).toBe(200);
    expect((await op.get("/dashboards")).body).not.toContain("내 개인 보드");
  });

  it("TC-DSH-048: VIEWER는 목록을 보지만 [새 대시보드]가 없고, 만들기 요청은 core가 403", async () => {
    const v = await viewer();
    const page = await v.get("/dashboards?tab=shared");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("실습실 운영");
    expect(page.body).not.toContain("새 대시보드");
    const created = await v.post("/dashboards", { intent: "create", name: "몰래" });
    expect(created.response.status).toBe(403);
  });
});

describe("DSH-04.01 NFR-01.09 UI-DSH-04 대시보드 보기(첫 화면 서버 렌더)", () => {
  it("TC-NFR-009 AT-DSH-04.1: 정의와 앞쪽 위젯 데이터를 서버에서 병렬로 받아 HTML에 넣는다(메모 위젯은 요청 없음, HTML은 글자 그대로)", async () => {
    const op = await operator();
    const page = await op.get(`/dashboards/${DASH_ID}`);
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("실습실 운영");
    expect(page.body).toContain("CO2 현재값");
    expect(page.body).toContain("실습실 고CO2");
    expect(page.body).toContain("1,150");
    expect(page.body).not.toContain("<script>alert(1)</script>");
    expect(page.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt; 점검일");
    const calls = state().widgetCalls.filter((c) => c.dashboardId === DASH_ID).map((c) => c.widgetId).sort();
    expect(calls).toEqual(["w1", "w2", "w3", "w4"]);
    expect(state().widgetCalls[0].body).toMatchObject({ timeRange: { relative: "24h" }, resolution: "AUTO", variables: { space: "31" } });
    // 최근 본 항목(DSH-07.05)
    expect(received("/api/v1/core/accounts/me/recent").length).toBe(1);
  });

  it("TC-DSH-042 AT-DSH-04.3: 주소의 변수 값(var-space=32)이 위젯 요청에 들어가고 공간 선택지에 보인다", async () => {
    const op = await operator();
    const page = await op.get(`/dashboards/${DASH_ID}?var-space=32`);
    expect(page.body).toContain("사무실 고온");
    expect(page.body).toContain("광주캠퍼스 › 본관 › 3층 › 사무실");
    expect(state().widgetCalls.find((c) => c.widgetId === "w4")?.body).toMatchObject({ variables: { space: "32" } });
  });

  it("TC-DSH-047: 위젯 하나가 실패하거나 권한 밖이어도 그 위젯 자리에만 표시하고 나머지는 그린다", async () => {
    state().failWidget.add("w2");
    const v = await viewer();
    const page = await v.get(`/dashboards/${DASH_ID}`);
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("불러오지 못했습니다(SERVICE_UNAVAILABLE)");
    expect(page.body).toContain("접근 권한 없음");
    expect(page.body).toContain("실습실 고CO2");
    // VIEWER는 편집·공유 단추가 없다
    expect(page.body).not.toContain(`/dashboards/${DASH_ID}/edit`);
    expect(page.body).not.toContain("공유 링크");
  });

  it("TC-DSH-046: PRIVATE 대시보드를 소유자가 아닌 사용자가 열면 404", async () => {
    const i = await integrator();
    const page = await i.get(`/dashboards/${PRIVATE_DASH_ID}`);
    expect(page.response.status).toBe(404);
  });

  it("DSH-04.01: 위젯 데이터는 BFF 중계로 다시 받는다(브라우저 → /bff/api/core/dashboards/{id}/widgets/{wid}/data)", async () => {
    const op = await operator();
    await op.get(`/dashboards/${DASH_ID}`);
    const r = await json(op, `/bff/api/core/dashboards/${DASH_ID}/widgets/w3/data`, "POST", { timeRange: { relative: "1h" }, variables: { space: "31" } });
    expect(r.response.status).toBe(200);
    expect(JSON.parse(r.body).response).toMatchObject({ type: "gauge", data: { value: 48 } });
  });
});

describe("DSH-04.01 AT-DSH-04.6 UI-DSH-04 편집", () => {
  it("TC-DSH-031: 편집 화면은 위젯 종류(API-DSH-13)와 대상 선택지를 받고, 저장은 baseVersion으로 — 오래된 판은 409와 최신 판·수정자", async () => {
    const op = await operator();
    const page = await op.get(`/dashboards/${DASH_ID}/edit`);
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("위젯 라이브러리");
    expect(page.body).toContain("게이지 위젯 추가");
    const body = { name: "실습실 운영", layout: { widgets: [{ id: "w1", type: "stat", x: 0, y: 0, w: 4, h: 4, targets: [{ kind: "SPACE_AGGREGATE", spaceId: "${space}", metricKey: "co2" }] }] }, variables: [{ name: "space", type: "SPACE", default: "31" }], timeRange: { relative: "24h" }, resolution: "AUTO", refresh: "LIVE" };
    const saved = await json(op, `/bff/api/core/dashboards/${DASH_ID}`, "PUT", { ...body, baseVersion: 3 });
    expect(saved.response.status).toBe(200);
    expect(JSON.parse(saved.body).response.version).toBe(4);
    const stale = await json(op, `/bff/api/core/dashboards/${DASH_ID}`, "PUT", { ...body, baseVersion: 3 });
    expect(stale.response.status).toBe(409);
    expect(JSON.parse(stale.body)).toMatchObject({ header: { resultCode: "DASHBOARD_VERSION_CONFLICT" }, response: { version: 4, updatedByName: "이통합" } });
  });

  it("TC-DSH-048: 편집할 수 없는 대시보드(VIEWER)는 편집 화면이 403", async () => {
    const v = await viewer();
    const page = await v.get(`/dashboards/${DASH_ID}/edit`);
    expect(page.response.status).toBe(403);
  });
});

describe("DSH-06.02 UI-DSH-06 키오스크", () => {
  it("TC-DSH-062: 메뉴·헤더 없는 전체 화면(앱 틀 없음), 로그인 필요, 입력 검증(interval 30~600, boards 1~10)", async () => {
    const op = await operator();
    const page = await op.get(`/kiosk?boards=${DASH_ID},${PRIVATE_DASH_ID}&interval=60`);
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('data-testid="kiosk"');
    expect(page.body).not.toContain('aria-label="주 메뉴"');
    const bad = await op.get(`/kiosk?boards=${DASH_ID}&interval=5`);
    expect(bad.body).toContain("순환 간격은 30~600초입니다");
    const none = await op.get("/kiosk?boards=");
    expect(none.body).toContain("대시보드를 1~10개 고르세요");

    const anonymous = await new TestBrowser(app).get(`/kiosk?boards=${DASH_ID}`);
    expect(anonymous.response.status).toBe(302);
    expect(anonymous.response.headers.get("Location")).toContain("/login?next=");
  });

  it("TC-DSH-063 AT-DSH-06.2: Access가 만료돼도 세션 유지 요청(/bff/api/core/accounts/me)이 BFF에서 Refresh로 갱신되어 200", async () => {
    const op = await operator();
    await op.get(`/kiosk?boards=${DASH_ID}`);
    app.gateway.expireAccessTokens();
    const before = app.gateway.refreshCalls;
    const ping = await op.get("/bff/api/core/accounts/me");
    expect(ping.response.status).toBe(200);
    expect(app.gateway.refreshCalls).toBe(before + 1);
  });
});

describe("DSH-06.03 UI-DSH-07 공유 링크(로그인 없음)", () => {
  it("TC-DSH-069 AT-DSH-07.1: 로그인 없이 열면 대시보드가 읽기 전용으로 보이고(메뉴·편집·내보내기 없음), 주소가 새지 않는 헤더", async () => {
    const anonymous = new TestBrowser(app);
    const page = await anonymous.get(`/share/${SHARE_TOKEN}`);
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("실습실 운영");
    expect(page.body).toContain("읽기 전용 공유 화면 · 만료");
    expect(page.body).not.toContain('aria-label="주 메뉴"');
    expect(page.body).not.toContain("/edit");
    expect(page.response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(page.response.headers.get("X-Robots-Tag")).toBe("noindex");
    // 토큰 주소를 canonical·hreflang에 넣지 않는다
    expect(page.body).not.toContain('rel="canonical"');
    const call = state().publicCalls.at(-1)!;
    expect(call.headers.authorization).toBeUndefined();

    const alias = await anonymous.get(`/share/d/${SHARE_TOKEN}`);
    expect(alias.response.status).toBe(200);
  });

  it("TC-DSH-068: 위젯 데이터는 BFF 공개 경로(GET)로만 — 세션·Bearer 없이 gateway 공개 경로로 중계, 본문은 범위·변수만", async () => {
    const anonymous = new TestBrowser(app);
    const q = encodeURIComponent(JSON.stringify({ timeRange: { relative: "6h" }, variables: { space: "32", "bad key": "x" }, extra: "drop" }));
    const r = await anonymous.get(`/share/${SHARE_TOKEN}/widgets/w4/data?q=${q}`);
    expect(r.response.status).toBe(200);
    expect(JSON.parse(r.body).response).toMatchObject({ type: "alarm-list" });
    expect(r.body).toContain("사무실 고온");
    const call = state().publicCalls.at(-1)!;
    expect(call.path).toBe(`/public/share/${SHARE_TOKEN}/widgets/w4/data`);
    expect(call.headers.authorization).toBeUndefined();
    expect(call.body).toEqual({ timeRange: { relative: "6h" }, variables: { space: "32" } });
    expect(r.response.headers.get("Cache-Control")).toBe("no-store");

    const malformed = await anonymous.get("/share/x/widgets/w4/data");
    expect(malformed.response.status).toBe(404);
  });

  it("TC-DSH-067 AT-DSH-07.2: 폐기한 링크는 '유효하지 않은 링크입니다'(404)", async () => {
    const op = await operator();
    const list = await op.get(`/bff/api/core/dashboards/${DASH_ID}/share-links`);
    const id = JSON.parse(list.body).response[0].id as string;
    expect(JSON.parse(list.body).response[0].token).toBeUndefined();
    const revoked = await json(op, `/bff/api/core/dashboards/${DASH_ID}/share-links/${id}`, "DELETE", {});
    expect(revoked.response.status).toBe(204);
    const page = await new TestBrowser(app).get(`/share/${SHARE_TOKEN}`);
    expect(page.response.status).toBe(404);
    expect(page.body).toContain("유효하지 않은 링크입니다");
  });

  it("TC-DSH-070: 링크 만들기는 ANALYST 이상(VIEWER 403), 만료 1~90일, 주소는 만들 때 한 번만", async () => {
    const op = await operator();
    const created = await json(op, `/bff/api/core/dashboards/${DASH_ID}/share-links`, "POST", { expiresInDays: 7 });
    expect(created.response.status).toBe(201);
    expect(JSON.parse(created.body).response.url).toMatch(/\/share\/tok_new/);
    expect((await json(op, `/bff/api/core/dashboards/${DASH_ID}/share-links`, "POST", { expiresInDays: 91 })).response.status).toBe(400);
    const v = await viewer();
    expect((await json(v, `/bff/api/core/dashboards/${DASH_ID}/share-links`, "POST", { expiresInDays: 7 })).response.status).toBe(403);
  });
});

describe("DSH-13.01 UI-DSH-13 브랜딩", () => {
  it("TC-DSH-116 AT-DSH-14.4: ADMIN만 /admin/branding을 열고 OPERATOR는 403", async () => {
    const a = await admin();
    const page = await a.get("/admin/branding");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("data2flow 운영팀");
    expect(page.body).toContain("흰 배경 대비");
    const op = await operator();
    expect((await op.get("/admin/branding")).response.status).toBe(403);
  });

  it("AT-DSH-14.1: 저장한 로고·주 색상이 웹 헤더에 적용되고, 자산은 BFF 공개 경로로 내려준다(이미지 형식만)", async () => {
    state().branding = { ...state().branding, logoLightUrl: "/api/v1/core/public/branding/assets/12", primaryColor: "#0055AA" };
    const op = await operator();
    const page = await op.get("/dashboards");
    expect(page.body).toContain('src="/branding/assets/12"');
    expect(page.body).toContain("--d2f-accent:#0055AA");
    const anonymous = new TestBrowser(app);
    const asset = await anonymous.get("/branding/assets/12");
    expect(asset.response.status).toBe(200);
    expect(asset.response.headers.get("Content-Type")).toBe("image/png");
    expect(asset.response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect((await anonymous.get("/branding/assets/77")).response.status).toBe(415);
    expect((await anonymous.get("/branding/assets/404")).response.status).toBe(404);
    expect((await anonymous.get("/branding/assets/abc")).response.status).toBe(404);
  });

  it("TC-DSH-115: 브랜딩 저장은 baseVersion(동시 수정 409), 자산 업로드는 multipart 중계(스크립트 SVG는 400)", async () => {
    const a = await admin();
    const saved = await json(a, "/bff/api/core/branding", "PUT", { primaryColor: "#0055AA", publicTheme: "AUTO", contrastWarningAcked: false, baseVersion: 1 });
    expect(saved.response.status).toBe(200);
    expect((await json(a, "/bff/api/core/branding", "PUT", { primaryColor: "#0055AA", baseVersion: 1 })).response.status).toBe(409);
    const form = new FormData();
    form.set("kind", "LOGO_LIGHT");
    form.set("file", new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'], "logo.svg", { type: "image/svg+xml" }));
    const bad = await a.request("/bff/api/core/branding/assets", { method: "POST", headers: { "X-CSRF-TOKEN": a.csrf }, body: form });
    expect(bad.response.status).toBe(400);
    expect(JSON.parse(bad.body).header.resultCode).toBe("BRANDING_ASSET_INVALID");
  });
});
