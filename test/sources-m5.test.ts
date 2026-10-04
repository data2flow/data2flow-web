/**
 * M5 데이터 소스 화면 SSR + BFF 통합: 커넥터 카탈로그 22종·템플릿(UI-DSC-07, DSC-09.01·09.12), 커넥터 스키마 폼(UI-DSC-08, DSC-09.05·09.06),
 * Webhook 수신 소스(DSC-01.03), 소스 복제(DSC-07.05), 출력 연결(UI-DSC-05, DSC-04.01), 엣지 게이트웨이(UI-DSC-10, DSC-08.03).
 * 시연 시나리오 4의 1단계(코드 배포 없이 새 제조사 MQTT 센서 연결)도 여기서 본다. 가짜 core: test/msw/handlers/sources-m5.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emptyConnectorForm, type ConnectorFormValues } from "~/features/sources/model/connector-source";
import { emptyOutput, type OutputFormValues } from "~/features/sources/model/output";
import type { ConnectorSchema, JsonSchema } from "~/features/sources/model/schema-form";
import { emptyForm } from "~/features/sources/model/source";
import SCHEMAS from "./msw/connector-schemas.json";
import { TestBrowser, startApp, type AppContext } from "./app-harness";
import { CATALOG, TEMPLATES, m5State } from "./msw/handlers/sources-m5";

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
const state = () => m5State(app.gateway.m2);
const schema = (key: string): ConnectorSchema => ({ key, jsonSchema: (SCHEMAS as unknown as Record<string, JsonSchema>)[key] });

function connectorForm(key: string, patch: Partial<ConnectorFormValues>): ConnectorFormValues {
  return { ...emptyConnectorForm(schema(key), []), ...patch };
}

describe("DSC-09.01·09.12 UI-DSC-07 커넥터 카탈로그 22종과 템플릿", () => {
  it("TC-DSC-308 템플릿 카드 11종과 카탈로그 커넥터가 모두 보이고, 유형 카드 7종 모두 만들 수 있다", async () => {
    const lee = await integrator();
    const page = await lee.get("/sources/new");
    expect(page.response.status).toBe(200);
    for (const t of TEMPLATES) expect(page.body).toContain(`?template=${t.key}`);
    expect(TEMPLATES).toHaveLength(11);
    // ingress가 보고하는 19종(MQTT·프리셋 4·AMQP 2·Kafka·NATS·Pub/Sub·Webhook·HTTP 폴링·SSE·CoAP·OPC UA·Modbus·BACnet·oneM2M·파일) + 플랫폼 브로커·가상 환경
    const enabled = CATALOG.filter((c) => c.enabled);
    expect(enabled).toHaveLength(21);
    for (const c of enabled) expect(page.body).toContain(`href="/sources/new/${c.connectorKey}"`);
    expect(page.body).toContain('href="/sources/new/webhook"');
    expect(page.body).toContain("클라우드 허브");
  });

  it("TC-DSC-309 아카데미 iot-data(WSS) 템플릿: 주소·WebSocket 헤더 Basic·토픽·QoS 1이 채워지고 비밀번호 칸만 비어 있다", async () => {
    const page = await (await integrator()).get("/sources/new/mqtt?template=academy-iot-data");
    expect(page.body).toContain("템플릿: 아카데미 iot-data (WSS)");
    const payload = /name="payload" value="([^"]+)"/.exec(page.body)?.[1] ?? "";
    const values = JSON.parse(payload.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, unknown>;
    expect(values).toMatchObject({ url: "wss://iot-data.java21.net:443/mqtt", auth: "HEADER", headerScheme: "Basic", headerName: "Authorization", qos: 1, secretValue: "", decoderKey: "chirpstack-v4" });
    expect(values.topics).toEqual([{ topic: "application/+/device/+/event/up", qos: 1 }]);
  });

  it("TC-DSC-304 커넥터 템플릿(Kafka): 부트스트랩 서버·토픽·보안 프로토콜과 디코더가 스키마 폼에 채워진다", async () => {
    const page = await (await integrator()).get("/sources/new/kafka?template=kafka");
    expect(page.response.status).toBe(200);
    expect(page.body).toContain("템플릿: Apache Kafka");
    expect(page.body).toContain("부트스트랩 서버");
    expect(page.body).toContain("kafka.example.com:9093");
    expect(page.body).toContain("인증 방식별 비밀값");
  });
});

describe("DSC-09.01·09.05·09.06 UI-DSC-08 커넥터 스키마 폼 저장", () => {
  it("시나리오 4 1단계: 새 제조사 센서를 코드 배포 없이 — Kafka 소스를 SASL 비밀번호·사설 CA와 함께 초안으로 저장(CA는 API-DSC-58)", async () => {
    const lee = await integrator();
    await lee.get("/sources/new/kafka");
    const values = connectorForm("kafka", { code: "vendor-kafka", name: "새 제조사 Kafka", authMethod: "SASL_SCRAM_512", connection: { bootstrapServers: "kafka.vendor.example:9093", topics: ["vendor.telemetry"], securityProtocol: "SASL_SSL", saslMechanism: "SCRAM-SHA-512" }, secrets: { PASSWORD: "vendor-secret-pw-77", CA_CERT: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----" }, decoderConfig: JSON.stringify({ deviceIdFrom: "$.id", metrics: [{ path: "$.t", key: "temperature" }] }) });
    const save = await lee.post("/sources/new/kafka", { intent: "draft", idempotencyKey: "idem-k", payload: JSON.stringify(values) });
    expect(save.response.status).toBe(302);
    const location = save.response.headers.get("Location") ?? "";
    expect(location).toMatch(/^\/sources\/\d+\?tab=settings$/);
    const id = /\/sources\/(\d+)/.exec(location)?.[1] ?? "";
    const created = app.gateway.m2.sources.find((s) => s.id === id);
    expect(created).toMatchObject({ type: "CONNECTOR", connectorKey: "kafka", lifecycle: "DRAFT", connection: { bootstrapServers: "kafka.vendor.example:9093", topics: ["vendor.telemetry"] } });
    expect(state().secrets[id]).toMatchObject({ PASSWORD: "vendor-secret-pw-77", CA_CERT: expect.stringContaining("BEGIN CERTIFICATE") });
    const detail = await lee.get(location);
    expect(detail.body).toContain("kafka");
    expect(detail.body).not.toContain("vendor-secret-pw-77");
  });

  it("스키마와 맞지 않는 값·활성화에 필요한 비밀값 누락은 BFF가 400으로 막는다(화면과 같은 규칙으로 서버에서 다시 검사)", async () => {
    const lee = await integrator();
    await lee.get("/sources/new/modbus-tcp");
    const bad = connectorForm("modbus-tcp", { code: "mb-1", name: "Modbus", connection: { host: "10.0.0.1", port: 70000 } });
    expect((await lee.post("/sources/new/modbus-tcp", { intent: "draft", payload: JSON.stringify(bad) })).response.status).toBe(400);
    const noSecret = connectorForm("amqp091", { code: "rmq-1", name: "RMQ", authMethod: "USER_PASSWORD", connection: { url: "amqps://h:5671", queue: "q" } });
    expect((await lee.post("/sources/new/amqp091", { intent: "activate", payload: JSON.stringify(noSecret) })).response.status).toBe(400);
    expect((await lee.post("/sources/new/amqp091", { intent: "draft", payload: "{" })).response.status).toBe(400);
    expect((await lee.post("/sources/new/amqp091", { intent: "draft", payload: JSON.stringify({ ...noSecret, connectorKey: "kafka" }) })).response.status).toBe(400);
    // core가 모르는 필드로 거부(SOURCE_CONFIG_INVALID errors[connection.x])
    const unknown = connectorForm("coap", { code: "coap-1", name: "CoAP", connection: { resources: ["coap://h/t"] } });
    const tls = await lee.post("/sources/new/coap", { intent: "draft", payload: JSON.stringify({ ...unknown, connection: { ...unknown.connection, tlsInsecure: true }, isDev: true }) });
    expect(tls.response.status).toBe(400);
    expect((await lee.post("/sources/new/no-such", { intent: "draft", payload: JSON.stringify(unknown) })).response.status).toBe(404);
  });

  it("편집: 스키마 폼으로 열리고 PATCH + baseVersion, 비밀값은 종류별 교체(API-DSC-58), 저장된 비밀값은 지문만", async () => {
    const lee = await integrator();
    await lee.get("/sources/new/nats-jetstream");
    const values = connectorForm("nats-jetstream", { code: "nats-a", name: "NATS", authMethod: "USER_PASSWORD", connection: { url: "nats://n:4222", stream: "S", subject: "s.>" }, secrets: { PASSWORD: "np-1" } });
    const save = await lee.post("/sources/new/nats-jetstream", { intent: "draft", payload: JSON.stringify(values) });
    const id = /\/sources\/(\d+)/.exec(save.response.headers.get("Location") ?? "")?.[1] ?? "";
    const edit = await lee.get(`/sources/${id}/edit`);
    expect(edit.response.status).toBe(200);
    expect(edit.body).toContain("••••np-1");
    expect(edit.body).not.toContain('"np-1"');
    const patched = await lee.post(`/sources/${id}/edit`, { intent: "save", baseVersion: "1", payload: JSON.stringify({ ...values, name: "NATS 2", secrets: { PASSWORD: "np-2" } }) });
    expect(patched.response.status).toBe(302);
    expect(patched.response.headers.get("Location")).toBe(`/sources/${id}?tab=settings&saved=1`);
    expect(app.gateway.m2.sources.find((s) => s.id === id)?.name).toBe("NATS 2");
    expect(state().secrets[id].PASSWORD).toBe("np-2");
    const stale = await lee.post(`/sources/${id}/edit`, { intent: "save", baseVersion: "1", payload: JSON.stringify(values) });
    expect(stale.response.status).toBe(409);
    expect((await lee.post(`/sources/${id}/edit`, { intent: "save", baseVersion: "2", payload: "{" })).response.status).toBe(400);
    const op = await (await operator()).get(`/sources/${id}/edit`);
    expect(op.body).toContain("읽기 전용입니다");
  });

  it("MQTT 구독 mTLS(DSC-09.06): 클라이언트 인증서·키는 한 건으로, 사설 CA는 USERPASS일 때 저장 뒤 API-DSC-58", async () => {
    const lee = await integrator();
    await lee.get("/sources/new/mqtt");
    const mqtt = { ...emptyForm("MQTT_SUBSCRIBE", "mqtt"), code: "mqtt-ca", name: "사설 CA 브로커", url: "ssl://broker.vendor.example:8883", auth: "USERPASS", username: "u", secretValue: "pw", topics: [{ topic: "vendor/+/up", qos: 1 }], tls: { minVersion: "1.3" as const, sni: "broker.vendor.example", pinnedSha256: [] }, tlsSecrets: { CA_CERT: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----" } };
    const save = await lee.post("/sources/new/mqtt", { intent: "draft", payload: JSON.stringify(mqtt) });
    expect(save.response.status).toBe(302);
    const id = /\/sources\/(\d+)/.exec(save.response.headers.get("Location") ?? "")?.[1] ?? "";
    expect(app.gateway.m2.sources.find((s) => s.id === id)?.connection).toMatchObject({ tls: { minVersion: "1.3", sni: "broker.vendor.example" } });
    expect(state().secrets[id]).toEqual({ CA_CERT: expect.stringContaining("ca") });
  });
});

describe("DSC-01.03 Webhook 수신 소스", () => {
  it("TC-DSC-023 저장하면 수신 URL과 HMAC 비밀값을 한 번만 보이고, 다시 열면 지문만 / TC-DSC-024 목록은 '수신 대기'", async () => {
    const lee = await integrator();
    const page = await lee.get("/sources/new/webhook");
    expect(page.body).toContain("수신 URL과 서명 비밀값은 저장하면 만들어집니다.");
    const values = connectorForm("webhook", { code: "vendor-hook", name: "제조사 Webhook", connection: { toleranceSec: 300, topic: "vendor/hook" } });
    const save = await lee.post("/sources/new/webhook", { intent: "activate", payload: JSON.stringify(values) });
    expect(save.response.status).toBe(200);
    expect(save.body).toContain("https://data2flow-hook.java21.net/ingest/webhook/");
    expect(save.body).toContain("hk_9f8e7d6c5b4a39281706f5e4d3c23f2a");
    const id = app.gateway.m2.sources.find((s) => s.code === "vendor-hook")?.id ?? "";
    const detail = await lee.get(`/sources/${id}?tab=settings`);
    expect(detail.body).toContain("••••3f2a");
    expect(detail.body).not.toContain("hk_9f8e7d6c5b4a39281706f5e4d3c23f2a");
    expect(detail.body).toContain("https://data2flow-hook.java21.net/ingest/webhook/");
    const list = await lee.get("/sources");
    expect(list.body).toContain("수신 대기");
  });
});

describe("DSC-07.05 소스 복제", () => {
  it("TC-DSC-192 [복제] → 새 DRAFT의 편집 화면, 비밀값은 복사되지 않아 다시 입력하라는 안내", async () => {
    const lee = await integrator();
    await lee.get("/sources/7");
    const clone = await lee.post("/sources/7", { intent: "clone", code: "chirpstack-s3-copy", name: "ChirpStack 사본" });
    expect(clone.response.status).toBe(302);
    const location = clone.response.headers.get("Location") ?? "";
    expect(location).toMatch(/\/edit\?cloned=1$/);
    const edit = await lee.get(location);
    expect(edit.body).toContain("복제한 소스입니다");
    expect(edit.body).toContain("chirpstack-s3-copy");
  });
});

describe("DSC-04.01 UI-DSC-05 출력 연결", () => {
  function outputValues(patch: Partial<OutputFormValues> = {}): OutputFormValues {
    return { ...emptyOutput("MQTT_PUBLISH"), name: "분석 서버 전달", url: "mqtts://analytics.example.com:8883", metrics: "co2", spaceIds: "31", secrets: { PASSWORD: "op-1" }, ...patch };
  }

  it("TC-DSC-129 목록은 OPERATOR도 보고(분당 전송·실패·지연), 만들기는 INTEGRATOR만, VIEWER는 403", async () => {
    const op = await operator();
    const list = await op.get("/sources?tab=outputs");
    expect(list.response.status).toBe(200);
    expect(list.body).toContain("본사 MQTT 전달");
    expect(list.body).toContain("140ms");
    expect(list.body).toContain("공간 1 · co2 · 품질 ≤0");
    expect(list.body).not.toContain('href="/outputs/new"');
    expect((await op.get("/outputs/new")).response.status).toBe(403);
    expect((await op.get("/outputs/301")).body).toContain("최근 1시간 전송");
    expect((await (await viewer()).get("/sources?tab=outputs")).response.status).toBe(403);
    const lee = await integrator();
    expect((await lee.get("/sources?tab=outputs")).body).toContain('href="/outputs/new"');
  });

  it("TC-DSC-127 만들기(API-DSC-30, Idempotency-Key)·허용 밖 토픽 변수와 공용 브로커는 저장 거부, 테스트 발송은 BFF 중계(API-DSC-32)", async () => {
    const lee = await integrator();
    const page = await lee.get("/outputs/new");
    expect(page.response.status).toBe(200);
    expect((await lee.post("/outputs/new", { payload: JSON.stringify(outputValues({ topicTemplate: "d2f/{room}" })) })).response.status).toBe(400);
    expect((await lee.post("/outputs/new", { payload: JSON.stringify(outputValues({ url: "wss://iot-data.java21.net:443/mqtt" })) })).response.status).toBe(400);
    expect((await lee.post("/outputs/new", { payload: "x" })).response.status).toBe(400);
    const save = await lee.post("/outputs/new", { idempotencyKey: "idem-o", payload: JSON.stringify(outputValues()) });
    expect(save.response.status).toBe(302);
    const id = /\/outputs\/(\d+)/.exec(save.response.headers.get("Location") ?? "")?.[1] ?? "";
    const created = state().outputs.find((o) => o.id === id);
    expect(created).toMatchObject({ type: "MQTT_PUBLISH", target: { topicTemplate: "d2f/{spaceCode}/{deviceName}/{metric}" }, filter: { spaceIds: ["31"], metrics: ["co2"] }, secretKinds: ["PASSWORD"] });
    expect((await lee.get(`/outputs/${id}?created=1`)).body).toContain("출력 연결을 만들었습니다");
    const test = await lee.request("/bff/api/core/output-connections/test", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": lee.csrf }, body: JSON.stringify({ name: "t", type: "MQTT_PUBLISH", target: { url: "mqtts://x:8883", topicTemplate: "d2f/{deviceName}/{metric}" }, sampleDeviceId: "1042" }) });
    expect(test.response.status).toBe(200);
    expect(test.body).toContain("d2f/AM107-067999/co2");
  });

  it("TC-DSC-128 상세 수정(PATCH + baseVersion, 409 충돌), 실패 보관함 다시 보내기(조직 시간대 → UTC), 삭제", async () => {
    const lee = await integrator();
    await lee.get("/outputs/301");
    const values = { ...emptyOutput("MQTT_PUBLISH"), name: "본사 MQTT 전달(수정)", url: "mqtts://hq.example.com:8883" };
    const saved = await lee.post("/outputs/301", { intent: "save", baseVersion: "2", payload: JSON.stringify(values) });
    expect(saved.response.status).toBe(200);
    expect(state().outputs[0]).toMatchObject({ name: "본사 MQTT 전달(수정)", version: 3, type: "MQTT_PUBLISH" });
    expect((await lee.post("/outputs/301", { intent: "save", baseVersion: "2", payload: JSON.stringify(values) })).response.status).toBe(409);
    expect((await lee.post("/outputs/301", { intent: "save", baseVersion: "3", payload: "{" })).response.status).toBe(400);
    const replay = await lee.post("/outputs/301", { intent: "replay", from: "2026-10-04T09:00", to: "2026-10-04T10:00", timezone: "Asia/Seoul" });
    expect(replay.body).toContain("7건을 다시 보내도록 넣었습니다");
    expect(state().replays[0]).toEqual({ id: "301", from: "2026-10-04T00:00:00Z", to: "2026-10-04T01:00:00Z" });
    const del = await lee.post("/outputs/301", { intent: "delete" });
    expect(del.response.status).toBe(302);
    expect(del.response.headers.get("Location")).toBe("/sources?tab=outputs");
    expect((await lee.get("/outputs/301")).response.status).toBe(404);
  });
});

describe("DSC-08.03 UI-DSC-10 엣지 게이트웨이", () => {
  it("TC-DSC-211 목록(상태·업데이트 가능·버퍼), 등록 → 토큰·설치 명령 1회 표시(BR-DSC-31), OPERATOR는 조회만", async () => {
    const op = await operator();
    const list = await op.get("/sources/edges");
    expect(list.response.status).toBe(200);
    expect(list.body).toContain("부산-기계실");
    expect(list.body).toContain("⬆ 1.4.2");
    expect(list.body).not.toContain("+ 등록");
    const lee = await integrator();
    expect((await lee.get("/sources/edges")).body).toContain("+ 등록");
    expect((await lee.post("/sources/edges", { name: "", siteId: "1" })).response.status).toBe(400);
    const reg = await lee.post("/sources/edges", { name: "광주-2층-엣지", siteId: "1", idempotencyKey: "idem-e" });
    expect(reg.response.status).toBe(200);
    expect(reg.body).toContain("edg_reg_7c1f9a2b4d");
    expect(reg.body).toContain("오프라인 설치 패키지 받기");
    expect(state().edges.at(-1)).toMatchObject({ name: "광주-2층-엣지", status: "REGISTERING" });
    expect((await lee.post("/sources/edges", { name: "x", siteId: "999" })).response.status).toBe(400);
  });

  it("TC-DSC-210 상세: 개요(오프라인 버퍼 안내), 설정 판 저장·배포·롤백(BR-DSC-32), 업데이트 승인, 재시작·로그 수집·폐기, 등록 전 토큰 재발급", async () => {
    const lee = await integrator();
    const overview = await lee.get("/sources/edges/402");
    expect(overview.body).toContain("버퍼에 데이터가 쌓이는 중일 수 있습니다");
    const config = await lee.get("/sources/edges/401?tab=config");
    expect(config.body).toContain("modbus-tcp");
    const created = await lee.post("/sources/edges/401", { intent: "createConfig", config: JSON.stringify({ targets: [{ connectorKey: "bacnet-ip", config: { host: "10.0.0.5" } }] }) });
    expect(created.response.status).toBe(302);
    expect(state().configs["401"][0]).toMatchObject({ version: 4, targets: [{ connectorKey: "bacnet-ip" }] });
    expect((await lee.post("/sources/edges/401", { intent: "createConfig", config: "{" })).response.status).toBe(400);
    expect((await lee.post("/sources/edges/401", { intent: "deploy", version: "4" })).body).toContain("반영했습니다");
    expect(state().edges[0].desiredConfigVersion).toBe(4);
    expect((await lee.post("/sources/edges/401", { intent: "rollback", version: "2" })).response.status).toBe(200);
    expect((await lee.post("/sources/edges/401", { intent: "deploy", version: "x" })).response.status).toBe(400);
    const update = await lee.get("/sources/edges/402?tab=update");
    expect(update.body).toContain("현재 1.4.1 · 최신 1.4.2");
    expect((await lee.post("/sources/edges/402", { intent: "approveUpdate", toVersion: "1.4.2" })).response.status).toBe(200);
    expect(state().updates["402"][0]).toMatchObject({ toVersion: "1.4.2", status: "PENDING" });
    expect((await lee.get("/sources/edges/401?tab=logs")).body).toContain("로그 수집");
    expect((await lee.post("/sources/edges/401", { intent: "collect-logs", minutes: "9999" })).response.status).toBe(400);
    expect((await lee.post("/sources/edges/401", { intent: "collect-logs", minutes: "120" })).body).toContain("요청했습니다");
    expect((await lee.post("/sources/edges/401", { intent: "restart" })).response.status).toBe(200);
    expect((await lee.post("/sources/edges/401", { intent: "revoke" })).response.status).toBe(200);
    expect(state().requests.map((r) => r.kind)).toEqual(["collect-logs", "restart", "revoke"]);
    expect((await lee.post("/sources/edges/401", { intent: "restart" })).response.status).toBe(409);
    expect((await lee.post("/sources/edges/401", { intent: "bogus" })).response.status).toBe(400);
    await lee.post("/sources/edges", { name: "신규", siteId: "1" });
    const fresh = state().edges.at(-1)?.id ?? "";
    const reissue = await lee.post(`/sources/edges/${fresh}`, { intent: "reissue" });
    expect(reissue.body).toContain("edg_reg_new_55aa");
    expect((await lee.get("/sources/edges/9999")).response.status).toBe(404);
    const op = await (await operator()).get("/sources/edges/402");
    expect(op.body).not.toContain(">재시작<");
  });
});
