/**
 * 제어 화면 SSR + BFF 통합(M3): UI-ACT-01 기기 제어 패널(ACT-02.04·04.01·04.02), UI-ACT-02 명령 이력(ACT-04.03),
 * UI-DEV-08 패키지 탭 제어 드라이버 연결(DEV-03.03). 가짜 gateway는 test/msw/handlers/control.ts(design/api/ACT-api.md).
 */
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { GATEWAY, envelope } from "./msw/fake-gateway";
import { AIRCON_ID, controlState } from "./msw/handlers/control";

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
const analyst = () => as("ana.lyst", "Analyst-Pass-123");
const viewer = () => as("view.er", "Viewer-Pass-123");

function json(browser: TestBrowser, path: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return browser.request(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf, ...headers }, body: JSON.stringify(body) });
}

describe("UI-ACT-01 기기 제어 패널(ACT-04.01·ACT-02.04)", () => {
  it("OPERATOR: 제어 탭에 기능별 컨트롤(모드·목표 온도 18~28℃), 원하는 값·실제 값, [적용]", async () => {
    const browser = await operator();
    const page = await browser.get(`/devices/${AIRCON_ID}?tab=control`);
    expect(page.response.status).toBe(200);
    expect(page.body).toContain(">제어<");
    expect(page.body).toContain(">명령 이력<");
    expect(page.body).toContain("Thermostat");
    expect(page.body).toContain("18~28℃");
    expect(page.body).toContain("원하는 값 26℃ · 실제 값 26℃");
    expect(page.body).toContain("가상 드라이버");
    expect(page.body).toMatch(/>적용</);
    expect(app.gateway.received.some((r) => r.path === `/api/v1/core/devices/${AIRCON_ID}/control`)).toBe(true);
  });

  it("VIEWER는 읽기 전용(적용 버튼 없음), 제어할 수 없는 기기는 안내", async () => {
    const browser = await viewer();
    const page = await browser.get(`/devices/${AIRCON_ID}?tab=control`);
    expect(page.body).toContain("제어 권한이 없어 보기만 할 수 있습니다");
    expect(page.body).not.toMatch(/>적용</);
    const sensor = await browser.get("/devices/1042?tab=control");
    expect(sensor.body).toContain("이 기기는 제어할 수 없습니다");
  });
});

describe("ACT-04.02 명령 요청(API-ACT-01 BFF 중계)", () => {
  it("Idempotency-Key와 함께 202 REQUESTED, 같은 키는 같은 명령, 제어 권한이 없으면 403", async () => {
    const browser = await operator();
    await browser.get(`/devices/${AIRCON_ID}?tab=control`);
    const body = { capability: "Thermostat", command: "set", args: { mode: "cool", targetTemperature: 24 }, wait: "none" };
    const first = await json(browser, `/bff/api/core/devices/${AIRCON_ID}/commands`, "POST", body, { "Idempotency-Key": "key-1" });
    expect(first.response.status).toBe(202);
    const command = JSON.parse(first.body).response;
    expect(command.status).toBe("REQUESTED");
    const forwarded = app.gateway.received.filter((r) => r.method === "POST" && r.path === `/api/v1/core/devices/${AIRCON_ID}/commands`).at(-1);
    expect(forwarded?.headers["idempotency-key"]).toBe("key-1");
    expect(forwarded?.body).toEqual(body);
    const again = await json(browser, `/bff/api/core/devices/${AIRCON_ID}/commands`, "POST", body, { "Idempotency-Key": "key-1" });
    expect(JSON.parse(again.body).response.id).toBe(command.id);
    const shadow = await browser.get(`/bff/api/core/devices/${AIRCON_ID}/shadow`);
    expect(JSON.parse(shadow.body).response.desired.Thermostat.targetTemperature).toBe(24);

    const denied = await json(await analyst(), `/bff/api/core/devices/${AIRCON_ID}/commands`, "POST", body, { "Idempotency-Key": "key-2" });
    expect(denied.response.status).toBe(403);
  });

  it("절대 한계를 넘는 값은 400 COMMAND_ABSOLUTE_LIMIT으로 거부되고 거부된 명령도 이력에 남는다", async () => {
    const browser = await operator();
    await browser.get(`/devices/${AIRCON_ID}?tab=control`);
    const rejected = await json(browser, `/bff/api/core/devices/${AIRCON_ID}/commands`, "POST", { capability: "Thermostat", command: "set", args: { targetTemperature: 32 } }, { "Idempotency-Key": "key-3" });
    expect(rejected.response.status).toBe(400);
    expect(JSON.parse(rejected.body).header.resultCode).toBe("COMMAND_ABSOLUTE_LIMIT");
    const history = await browser.get(`/devices/${AIRCON_ID}?tab=commands&status=REJECTED`);
    expect(history.body).toContain("거부됨");
    expect(history.body).toContain("조직 절대 한계를 넘는 값이라 거부했습니다");
  });
});

describe("UI-ACT-02 명령 이력(ACT-04.03)", () => {
  it("TC-ACT-087 기기 탭: 플로우 출처 '플로우 고온이면 냉방 v13 · n-act-1'와 링크, 차단 사유, 필터는 API 쿼리로", async () => {
    const browser = await operator();
    const page = await browser.get(`/devices/${AIRCON_ID}?tab=commands`);
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("플로우 고온이면 냉방 v13 · n-act-1");
    expect(page.body).toContain('href="/automation/flows/f-7f3a"');
    expect(page.body).toContain("Thermostat.set(cool, 24)");
    expect(page.body).toContain("창문이 열려 있어 냉방을 막았습니다");
    await browser.get(`/devices/${AIRCON_ID}?tab=commands&sourceType=FLOW&from=2026-10-03T09:00`);
    const sent = app.gateway.received.filter((r) => r.path.startsWith(`/api/v1/core/devices/${AIRCON_ID}/commands?`)).at(-1);
    expect(sent?.path).toContain("sourceType=FLOW");
    expect(sent?.path).toContain(`from=${encodeURIComponent("2026-10-03T00:00:00Z")}`);
    expect(sent?.path).toContain("size=50");
  });

  it("/control/commands 조직 전체 이력: VIEWER도 조회(DEV_READ), 기기 이름·공간 필터, 다음 커서", async () => {
    const browser = await viewer();
    const page = await browser.get("/control/commands?spaceId=31");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("명령 이력");
    expect(page.body).toContain("AC-1 실습실 에어컨");
    expect(page.body).not.toMatch(/>취소</);
    expect(app.gateway.received.some((r) => r.path.startsWith("/api/v1/core/commands?") && r.path.includes("spaceId=31"))).toBe(true);
    const state = controlState(app.gateway.m2);
    for (let i = 0; i < 60; i += 1) state.commands.push({ ...state.commands[1], id: `c-extra-${i}` });
    const more = await browser.get("/control/commands");
    expect(more.body).toContain("cursor=50");
  });

  it("대기 명령 취소는 BFF로, 끝난 명령은 409", async () => {
    const browser = await operator();
    await browser.get("/control/commands");
    const state = controlState(app.gateway.m2);
    state.commands.unshift({ ...state.commands[0], id: "c-queued", status: "QUEUED" });
    const ok = await json(browser, "/bff/api/core/commands/c-queued/cancel", "POST", {});
    expect(JSON.parse(ok.body).response.status).toBe("CANCELLED");
    const conflict = await json(browser, "/bff/api/core/commands/c-queued/cancel", "POST", {});
    expect(conflict.response.status).toBe(409);
  });
});

describe("DEV-03.03 모델 패키지 탭 제어 드라이버 연결(UI-DEV-08)", () => {
  it("INTEGRATOR: 드라이버 목록, 기능을 지원하지 않는 드라이버는 연결 전에 거부, 지원하면 API-ACT-31로 연결", async () => {
    const browser = await integrator();
    const model = app.gateway.m2.models.find((m) => m.code === "EM300-TH")!;
    model.capabilities = [{ capability: "Thermostat" }];
    const page = await browser.get("/models/EM300-TH?tab=package");
    expect(page.body).toContain("가상 드라이버 (VIRTUAL)");
    expect(page.body).toContain("MQTT 기본 (MQTT)");
    const mismatch = await browser.post("/models/EM300-TH?tab=package", { intent: "driver", baseVersion: "1", driverId: "302" });
    expect(mismatch.response.status).toBe(400);
    expect(mismatch.body).toContain("이 드라이버는 Thermostat을 지원하지 않습니다");
    expect(app.gateway.received.some((r) => r.method === "PUT" && r.path.endsWith("/driver"))).toBe(false);
    const connected = await browser.post("/models/EM300-TH?tab=package", { intent: "driver", baseVersion: "1", driverId: "301" });
    expect(connected.body).toContain("드라이버를 연결했습니다");
    const put = app.gateway.received.find((r) => r.method === "PUT" && r.path === `/api/v1/core/device-models/${model.id}/driver`);
    expect(put?.body).toEqual({ driverId: "301" });
    const after = await browser.get("/models/EM300-TH?tab=package");
    expect(after.body).toMatch(/<option value="301" selected="">/);
    const unknown = await browser.post("/models/EM300-TH?tab=package", { intent: "driver", baseVersion: "1", driverId: "999" });
    expect(unknown.response.status).toBe(404);
    const cleared = await browser.post("/models/EM300-TH?tab=package", { intent: "driver", baseVersion: "1", driverId: "" });
    expect(cleared.body).toContain("드라이버를 연결했습니다");
  });

  it("서버가 기능 불일치(400 DRIVER_CAPABILITY_MISMATCH)를 주면 그 기능 이름으로 안내", async () => {
    const browser = await integrator();
    const model = app.gateway.m2.models.find((m) => m.code === "EM300-TH")!;
    model.capabilities = [{ capability: "Ventilation" }];
    // 상세(API-ACT-30)는 지원한다고 답했지만 연결(API-ACT-31) 시점에는 지원하지 않는 경우
    app.server.use(http.get(`${GATEWAY}/api/v1/core/drivers/302`, () => HttpResponse.json(envelope({ driverId: "302", capabilities: ["Switch", "Ventilation"] }))));
    await browser.get("/models/EM300-TH?tab=package");
    const result = await browser.post("/models/EM300-TH?tab=package", { intent: "driver", baseVersion: "1", driverId: "302" });
    expect(result.response.status).toBe(400);
    expect(result.body).toContain("이 드라이버는 Ventilation을 지원하지 않습니다");
  });

  it("OPERATOR(DRIVER_MANAGE 없음)는 현재 연결만 읽기 전용", async () => {
    const browser = await operator();
    const page = await browser.get("/models/EM300-TH?tab=package");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("연결된 드라이버가 없습니다");
    expect(page.body).toContain("드라이버 연결은 ADMIN·INTEGRATOR만 할 수 있습니다");
  });
});
