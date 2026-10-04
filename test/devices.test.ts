/**
 * 기기 화면 SSR + BFF 통합 테스트(UI-DEV-04~07·18): DEV-02.01, DEV-02.03, DEV-02.04, DEV-02.10, DEV-13.01, DSH-07.05.
 * 실제 라우트(loader·action) + 가짜 gateway(test/msw/handlers/devices.ts).
 */
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { deviceExtra } from "./msw/handlers/devices";

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
const operator = () => as("kim.op", "Correct-Horse-9");
const integrator = () => as("lee.int", "Integrator-Pass1");
const viewer = () => as("view.er", "Viewer-Pass-123");

const lastRequest = (path: string, method = "POST") => app.gateway.received.filter((r) => r.method === method && r.path.startsWith(`/api/v1/core${path}`)).at(-1);

describe("DEV-02.01 UI-DEV-04 기기 목록", () => {
  it("TC-DEV-036 TC-DEV-007 목록 컬럼·하위 탭(승인 대기 수)·권한별 버튼: VIEWER는 [기기 추가] 없음, INTEGRATOR는 있음", async () => {
    const view = await viewer();
    const page = await view.get("/devices");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("AM107-067999");
    expect(page.body).toContain("광주캠퍼스 / 본관 / 3층 / 실습실");
    expect(page.body).toContain("#pilot");
    expect(page.body).toContain("승인 대기 (2)");
    expect(page.body).not.toContain('href="/devices/new"');
    const int = await integrator();
    const admin = await int.get("/devices");
    expect(admin.body).toContain('href="/devices/new"');
    expect(admin.body).toContain('href="/devices/new?import=1"');
  });

  it("TC-DEV-267 필터는 URL 쿼리로 API-DEV-11에 그대로 넘기고, 결과가 없으면 [필터 초기화] 안내", async () => {
    const browser = await viewer();
    const page = await browser.get("/devices?q=zzz&status=ACTIVE&spaceId=31");
    expect(app.gateway.received.some((r) => r.path === "/api/v1/core/devices?q=zzz&status=ACTIVE&spaceId=31&page=1&size=50")).toBe(true);
    expect(page.body).toContain("조건에 맞는 기기가 없습니다");
    expect(page.body).toContain("필터 초기화");
    expect(page.body).toMatch(/href="\/bff\/api\/core\/devices\/export\?q=zzz&amp;status=ACTIVE&amp;spaceId=31&amp;format=csv"/);
  });

  it("TC-DEV-085 빈 조직: 아직 기기가 없다는 안내와 [데이터 소스로 이동]", async () => {
    app.gateway.m2.devices = [];
    const browser = await viewer();
    const page = await browser.get("/devices");
    expect(page.body).toContain("아직 기기가 없습니다. 데이터 소스를 연결하면 기기가 자동으로 등록됩니다");
    expect(page.body).toContain('href="/sources"');
  });

  it("DEV-02.10 태그 일괄 변경(API-DEV-21): 결과 요약, 한도 초과는 기기별 DEVICE_TAG_LIMIT", async () => {
    const browser = await operator();
    await browser.get("/devices");
    const ok = await browser.post("/devices", { intent: "tag", deviceId: ["1042"], add: "east, East, floor3", remove: "pilot" });
    expect(ok.response.status).toBe(200);
    expect(lastRequest("/devices/tag")?.body).toEqual({ deviceIds: ["1042"], add: ["east", "floor3"], remove: ["pilot"] });
    expect(ok.body).toContain("성공 1, 실패 0");
    app.gateway.m2.devices[0].tags = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const limit = await browser.post("/devices", { intent: "tag", deviceId: ["1042"], add: "one-more" });
    expect(limit.body).toContain("성공 0, 실패 1");
    expect(limit.body).toContain("태그는 기기당 20개까지입니다");
    const empty = await browser.post("/devices", { intent: "tag", deviceId: ["1042"], add: "" });
    expect(empty.response.status).toBe(400);
    expect(empty.body).toContain("추가하거나 뺄 태그를 입력하세요");
  });

  it("VIEWER가 태그 API를 직접 부르면 서버가 403", async () => {
    const browser = await viewer();
    await browser.get("/devices");
    const result = await browser.post("/devices", { intent: "tag", deviceId: ["1042"], add: "x" });
    expect(result.response.status).toBe(403);
    expect(result.body).toContain("이 작업을 할 권한이 없습니다.");
  });
});

describe("DEV-02.03 UI-DEV-05 승인 대기", () => {
  it("TC-DEV-047 AT-DEV-03.3 미리 보기: 최근값·추천 모델 미리 선택·원본 location 태그와 같은 공간(실습실) 미리 선택", async () => {
    let rawUrl = "";
    app.server.use(
      http.get(`${GW}/ingest/raw-messages`, ({ request }) => {
        rawUrl = request.url;
        return HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" }, responses: [{ id: "r1", receivedAt: "2026-10-03T23:58:00Z", topic: "application/1/device/24e124136d151606/event/up", status: "OK", payload: '{"object":{"temperature":22.3}}' }], nextCursor: null });
      }),
    );
    const browser = await operator();
    const page = await browser.get("/devices/pending?preview=1050");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("location=실습실 · point=중앙 좌측");
    expect(page.body).toContain("EM300-TH — 일치 95%");
    expect(page.body).toMatch(/<option value="11" selected="">EM300-TH \(추천\)<\/option>/);
    expect(page.body).toMatch(/<option value="31" selected="">/);
    expect(page.body).toContain("원본 메시지 1건");
    expect(page.body).toContain('name="deviceId" value="1050"');
    expect(rawUrl).toContain("deviceId=1050");
    expect(rawUrl).toContain("size=3");
  });

  it("TC-DEV-047 AT-DEV-03.1 OPERATOR가 모델·공간을 지정해 승인 → 요청 본문(baseVersion 포함), 성공 요약, 기기 상세는 ACTIVE", async () => {
    const browser = await operator();
    await browser.get("/devices/pending");
    const result = await browser.post("/devices/pending", { intent: "approve", deviceId: ["1050"], "version:1050": "1", "version:1051": "1", modelId: "11", spaceId: "31", name: "실습실 중앙 온습도", tags: "pilot", applyModelPackage: "on", idempotencyKey: "k-approve-1" });
    expect(result.response.status).toBe(200);
    const sent = lastRequest("/devices/approve");
    expect(sent?.body).toEqual({ items: [{ deviceId: "1050", baseVersion: 1 }], modelId: "11", spaceId: "31", name: "실습실 중앙 온습도", tags: ["pilot"], applyModelPackage: true });
    expect(sent?.headers["idempotency-key"]).toBe("k-approve-1");
    expect(result.body).toContain("성공 1, 실패 0");
    const detail = await browser.get("/devices/1050");
    expect(detail.body).toContain("사용 중");
    expect(detail.body).toContain("실습실 중앙 온습도");
  });

  it("DSC-03.05 플랫폼 브로커 기기는 승인 결과의 서명 키를 한 번만 보여 준다(ADR-031)", async () => {
    app.gateway.m2.sources.push({ ...app.gateway.m2.sources[0], id: "8", code: "esp-broker", name: "ESP 브로커", type: "PLATFORM_BROKER" });
    app.gateway.m2.devices.find((d) => d.id === "1050")!.sourceId = "8";
    const browser = await operator();
    await browser.get("/devices/pending");
    const result = await browser.post("/devices/pending", { intent: "approve", deviceId: ["1050"], "version:1050": "1", modelId: "11", spaceId: "31" });
    expect(result.body).toContain("sk-1050-hmac");
    expect(result.body).toContain("지금 한 번만 보입니다");
    expect((await browser.get("/devices/pending")).body).not.toContain("sk-1050-hmac");
  });

  it("TC-DEV-047 모델·공간 없으면 400과 문구, 부분 실패는 실패 행을 남기고 사유 표시", async () => {
    const browser = await operator();
    await browser.get("/devices/pending");
    const missing = await browser.post("/devices/pending", { intent: "approve", deviceId: ["1050"], "version:1050": "1", modelId: "", spaceId: "" });
    expect(missing.response.status).toBe(400);
    expect(missing.body).toContain("기기 모델을 지정하세요");
    expect(missing.body).toContain("공간을 지정하세요");
    const partial = await browser.post("/devices/pending", { intent: "approve", deviceId: ["1050", "1051"], "version:1050": "1", "version:1051": "9", modelId: "11", spaceId: "31" });
    expect(partial.body).toContain("성공 1, 실패 1");
    expect(partial.body).toContain("기기 상태가 바뀌어 처리할 수 없습니다");
    expect(partial.body).toContain("bg-bad-soft");
  });

  it("DEV-02.03 거부: 무시 목록 추가(기본 켬), 목록에서 빠짐. 빈 목록 안내", async () => {
    const browser = await operator();
    await browser.get("/devices/pending");
    const rejected = await browser.post("/devices/pending", { intent: "reject", deviceId: ["1050", "1051"], addToIgnoreList: "on" });
    expect(lastRequest("/devices/reject")?.body).toEqual({ deviceIds: ["1050", "1051"], addToIgnoreList: true });
    expect(rejected.body).toContain("2대를 거부했습니다.");
    expect(rejected.body).toContain("승인 대기 기기가 없습니다");
  });

  it("TC-DEV-047 VIEWER는 승인 패널이 없고, 승인 API를 직접 부르면 403", async () => {
    const browser = await viewer();
    const page = await browser.get("/devices/pending");
    expect(page.body).toContain("EM300-TH-151606");
    expect(page.body).not.toContain('value="approve"');
    const result = await browser.post("/devices/pending", { intent: "approve", deviceId: ["1050"], "version:1050": "1", modelId: "11", spaceId: "31" });
    expect(result.response.status).toBe(403);
  });
});

describe("DEV-02.01·02.04 UI-DEV-07 기기 추가·CSV 가져오기", () => {
  it("TC-DEV-038 INTEGRATOR만: OPERATOR가 /devices/new를 열면 403", async () => {
    const browser = await operator();
    expect((await browser.get("/devices/new")).response.status).toBe(403);
  });

  it("TC-DEV-038 수동 등록: 검증 문구, 외부 ID 소문자 정규화 + Idempotency-Key, 상세로 이동, 중복은 DEVICE_DUPLICATE", async () => {
    const browser = await integrator();
    const page = await browser.get("/devices/new");
    expect(page.body).toContain("ChirpStack 관리자가 등록합니다");
    const key = /name="idempotencyKey" value="([^"]+)"/.exec(page.body)?.[1];
    const bad = await browser.post("/devices/new", { intent: "create", sourceId: "", externalId: "", name: "", kind: "SENSOR", modelId: "", spaceId: "", expectedIntervalSec: "5", offlineMultiplier: "20", tags: "" });
    expect(bad.response.status).toBe(400);
    for (const text of ["소스를 선택하세요", "외부 ID는 1~128자로 입력하세요", "기기 모델을 지정하세요", "10~86,400초 사이로 입력하세요", "배수는 1.5~10 사이로 입력하세요"]) expect(bad.body).toContain(text);
    const created = await browser.post("/devices/new", { intent: "create", idempotencyKey: key ?? "", sourceId: "7", externalId: "24E124136D151777", name: "EM300-TH-151777", kind: "SENSOR", modelId: "11", spaceId: "31", expectedIntervalSec: "600", offlineMultiplier: "", tags: "pilot" });
    expect(created.response.status).toBe(302);
    const sent = lastRequest("/devices");
    expect(sent?.body).toMatchObject({ sourceId: "7", externalId: "24e124136d151777", name: "EM300-TH-151777", modelId: "11", spaceId: "31", expectedIntervalSec: 600, tags: ["pilot"] });
    expect(sent?.headers["idempotency-key"]).toBe(key);
    expect(created.response.headers.get("Location")).toMatch(/^\/devices\/\d+$/);
    const dup = await browser.post("/devices/new", { intent: "create", sourceId: "7", externalId: "24e124707c067999", name: "x", kind: "SENSOR", modelId: "11", spaceId: "31", expectedIntervalSec: "", offlineMultiplier: "", tags: "" });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 외부 ID의 기기가 이미 있습니다");
  });

  it("TC-DEV-055 CSV 가져오기: 먼저 dryRun 검증(행별 결과), 방식 선택 뒤 실제 가져오기", async () => {
    const browser = await integrator();
    const page = await browser.get("/devices/new?import=1");
    expect(page.body).toContain("템플릿 받기");
    const form = new FormData();
    form.set("_csrf", browser.csrf);
    form.set("intent", "import-check");
    form.set("file", new Blob(["sourceId,externalId,name\n7,a,b\n7,c,d\n"], { type: "text/csv" }), "devices.csv");
    const checked = await browser.request("/devices/new?import=1", { method: "POST", body: form });
    expect(checked.response.status).toBe(200);
    expect(lastRequest("/devices/import")?.path).toContain("dryRun=true&mode=SKIP_ERRORS");
    expect(checked.body).toContain("2행 중 1행 가능, 1행 오류");
    expect(checked.body).toContain("&quot;EM500-CO3&quot; 모델이 없습니다");
    const csv = /name="csv" value="([^"]*)"/.exec(checked.body)?.[1];
    expect(csv).toContain("sourceId,externalId,name");
    const run = await browser.post("/devices/new?import=1", { intent: "import", csv: "sourceId,externalId,name\n7,a,b\n", fileName: "devices.csv", mode: "ALL_OR_NOTHING" });
    expect(lastRequest("/devices/import")?.path).toContain("dryRun=false&mode=ALL_OR_NOTHING");
    expect(run.body).toContain("2행 중 0행을 가져왔습니다(실패 2).");
    const none = await browser.post("/devices/new?import=1", { intent: "import-check", csv: "" });
    expect(none.response.status).toBe(400);
    expect(none.body).toContain("CSV 파일을 고르세요");
  });
});

describe("DEV-02.01 UI-DEV-06 기기 상세", () => {
  it("TC-DEV-037 개요: 현재값 카드·온보딩·오프라인 기준, 최근 본 항목 기록, OPERATOR는 [편집]·[비활성화] 있고 [삭제] 없음", async () => {
    const browser = await operator();
    const page = await browser.get("/devices/1042");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("AM107-067999");
    expect(page.body).toContain("517ppm");
    expect(page.body).toContain("60초 × 3 (모델 값)");
    expect(page.body).toContain("첫 수신");
    expect(page.body).toContain("비활성화");
    expect(page.body).not.toContain(">삭제<");
    expect(lastRequest("/accounts/me/recent")?.body).toEqual({ type: "DEVICE", id: "1042" });
    // 플랫폼 브로커 소스가 아니면 자격증명 탭이 없다
    expect(page.body).not.toContain("tab=credentials");
  });

  it("TC-DEV-026 비활성화(baseVersion) → INACTIVE, 오래된 version이면 '다른 사용자가 변경했습니다' + [새로 고침]", async () => {
    const browser = await operator();
    await browser.get("/devices/1042");
    const done = await browser.post("/devices/1042", { intent: "deactivate", baseVersion: "4" });
    expect(done.response.status).toBe(200);
    expect(lastRequest("/devices/1042/deactivate")?.body).toEqual({ baseVersion: 4 });
    expect(done.body).toContain("사용 중지");
    expect(done.body).toContain("활성화");
    const stale = await browser.post("/devices/1042", { intent: "activate", baseVersion: "4" });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toContain("다른 사용자가 변경했습니다");
  });

  it("TC-DEV-086 편집: INTEGRATOR는 이름·모델까지, 저장 시 baseVersion과 태그 차이(API-DEV-21)", async () => {
    const browser = await integrator();
    const page = await browser.get("/devices/1042?edit=1");
    expect(page.body).toContain("기기 편집");
    expect(page.body).toContain('name="name"');
    const saved = await browser.post("/devices/1042?edit=1", { intent: "edit", baseVersion: "4", name: "AM107 실습실", kind: "SENSOR", modelId: "12", spaceId: "31", expectedIntervalSec: "", offlineMultiplier: "", tagsBefore: "pilot", tags: "pilot, east" });
    expect(saved.response.status).toBe(302);
    expect(lastRequest("/devices/1042", "PATCH")?.body).toEqual({ baseVersion: 4, name: "AM107 실습실", kind: "SENSOR", modelId: "12", spaceId: "31" });
    expect(lastRequest("/devices/tag")?.body).toEqual({ deviceIds: ["1042"], add: ["east"], remove: [] });
    const op = await operator();
    const opPage = await op.get("/devices/1042?edit=1");
    expect(opPage.body).not.toContain('name="name"');
    expect(opPage.body).toContain('name="spaceId"');
  });

  it("DEV-02.01 삭제: 사용처가 있으면 DEVICE_IN_USE로 막고, 없으면 목록으로", async () => {
    deviceExtra(app.gateway.m2).references["1042"] = [{ type: "RULE", id: "5", name: "실습실 고CO2" }];
    const browser = await integrator();
    await browser.get("/devices/1042");
    const blocked = await browser.post("/devices/1042", { intent: "delete", baseVersion: "4" });
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toContain("규칙·플로우 등에서 쓰고 있어 삭제할 수 없습니다");
    deviceExtra(app.gateway.m2).references["1042"] = [];
    const deleted = await browser.post("/devices/1042", { intent: "delete", baseVersion: "4" });
    expect(deleted.response.headers.get("Location")).toBe("/devices");
  });

  it("DSH-07.05 즐겨찾기 토글: 내 화면 설정 favorites(baseVersion)", async () => {
    const browser = await viewer();
    const page = await browser.get("/devices/1042");
    expect(page.body).toContain("☆");
    await browser.post("/devices/1042", { intent: "favorite" });
    expect(lastRequest("/accounts/me/preferences", "PUT")?.body).toEqual({ favorites: [{ type: "DEVICE", id: "1042" }], baseVersion: 1 });
    expect((await browser.get("/devices/1042")).body).toContain("★");
  });

  it("원본 메시지 탭(API-ING-05·06)과 변경 이력 탭(API-DEV-27)", async () => {
    app.server.use(
      http.get(`${GW}/ingest/raw-messages`, () => HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" }, responses: [{ id: "88", receivedAt: "2026-10-03T23:59:48Z", topic: "application/1/device/x/event/up", status: "OK", sizeBytes: 412 }], nextCursor: "c2" })),
      http.get(`${GW}/ingest/raw-messages/88`, () => HttpResponse.json({ header: { isSuccessful: true, resultCode: "SUCCESS", resultMessage: "" }, response: { id: "88", payload: '{"temperature":22.3}', canonical: { v: 1 } } })),
    );
    const browser = await viewer();
    const raw = await browser.get("/devices/1042?tab=raw&raw=88");
    expect(raw.body).toContain("412B");
    expect(raw.body).toContain("{&quot;temperature&quot;:22.3}");
    expect(raw.body).toContain("cursor=c2");
    // 변경 이력(API-DEV-27)은 M4(DEV-02.07)에서 탭으로 연다(test/control-m4.test.ts)
    expect(raw.body).toContain('href="/devices/1042?tab=history"');
  });

  it("원본 메시지를 못 불러오면 안내, 데이터 탭은 모델 측정 항목을 후보로", async () => {
    const browser = await viewer();
    const raw = await browser.get("/devices/1042?tab=raw");
    expect(raw.body).toContain("원본 메시지를 불러오지 못했습니다.");
    const dataTab = await browser.get("/devices/1042?tab=data");
    expect(dataTab.response.status).toBe(200);
    expect(dataTab.body).toContain("측정 데이터");
  });

  it("TC-DEV-307 AT-DEV-23.4 시맨틱: VIEWER는 조회 전용, INTEGRATOR 저장·필드 오류·[모델 태그 다시 적용]", async () => {
    const view = await viewer();
    const ro = await view.get("/devices/1042?tab=semantic");
    expect(ro.body).toContain("Zone_Air_Temperature");
    expect(ro.body).toContain("조회 전용");
    expect(ro.body).not.toContain("모델 태그 다시 적용");
    const int = await integrator();
    await int.get("/devices/1042?tab=semantic");
    const fields = { intent: "semantic-save", "eq.0.equipClass": "Zone_Air_Sensor", "eq.0.name": "실습실 센서", "eq.0.pt.0.metricKey": "temperature", "eq.0.pt.0.pointType": "Measurement", "eq.0.pt.0.quantity": "Unknown_Thing", "eq.0.pt.0.tags": "zone air" };
    const invalid = await int.post("/devices/1042?tab=semantic", fields);
    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toContain("알 수 없는 물리량입니다");
    const saved = await int.post("/devices/1042?tab=semantic", { ...fields, "eq.0.pt.0.quantity": "Zone_Air_Temperature" });
    expect(saved.response.status).toBe(200);
    expect(lastRequest("/devices/1042/semantic", "PUT")?.body).toEqual({ equipment: [{ equipClass: "Zone_Air_Sensor", name: "실습실 센서", points: [{ metricKey: "temperature", pointType: "Measurement", quantity: "Zone_Air_Temperature", tags: ["zone", "air"] }] }] });
    await int.post("/devices/1042?tab=semantic", { intent: "semantic-reapply" });
    expect(lastRequest("/devices/1042/semantic/reapply-model")).toBeDefined();
    deviceExtra(app.gateway.m2).semantic["1042"] = { equipment: [] };
    expect((await view.get("/devices/1042?tab=semantic")).body).toContain("모델에 기본 태그가 없습니다");
  });

  it("플랫폼 브로커 소스 기기만 자격증명 탭, 없는 기기는 404", async () => {
    app.gateway.m2.sources.push({ ...app.gateway.m2.sources[0], id: "8", code: "esp-broker", name: "ESP 브로커", type: "PLATFORM_BROKER" });
    app.gateway.m2.devices.push({ ...app.gateway.m2.devices[0], id: "2001", name: "ESP32-TH-01", externalId: "esp32-th-01", sourceId: "8" });
    const browser = await viewer();
    const page = await browser.get("/devices/2001?tab=credentials");
    // UI-DSC-06 패널(DSC-03.02): 접속 정보는 서버 렌더링, 목록은 브라우저에서 불러온다. VIEWER에게는 발급 버튼이 없다
    expect(page.body).toContain("wss://iot-data.java21.net/mqtt");
    expect(page.body).not.toContain(">발급</button>");
    expect((await browser.get("/devices/9999")).response.status).toBe(404);
  });
});
