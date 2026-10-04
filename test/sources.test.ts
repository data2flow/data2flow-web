/**
 * 데이터 소스 화면 SSR + BFF 통합 테스트(DSC-01.01·01.02·01.04·01.06·01.07, DSC-02.01·02.03·02.05·02.06, DSC-03.02, DSC-07.01,
 * DSC-09.01·09.04, DSH-08.02). 실제 라우트·loader·action을 돌리고 core는 가짜 gateway(test/msw/handlers/sources.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emptyForm, type SourceFormValues } from "~/features/sources/model/source";
import { TestBrowser, startApp, type AppContext } from "./app-harness";

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
const integrator = () => as("lee.int", "Integrator-Pass1");
const operator = () => as("kim.op", "Correct-Horse-9");
const viewer = () => as("view.er", "Viewer-Pass-123");

function mqttForm(patch: Partial<SourceFormValues> = {}): SourceFormValues {
  return {
    ...emptyForm("MQTT_SUBSCRIBE", "mqtt"),
    code: "academy-wss",
    name: "아카데미 WSS",
    url: "wss://iot-data.java21.net:443/mqtt",
    auth: "HEADER",
    secretValue: "Basic c2VjcmV0",
    topics: [{ topic: "application/+/device/+/event/up", qos: 1 }],
    defaultModelId: "11",
    defaultSpaceId: "31",
    ...patch,
  };
}


describe("DSC-01.01 UI-DSC-01 데이터 소스 목록", () => {
  it("TC-DSC-007 TC-DSC-060 INTEGRATOR에게만 [새 소스]·[실시간 메시지], OPERATOR는 조회만, VIEWER는 403", async () => {
    const lee = await integrator();
    const page = await lee.get("/sources");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("ChirpStack s3");
    expect(page.body).toContain('href="/sources/new"');
    expect(page.body).toContain('href="/sources/7?tab=live"');
    const kim = await operator();
    const opPage = await kim.get("/sources");
    expect(opPage.body).toContain("ChirpStack s3");
    expect(opPage.body).not.toContain('href="/sources/new"');
    expect(opPage.body).not.toContain("?tab=live");
    expect((await (await viewer()).get("/sources")).response.status).toBe(403);
  });

  it("TC-DSC-075 행에 분당 수신 스파크라인·디코딩 실패율·마지막 수신(\"12초 전\")·기기 수", async () => {
    const page = await (await operator()).get("/sources");
    expect(page.body).toContain('aria-label="최근 1시간 분당 수신"');
    expect(page.body).toMatch(/10<!-- -->\/분|10\/분/);
    expect(page.body).toContain("0%");
    expect(page.body).toContain("12초 전");
    expect(page.body).toContain("연결됨");
  });

  it("TC-DSC-016 유형 필터(가상 환경) → sim 소스만, 유형 이름 표시. 보관 포함을 켜야 ARCHIVED가 보인다", async () => {
    app.gateway.m2.sources.push(
      { ...structuredClone(app.gateway.m2.sources[0]), id: "8", code: "sim-classroom", name: "가상 강의실", type: "SIMULATION", lifecycle: "ACTIVE" },
      { ...structuredClone(app.gateway.m2.sources[0]), id: "9", code: "old-broker", name: "옛 브로커", lifecycle: "ARCHIVED" },
    );
    const browser = await operator();
    const sim = await browser.get("/sources?type=SIMULATION");
    expect(sim.body).toContain("가상 강의실");
    expect(sim.body).not.toContain("ChirpStack s3");
    expect(sim.body).toContain("가상 환경");
    expect((await browser.get("/sources")).body).not.toContain("옛 브로커");
    expect((await browser.get("/sources?archived=1")).body).toContain("옛 브로커");
  });

  it("TC-DSC-007 행의 [일시정지] 후 배지가 일시정지로, [재개]로 다시 수집 중", async () => {
    const browser = await integrator();
    await browser.get("/sources");
    const pause = await browser.post("/sources", { intent: "pause", id: "7", baseVersion: "3" });
    expect(pause.response.status).toBe(200);
    expect(app.gateway.received.find((r) => r.path === "/api/v1/core/sources/7/pause")?.body).toEqual({ baseVersion: 3 });
    const paused = await browser.get("/sources");
    expect(paused.body).toContain("일시정지");
    await browser.post("/sources", { intent: "resume", id: "7", baseVersion: "4" });
    expect(app.gateway.m2.sources[0].lifecycle).toBe("ACTIVE");
    const stale = await browser.post("/sources", { intent: "pause", id: "7", baseVersion: "1" });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toContain("다른 사용자가 먼저 수정했습니다");
  });

  it("TC-DSH-084 AT-DSH-08.2 소스 0개 → \"아직 소스가 없습니다\"와 [소스 연결], 권한 없으면 관리자 요청 안내", async () => {
    app.gateway.m2.sources = [];
    const lee = await (await integrator()).get("/sources");
    expect(lee.body).toContain("아직 소스가 없습니다");
    expect(lee.body).toContain("소스 연결");
    const kim = await (await operator()).get("/sources");
    expect(kim.body).toContain("관리자(INTEGRATOR 이상)에게 요청");
    expect(kim.body).not.toContain('href="/sources/new"');
  });
});

describe("DSC-09.01 UI-DSC-07 커넥터 카탈로그", () => {
  it("TC-DSC-008 INTEGRATOR 미만은 /sources/new 403, INTEGRATOR는 카드·템플릿·유형 카드 7종", async () => {
    expect((await (await operator()).get("/sources/new")).response.status).toBe(403);
    const page = await (await integrator()).get("/sources/new");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain('href="/sources/new/mqtt"');
    expect(page.body).toContain("Apache Kafka");
    expect(page.body).toContain("아카데미 iot-data(WSS)");
    expect(page.body).toContain('href="/sources/new/mqtt?template=academy-iot-data"');
    for (const name of ["MQTT 구독", "플랫폼 브로커", "HTTP Webhook", "가상 환경", "oneM2M", "OPC UA", "Modbus TCP"]) expect(page.body).toContain(name);
  });

  it("TC-DSC-017 TC-DSC-233 라이선스로 막힌 커넥터는 \"사용 불가(라이선스)\"이고 링크가 없다, 확장 방식·유실 가능 표시", async () => {
    const page = await (await integrator()).get("/sources/new");
    expect(page.body).toContain("사용 불가(라이선스)");
    expect(page.body).not.toContain('href="/sources/new/bacnet-ip"');
    expect(page.body).toContain("DUAL_ACTIVE");
    expect(page.body).toContain("유실 가능");
  });

  it("카탈로그 API가 실패해도 기본 유형 3개로 만들 수 있다", async () => {
    app.gateway.m2.extra.sources = undefined;
    const browser = await integrator();
    app.server.use((await import("msw")).http.get("http://gateway.test/api/v1/core/connectors", () => new Response(null, { status: 503 })));
    const page = await browser.get("/sources/new");
    expect(page.body).toContain("커넥터 카탈로그를 불러오지 못했습니다");
    expect(page.body).toContain('href="/sources/new/platform-broker"');
    expect(page.body).toContain('href="/sources/new/simulation"');
  });
});

describe("DSC-01.01·01.04·01.07 UI-DSC-02/08 소스 만들기", () => {
  it("TC-DSC-006 AT-DSC-01.1 저장 후 활성화: Idempotency-Key·activate=true·기본 모델·공간(TC-DSC-053) → 상세 상태 탭", async () => {
    const browser = await integrator();
    const form = await browser.get("/sources/new/mqtt");
    expect(form.response.status).toBe(200);
    expect(form.body).toContain("브로커 주소");
    const idem = /name="idempotencyKey" value="([^"]+)"/.exec(form.body)?.[1];
    const save = await browser.post("/sources/new/mqtt", { intent: "activate", payload: JSON.stringify(mqttForm()), idempotencyKey: idem ?? "" });
    expect(save.response.status).toBe(302);
    const created = app.gateway.m2.sources.find((s) => s.code === "academy-wss");
    expect(save.response.headers.get("Location")).toBe(`/sources/${created?.id}?tab=status`);
    const request = app.gateway.received.find((r) => r.method === "POST" && r.path === "/api/v1/core/sources");
    expect(request?.headers["idempotency-key"]).toBe(idem);
    expect(request?.body).toMatchObject({ code: "academy-wss", type: "MQTT_SUBSCRIBE", activate: true, defaultModelId: "11", defaultSpaceId: "31", secret: { kind: "HEADER", value: "Basic c2VjcmV0" }, topics: [{ topic: "application/+/device/+/event/up", qos: 1 }] });
    expect((request?.body as { connection: Record<string, unknown> }).connection).toMatchObject({ url: "wss://iot-data.java21.net:443/mqtt", auth: "HEADER", headerName: "Authorization", protocolVersion: "5.0" });
    expect(created?.lifecycle).toBe("ACTIVE");
  });

  it("[초안으로 저장]은 activate=false, 설정 탭으로", async () => {
    const browser = await integrator();
    await browser.get("/sources/new/simulation");
    const save = await browser.post("/sources/new/simulation", { intent: "draft", payload: JSON.stringify({ ...emptyForm("SIMULATION", "simulation"), code: "sim-a", name: "가상 A" }) });
    expect(save.response.headers.get("Location")).toMatch(/\?tab=settings$/);
    expect(app.gateway.m2.sources.find((s) => s.code === "sim-a")?.lifecycle).toBe("DRAFT");
  });

  it("TC-DSC-053 TC-DSC-031 화면과 같은 검증: 자동 등록 한도·무수신 기준·토픽·URL이 틀리면 gateway를 부르지 않고 400", async () => {
    const browser = await integrator();
    await browser.get("/sources/new/mqtt");
    for (const bad of [{ autoregLimitPerHour: "20000" }, { noDataAlarmAfterSec: "30" }, { topics: [{ topic: "a/#/b", qos: 1 }] }, { url: "http://x" }, { code: "Bad Code" }]) {
      const result = await browser.post("/sources/new/mqtt", { intent: "draft", payload: JSON.stringify(mqttForm(bad as Partial<SourceFormValues>)) });
      expect(result.response.status, JSON.stringify(bad)).toBe(400);
    }
    expect(app.gateway.received.some((r) => r.method === "POST" && r.path === "/api/v1/core/sources")).toBe(false);
  });

  it("SOURCE_CODE_DUPLICATE·SOURCE_CLIENT_ID_DUPLICATE는 문구로 안내", async () => {
    const browser = await integrator();
    await browser.get("/sources/new/mqtt");
    const dup = await browser.post("/sources/new/mqtt", { intent: "draft", payload: JSON.stringify(mqttForm({ code: "chirpstack-s3" })) });
    expect(dup.response.status).toBe(409);
    expect(dup.body).toContain("같은 코드의 소스가 이미 있습니다");
    const client = await browser.post("/sources/new/mqtt", { intent: "draft", payload: JSON.stringify(mqttForm({ clientIdBase: "data2flow-chirpstack-s3" })) });
    expect(client.body).toContain("다른 소스가 같은 client-id를 쓰고 있습니다");
  });

  it("템플릿을 고르면 주소·인증·토픽이 미리 채워진다(API-DSC-56)", async () => {
    const page = await (await integrator()).get("/sources/new/mqtt?template=chirpstack-v4");
    expect(page.body).toContain("템플릿: ChirpStack v4");
    expect(page.body).toContain("wss://iot-data.java21.net:443/mqtt");
    expect(page.body).toContain("application/+/device/+/event/up");
  });

  it("M2에서 만들 수 없는 커넥터는 안내만", async () => {
    const page = await (await integrator()).get("/sources/new/kafka");
    expect(page.body).toContain("아직 화면에서 만들 수 없습니다");
  });

  it("DSC-02.05 TC-DSC-092 연결 테스트(API-DSC-57)는 BFF 중계로 단계·미리보기를 받는다, 저장하지 않는다", async () => {
    const browser = await integrator();
    await browser.get("/sources/new/mqtt");
    const call = (url: string) =>
      browser.request("/bff/api/core/sources/test", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ connection: { url }, topics: [{ topic: "a", qos: 1 }] }) });
    const okResult = JSON.parse((await call("wss://iot-data.java21.net/mqtt")).body).response;
    expect(okResult.steps.map((s: { name: string }) => s.name)).toEqual(["DNS", "TCP", "TLS", "AUTH", "SUBSCRIBE"]);
    expect(okResult.preview).toHaveLength(1);
    const failed = JSON.parse((await call("wss://badauth.example/mqtt")).body).response;
    // ingress·문서 표기 FAILED(core는 FAIL로 정규화할 수 있다), ok=false·stage
    expect(failed.steps.find((s: { status: string }) => s.status === "FAILED").name).toBe("AUTH");
    expect([failed.ok, failed.stage]).toEqual([false, "AUTH"]);
    expect(app.gateway.m2.sources).toHaveLength(1);
  });
});

describe("DSC-01.01 소스 편집(UI-DSC-08, API-DSC-04)", () => {
  it("PATCH에 baseVersion을 넣고, 빈 비밀값은 보내지 않는다(기존 유지). 다른 사용자가 먼저 고치면 409 안내", async () => {
    const browser = await integrator();
    const page = await browser.get("/sources/7/edit");
    expect(page.body).toContain("••••a1b2");
    const values = { ...emptyForm("MQTT_SUBSCRIBE", "mqtt"), code: "chirpstack-s3", name: "ChirpStack s3 (새 이름)", url: "wss://iot-data.java21.net:443/mqtt", auth: "HEADER", topics: [{ topic: "application/+/device/+/event/up", qos: 1 }] };
    const save = await browser.post("/sources/7/edit", { intent: "save", baseVersion: "3", payload: JSON.stringify(values) });
    expect(save.response.headers.get("Location")).toBe("/sources/7?tab=settings&saved=1");
    const patch = app.gateway.received.find((r) => r.method === "PATCH");
    expect(patch?.body).toMatchObject({ name: "ChirpStack s3 (새 이름)", baseVersion: 3 });
    expect(patch?.body).not.toHaveProperty("secret");
    expect(patch?.body).not.toHaveProperty("code");
    const stale = await browser.post("/sources/7/edit", { intent: "save", baseVersion: "3", payload: JSON.stringify(values) });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toContain("다른 사용자가 먼저 수정했습니다. 새로 고침해");
  });

  it("OPERATOR는 읽기 전용(저장 버튼 없음)", async () => {
    const page = await (await operator()).get("/sources/7/edit");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("읽기 전용입니다");
    expect(page.body).not.toContain('value="save"');
  });
});

describe("UI-DSC-03 소스 상세", () => {
  it("TC-DSC-061 상태 탭: 인스턴스 카드(상태·client-id·재연결·마지막 오류), 대표 상태, 6계열 차트 기간(최대 7일, TC-DSC-076)", async () => {
    const page = await (await operator()).get("/sources/7");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("ingress-0");
    expect(page.body).toContain("data2flow-chirpstack-s3-prod-1");
    expect(page.body).toContain("TIMEOUT");
    expect(page.body).toContain("최대 7일까지");
    expect(page.body).toContain("?tab=status&amp;range=7d");
    expect(page.body).not.toContain("range=30d");
    const stats = app.gateway.received.find((r) => r.path.startsWith("/api/v1/core/sources/7/stats"));
    expect(stats?.path).toContain("bucket=5m");
    expect(stats?.path).toContain(`from=${encodeURIComponent("2026-10-03T00:00:00Z")}`);
    // OPERATOR에게는 실시간 메시지 탭과 상태 버튼이 없다
    expect(page.body).not.toContain("?tab=live");
    expect(page.body).not.toContain('value="pause"');
  });

  it("대표 상태는 가장 나쁜 인스턴스(ERROR)", async () => {
    app.gateway.m2.sources[0].runtime[1].state = "ERROR";
    const page = await (await operator()).get("/sources/7");
    expect(page.body).toContain("오류");
  });

  it("TC-DSC-054 설정 탭: 기본 공간 이름이 링크, 삭제된 모델이면 \"모델 없음\"", async () => {
    app.gateway.m2.sources[0].defaultModelId = "999";
    const page = await (await operator()).get("/sources/7?tab=settings");
    expect(page.body).toContain('href="/spaces/3"');
    expect(page.body).toContain("광주캠퍼스 › 본관 › 3층");
    expect(page.body).toContain("모델 없음");
    app.gateway.m2.sources[0].defaultModelId = "11";
    const named = await (await operator()).get("/sources/7?tab=settings");
    expect(named.body).toContain('href="/models/EM300-TH"');
  });

  it("TC-DSC-168 상태에 맞는 버튼만: ACTIVE는 일시정지·보관, DRAFT는 활성화·삭제", async () => {
    const browser = await integrator();
    const active = await browser.get("/sources/7");
    expect(active.body).toContain(">일시정지<");
    expect(active.body).toContain(">보관<");
    expect(active.body).not.toContain(">활성화<");
    app.gateway.m2.sources[0].lifecycle = "DRAFT";
    const draft = await browser.get("/sources/7");
    expect(draft.body).toContain(">활성화<");
    expect(draft.body).toContain(">삭제<");
    expect(draft.body).not.toContain(">일시정지<");
  });

  it("TC-DSC-168 [보관]은 소스 코드를 정확히 입력해야 한다", async () => {
    const browser = await integrator();
    await browser.get("/sources/7");
    const wrong = await browser.post("/sources/7", { intent: "archive", baseVersion: "3", confirm: "chirp" });
    expect(wrong.response.status).toBe(400);
    expect(wrong.body).toContain("입력한 코드가 소스 코드와 다릅니다");
    expect(app.gateway.m2.sources[0].lifecycle).toBe("ACTIVE");
    const right = await browser.post("/sources/7", { intent: "archive", baseVersion: "3", confirm: "chirpstack-s3" });
    expect(right.response.status).toBe(200);
    expect(app.gateway.m2.sources[0].lifecycle).toBe("ARCHIVED");
    expect(app.gateway.received.find((r) => r.path === "/api/v1/core/sources/7/archive")?.body).toEqual({ baseVersion: 3, confirm: true });
  });

  it("삭제는 연결된 기기가 있으면 SOURCE_IN_USE, 복제는 새 DRAFT 편집 화면으로", async () => {
    const browser = await integrator();
    app.gateway.m2.sources[0].lifecycle = "ARCHIVED";
    await browser.get("/sources/7");
    const del = await browser.post("/sources/7", { intent: "delete", baseVersion: "3" });
    expect(del.response.status).toBe(409);
    expect(del.body).toContain("연결된 기기가 있어 삭제할 수 없습니다");
    const clone = await browser.post("/sources/7", { intent: "clone", code: "chirpstack-copy", name: "복제본" });
    expect(clone.response.status).toBe(302);
    expect(clone.response.headers.get("Location")).toMatch(/^\/sources\/\d+\/edit$/);
    expect(app.gateway.m2.sources.find((s) => s.code === "chirpstack-copy")?.lifecycle).toBe("DRAFT");
  });

  it("[DSC-07.06] TC-DSC-198 사용처 탭(API-DSC-11: 기기 수·플로우 링크·7일 수신량), 무시 목록 [해제](API-DSC-13)", async () => {
    const browser = await integrator();
    const usage = await browser.get("/sources/7?tab=usage");
    expect(usage.body).toContain("실습실 환기");
    // DSC-07.06 TC-DSC-198: 플로우 이름을 누르면 플로우 편집기로
    expect(usage.body).toContain('href="/automation/flows/201"');
    expect(usage.body).toContain('href="/devices?sourceId=7"');
    const ignore = await browser.get("/sources/7?tab=ignore");
    expect(ignore.body).toContain("24e1240000000001");
    await browser.post("/sources/7?tab=ignore", { intent: "unignore", externalId: "24e1240000000001" });
    expect((await browser.get("/sources/7?tab=ignore")).body).toContain("무시 목록이 비어 있습니다");
  });

  it("DSC-02.06 실시간 메시지 탭은 SRC_ADMIN만(EventSource 주소 /bff/stream/sources/7/live)", async () => {
    const page = await (await integrator()).get("/sources/7?tab=live");
    expect(page.body).toContain("토픽 필터");
    const op = await (await operator()).get("/sources/7?tab=live");
    expect(op.body).not.toContain("토픽 필터");
  });

  it("TC-DSC-112 플랫폼 브로커 소스의 자격증명 탭: 접속 정보만(API-DSC-23)", async () => {
    app.gateway.m2.sources.push({ ...structuredClone(app.gateway.m2.sources[0]), id: "8", code: "esp-broker", name: "ESP 브로커", type: "PLATFORM_BROKER" });
    const page = await (await operator()).get("/sources/8?tab=credentials");
    expect(page.body).toContain("wss://iot-data.java21.net/mqtt");
    expect(page.body).toContain("HMAC-SHA256");
    expect(page.body).not.toContain(">발급<");
    expect((await (await operator()).get("/sources/7?tab=credentials")).body).not.toContain("HMAC-SHA256");
  });

  it("없는 소스는 404", async () => {
    expect((await (await operator()).get("/sources/404")).response.status).toBe(404);
  });
});

describe("DSC-03.02 기기 자격증명 API(UI-DSC-06이 부르는 API-DSC-20~22)", () => {
  it("TC-DSC-113 플랫폼 브로커 기기만 발급, 비밀번호·서명 키는 발급 응답에만, 폐기 후 REVOKED, OPERATOR는 403", async () => {
    app.gateway.m2.sources.push({ ...structuredClone(app.gateway.m2.sources[0]), id: "8", code: "esp-broker", name: "ESP", type: "PLATFORM_BROKER" });
    app.gateway.m2.devices[0].sourceId = "8";
    const browser = await integrator();
    await browser.get("/sources");
    const headers = { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf };
    const issued = JSON.parse((await browser.request("/bff/api/core/devices/1042/credentials", { method: "POST", headers, body: JSON.stringify({ type: "PASSWORD" }) })).body).response;
    expect(issued.password).toBeTruthy();
    expect(issued.signingKey).toBeTruthy();
    const listed = JSON.parse((await browser.get("/bff/api/core/devices/1042/credentials")).body).response;
    expect(JSON.stringify(listed)).not.toContain(issued.password);
    const revoked = await browser.request(`/bff/api/core/devices/1042/credentials/${issued.credentialId}/revoke`, { method: "POST", headers, body: "{}" });
    expect(JSON.parse(revoked.body).response.status).toBe("REVOKED");
    const kim = await operator();
    await kim.get("/sources");
    const denied = await kim.request("/bff/api/core/devices/1042/credentials", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": kim.csrf }, body: "{}" });
    expect(denied.response.status).toBe(403);
  });
});

describe("core-api M2 계약 맞춤(SourceDtos·API-DSC-71·API-DSC-57)", () => {
  it("목록: 비율(0~1)은 %로, 조직 소스 한도 사용량 표시", async () => {
    app.gateway.m2.sources[0].decodeErrorRate1h = 0.121;
    const page = await (await integrator()).get("/sources");
    expect(page.body).toContain("12.1%");
    expect(page.body).toContain("소스 1/50");
  });

  it("새 소스 폼은 조직 토픽 한도를 쓰고, 연결 테스트는 timeoutSec 쿼리를 core로 넘긴다", async () => {
    const browser = await integrator();
    const page = await browser.get("/sources/new/mqtt");
    expect(page.body).toContain("토픽 1/20");
    await browser.request("/bff/api/core/sources/test?timeoutSec=22", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": browser.csrf }, body: JSON.stringify({ type: "MQTT_SUBSCRIBE", connection: { url: "wss://h/mqtt" }, topics: [{ topic: "a", qos: 1 }] }) });
    expect(app.gateway.received.some((r) => r.path === "/api/v1/core/sources/test?timeoutSec=22")).toBe(true);
  });

  it("상세 대표 상태는 core state를 따르고 보관에는 confirm을 보낸다", async () => {
    const browser = await integrator();
    app.gateway.m2.sources[0].state = "CONNECTING";
    const page = await browser.get("/sources/7?tab=status");
    expect(page.body).toContain("CONNECTING");
    await browser.post("/sources/7", { intent: "archive", baseVersion: "3", confirm: "chirpstack-s3" });
    const archive = app.gateway.received.find((r) => r.path === "/api/v1/core/sources/7/archive");
    expect(archive?.body).toMatchObject({ baseVersion: 3, confirm: true });
  });
});
