/**
 * M5 데이터 소스 화면 부품(client): 커넥터 스키마 폼(UI-DSC-08, DSC-09.01·09.05·09.06), 단계별 연결 테스트 패널(UI-DSC-09, DSC-09.11),
 * 토픽 템플릿(DSC-09.08), Webhook 생성 1회 표시(DSC-01.03), 출력 연결(UI-DSC-05, DSC-04.01), 엣지(UI-DSC-10, DSC-08.03).
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SCHEMAS from "../../../../../test/msw/connector-schemas.json";
import { meOf, renderRoute } from "../../../../../test/render";
import { emptyConnectorForm } from "../../model/connector-source";
import { emptyOutput } from "../../model/output";
import type { ConnectorSchema, JsonSchema } from "../../model/schema-form";
import { ConnectionTestPanel, plannedSteps } from "../connection-test-panel";
import { AuthMatrix, ConnectorSourceForm } from "../connector-source-form";
import { ConfigVersions, EdgeList, EdgeRegistrationCard, EdgeUpdatesPanel } from "../edges";
import { OutputForm, OutputList, OutputStats } from "../outputs";
import { SourceForm } from "../source-form";
import { SourcesSubTabs } from "../sub-tabs";
import { emptyForm } from "../../model/source";
import { TlsSettingsBlock } from "../tls-settings";
import { TopicTemplateHelper } from "../topic-template";
import { WebhookCreated, curlExample } from "../webhook-created";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const schemas = SCHEMAS as unknown as Record<string, JsonSchema>;
const schemaOf = (key: string, extra: Partial<ConnectorSchema> = {}): ConnectorSchema => ({ key, version: "1.0.0", jsonSchema: schemas[key], uiHints: schemas[key]["x-ui"], ...extra });
const spaces = [{ id: "1", type: "SITE", name: "광주캠퍼스", children: [{ id: "31", type: "ROOM", name: "실습실" }] }];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function renderConnector(key: string, authMethods: string[], extra: Partial<Parameters<typeof ConnectorSourceForm>[0]> = {}) {
  const schema = extra.schema ?? schemaOf(key);
  const result = await renderRoute(
    <ConnectorSourceForm
      schema={schema}
      connector={{ connectorKey: key, name: String(schema.jsonSchema.title ?? key), category: "QUEUE", transports: [], authMethods, enabled: true, ackMode: "AFTER_WRITE", scaling: "SCALABLE" }}
      initial={{ ...emptyConnectorForm(schema, authMethods), code: "src-a", name: "소스 A" }}
      mode="create"
      models={[{ id: "11", code: "EM300", name: "EM300" }]}
      spaces={spaces}
      scripts={[{ id: "5", name: "디코더" }]}
      testPath="/bff/api/core/sources/test"
      idempotencyKey="k-1"
      {...extra}
    />,
    { session: meOf("INTEGRATOR") },
  );
  await screen.findByRole("navigation", { name: "설정 탭" });
  return result;
}

const payloadOf = (container: HTMLElement) => JSON.parse((container.querySelector('input[name="payload"]') as HTMLInputElement).value) as { connection: Record<string, unknown>; secrets: Record<string, string>; decoderConfig: string; authMethod: string };

describe("DSC-09.01 UI-DSC-08 커넥터 스키마 폼", () => {
  it("TC-DSC-232 Modbus TCP: x-ui 탭, 정수 범위 오류와 탭의 빨간 점, 측정점 목록 추가·삭제(최대 200), 기록 모드에서만 기록 영역", async () => {
    const { container } = await renderConnector("modbus-tcp", ["NONE"]);
    const nav = screen.getByRole("navigation", { name: "설정 탭" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["기본", "연결", "측정점", "TLS", "디코더", "정책"]);
    await userEvent.click(within(nav).getByRole("button", { name: "연결" }));
    const port = screen.getByLabelText("포트");
    await userEvent.clear(port);
    await userEvent.type(port, "70000");
    expect(screen.getByText("65535 이하여야 합니다")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /연결/ }).querySelector('[aria-label="오류 있음"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "초안으로 저장" })).toBeDisabled();
    await userEvent.clear(port);
    await userEvent.type(port, "1502");
    await userEvent.type(screen.getByLabelText("호스트 *"), "192.168.0.10");
    await userEvent.click(within(nav).getByRole("button", { name: "측정점" }));
    expect(screen.queryByText("기록 영역")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "+ 측정점" }));
    expect(screen.getByText("1/200")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("이름 *"), "temp");
    await userEvent.selectOptions(screen.getByLabelText("모드"), "log");
    expect(screen.getByText("기록 영역")).toBeInTheDocument();
    expect(screen.queryByText("1/200")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("모드"), "snapshot");
    await userEvent.click(screen.getByRole("button", { name: "1번 항목 삭제" }));
    expect(screen.getByText("0/200")).toBeInTheDocument();
    expect(payloadOf(container).connection).toMatchObject({ host: "192.168.0.10", port: 1502, mode: "snapshot", points: [] });
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeEnabled();
    expect(screen.getByText("수신 확인: 기록 후 확인(무손실)")).toBeInTheDocument();
  });

  it("TC-DSC-269 Kafka 인증 방식 매트릭스: 방식을 고르면 필요한 비밀값 칸, 필수 비밀값이 없으면 활성화만 막고 초안은 저장 가능", async () => {
    const { container } = await renderConnector("kafka", ["NONE", "SASL_PLAIN", "SASL_SCRAM_256", "SASL_SCRAM_512", "MTLS"], { initial: { ...emptyConnectorForm(schemaOf("kafka"), []), code: "kafka-hq", name: "Kafka", connection: { bootstrapServers: "k:9093", topics: ["iot"] } } });
    await userEvent.click(screen.getByRole("button", { name: "인증" }));
    const matrix = screen.getByRole("table", { name: "인증 방식별 비밀값" });
    expect(within(matrix).getByText("SASL SCRAM-SHA-512")).toBeInTheDocument();
    expect(within(matrix).getAllByText("클라이언트 인증서(PEM), 클라이언트 개인 키(PEM)")).toHaveLength(1);
    await userEvent.click(screen.getByLabelText("SASL SCRAM-SHA-512"));
    expect(screen.getByText(/인증 방식을 설정에 저장하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호 *")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "초안으로 저장" })).toBeEnabled();
    await userEvent.type(screen.getByLabelText("비밀번호 *"), "pw");
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeEnabled();
    expect(payloadOf(container)).toMatchObject({ authMethod: "SASL_SCRAM_512", secrets: { PASSWORD: "pw" } });
    await userEvent.click(screen.getByLabelText("클라이언트 인증서"));
    expect(screen.getByLabelText("클라이언트 인증서(PEM) *")).toBeInTheDocument();
  });

  it("Sparkplug B: 스키마 auth enum이 인증 방식이 되고(저장), 사용자·비밀번호일 때만 사용자 이름 칸, 디코더는 sparkplug-b", async () => {
    const { container } = await renderConnector("sparkplug-b", ["NONE", "USER_PASSWORD", "MTLS"], { initial: { ...emptyConnectorForm(schemaOf("sparkplug-b"), []), code: "spb", name: "SPB", connection: { url: "tcp://b:1883" } } });
    await userEvent.click(screen.getByRole("button", { name: "연결" }));
    expect(screen.queryByLabelText("사용자 이름")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "인증" }));
    await userEvent.click(screen.getByLabelText("사용자·비밀번호"));
    expect(payloadOf(container).connection.auth).toBe("USERPASS");
    await userEvent.click(screen.getByRole("button", { name: "연결" }));
    expect(screen.getByLabelText("사용자 이름")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "디코더" }));
    expect(screen.getByLabelText("디코더")).toHaveValue("sparkplug-b");
  });

  it("TLS 탭(DSC-09.06): 검증 끄기는 개발 소스만, CA 묶음 PEM 파일 올리기·개수, 서버 필드 오류는 해당 칸에, 읽기 전용", async () => {
    await renderConnector("amqp091", ["USER_PASSWORD", "MTLS"], {
      initial: { ...emptyConnectorForm(schemaOf("amqp091"), []), code: "rmq", name: "RMQ", connection: { url: "amqps://h:5671", queue: "q" }, authMethod: "USER_PASSWORD" },
      serverFieldErrors: [{ field: "connection.queue", code: "Pattern", message: "큐 이름 형식이 틀렸습니다" }],
      serverError: { code: "X_UNMAPPED", message: "설정 오류" },
    });
    expect(screen.getByText("설정 오류")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "TLS" }));
    await userEvent.click(screen.getByLabelText("TLS 서버 인증서 검증"));
    expect(screen.getByText("TLS 검증 끄기는 개발 소스에서만 허용됩니다")).toBeInTheDocument();
    expect(screen.getByText(/SNI·최소 버전·고정을 설정에 두지 않습니다/)).toBeInTheDocument();
    const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
    const file = new File([`${pem}\n${pem}`], "ca.pem", { type: "application/x-pem-file" });
    await userEvent.upload(screen.getByLabelText("CA 묶음(PEM) 파일 올리기"), file);
    expect(await screen.findByText("인증서 2개를 읽었습니다")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("navigation", { name: "설정 탭" })).getByRole("button", { name: /^연결/ }));
    expect(screen.getByText("큐 이름 형식이 틀렸습니다")).toBeInTheDocument();
  });

  it("읽기 전용(OPERATOR)·편집 모드: 저장된 비밀값은 지문만, 저장 버튼 없음, 복제 안내", async () => {
    await renderConnector("http-poll", ["NONE", "TOKEN"], {
      mode: "edit",
      readOnly: true,
      cloned: true,
      baseVersion: 3,
      storedSecrets: [{ kind: "TOKEN", configured: true, fingerprint: "••••a1b2" }],
      initial: { ...emptyConnectorForm(schemaOf("http-poll"), ["NONE", "TOKEN"]), code: "poll", name: "폴링", connection: { url: "https://api.example.com/v1", auth: { type: "BEARER" } } },
    });
    expect(screen.getByText(/읽기 전용입니다/)).toBeInTheDocument();
    expect(screen.getByText(/복제한 소스입니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "인증" }));
    expect(screen.getByLabelText("Bearer 토큰")).toBeChecked();
    expect(screen.getByText(/저장됨 ••••a1b2/)).toBeInTheDocument();
    expect(screen.getByLabelText("Token Url")).toBeInTheDocument();
  });

  it("Webhook 수신: 인증·TLS 탭이 없고 수신 URL은 저장 뒤 만들어진다는 안내", async () => {
    await renderConnector("webhook", ["TOKEN"]);
    const nav = screen.getByRole("navigation", { name: "설정 탭" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["기본", "연결", "디코더", "정책"]);
    expect(screen.getByText("수신 URL과 서명 비밀값은 저장하면 만들어집니다.")).toBeInTheDocument();
  });

  it("TC-DSC-301 폴링형(HTTP 폴링)은 같은 연결 테스트 패널에 '구독' 대신 '첫 폴링', 테스트 본문은 type CONNECTOR·connectorKey", async () => {
    const fetchMock = vi.fn(async () => json({ header: { resultCode: "SOURCE_CONFIG_INVALID", resultMessage: "" } }, 400));
    vi.stubGlobal("fetch", fetchMock);
    await renderConnector("http-poll", ["NONE"], { initial: { ...emptyConnectorForm(schemaOf("http-poll"), []), code: "poll", name: "폴링", connection: { url: "https://api.example.com/v1" } } });
    const steps = screen.getByRole("list", { name: "테스트 단계" });
    expect(within(steps).getByText("첫 폴링")).toBeInTheDocument();
    expect(within(steps).queryByText("구독")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "연결 테스트" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/bff/api/core/sources/test?timeoutSec=15");
    expect(JSON.parse(String(init.body))).toMatchObject({ type: "CONNECTOR", connectorKey: "http-poll", connection: { url: "https://api.example.com/v1" } });
    expect(await screen.findByText("소스 설정이 올바르지 않습니다.")).toBeInTheDocument();
  });

  it("디코더 탭: generic-json 매핑 편집기 + 토픽 템플릿 [디코더에 적용], 스크립트 선택", async () => {
    const { container } = await renderConnector("amqp10", ["NONE"], { initial: { ...emptyConnectorForm(schemaOf("amqp10"), []), code: "a10", name: "A10", connection: { url: "amqps://h", address: "q" } } });
    await userEvent.click(screen.getByRole("button", { name: "디코더" }));
    fireEvent.change(screen.getByLabelText("템플릿"), { target: { value: "devices/{deviceId}/{metric}" } });
    await userEvent.click(screen.getByRole("button", { name: "디코더에 적용" }));
    expect(JSON.parse(payloadOf(container).decoderConfig).deviceIdFrom).toBe("topic[1]");
    await userEvent.selectOptions(screen.getByLabelText("디코더"), "script");
    expect(screen.getByLabelText("DECODE 스크립트")).toBeInTheDocument();
  });

  it("AuthMatrix: 현재 방식 굵게, 비밀값 없으면 –", async () => {
    await renderRoute(<AuthMatrix schema={schemaOf("coap")} supported={["NONE"]} current="NONE" />);
    const table = await screen.findByRole("table", { name: "인증 방식별 비밀값" });
    expect(within(table).getByText("없음").closest("tr")).toHaveClass("font-semibold");
    expect(within(table).getByText("–")).toBeInTheDocument();
  });
});

describe("DSC-09.11 UI-DSC-09 단계별 연결 테스트 패널", () => {
  it("TC-DSC-302 대기·진행 아이콘, 제한 시간(+여유 3초)이 지나면 '시간 초과'로 끝난다(fake timers)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    await renderConnector("coap", ["NONE"], { initial: { ...emptyConnectorForm(schemaOf("coap"), []), code: "coap-a", name: "CoAP", connection: { resources: ["coap://h/temp"] } } });
    fireEvent.click(screen.getByRole("button", { name: "연결 테스트" }));
    expect(await screen.findByText("연결 테스트 중… (최대 15초)")).toBeInTheDocument();
    expect(screen.getByText("◌")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(18_100);
    });
    expect(await screen.findByText(/시간 초과로 끝났습니다/)).toBeInTheDocument();
    expect(plannedSteps(false)).toEqual(["DNS", "TCP", "TLS", "AUTH", "SUBSCRIBE"]);
  });

  it("TC-DSC-278 TLS 성공은 발급자·만료일, 미리보기 [원문 복사], 단계 원인 코드 번역", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await renderRoute(
      <ConnectionTestPanel
        testing={false}
        result={{
          ok: true,
          steps: [
            { name: "TLS", status: "OK", ms: 41, tlsChain: [{ subject: "CN=iot-data.java21.net", issuer: "Let's Encrypt R11", notAfter: "2027-01-01" }] },
            { name: "AUTH", status: "FAILED", code: "AUTH_FAILED" },
            { name: "POLL", status: "SKIPPED" },
          ],
          preview: [{ at: "x", topic: "t/1", size: 5, rawExcerpt: '{"a":1}' }],
        }}
      />,
    );
    expect(await screen.findByText("발급자 Let's Encrypt R11 · 만료 2027-01-01")).toBeInTheDocument();
    expect(screen.getByText("인증 실패")).toBeInTheDocument();
    expect(screen.getByText("첫 폴링")).toBeInTheDocument();
    await userEvent.click(screen.getByText("t/1"));
    await userEvent.click(screen.getByRole("button", { name: "원문 복사" }));
    expect(writeText).toHaveBeenCalledWith('{"a":1}');
    expect(screen.getByRole("button", { name: "복사했습니다" })).toBeInTheDocument();
  });

  it("복사 실패는 조용히 넘어간다, 오류 응답은 패널에 보인다", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("x"))) } });
    await renderRoute(<ConnectionTestPanel testing={false} error="요청이 너무 많습니다" result={{ steps: [{ name: "SUBSCRIBE", status: "OK" }], preview: [{ at: "x", topic: "t/2", size: 1, rawExcerpt: "r" }] }} />);
    await userEvent.click(await screen.findByText("t/2"));
    await userEvent.click(screen.getByRole("button", { name: "원문 복사" }));
    expect(screen.getByRole("button", { name: "원문 복사" })).toBeInTheDocument();
  });
});

describe("DSC-09.08 토픽 템플릿 도우미", () => {
  it("TC-DSC-289 표본 토픽 추출 표(역할 배지), 구독 필터, 불일치는 미처리, 오류·적용 조건 안내", async () => {
    const onApply = vi.fn();
    await renderRoute(<TopicTemplateHelper decoderKey="single-value" decoderConfig="" sampleTopic="site/gwangju/room/301/em300-01/temperature" onApply={onApply} />);
    const template = await screen.findByLabelText("템플릿");
    fireEvent.change(template, { target: { value: "site/{site}/room/{room}/{deviceId}/{metric}" } });
    const table = screen.getByRole("table", { name: "추출 결과" });
    expect(within(table).getByText("em300-01")).toBeInTheDocument();
    expect(within(table).getByText("기기 ID")).toBeInTheDocument();
    expect(within(table).getAllByText("공간")).toHaveLength(2);
    expect(screen.getByText("구독 필터: site/+/room/+/+/+")).toBeInTheDocument();
    expect(screen.getByText(/공간 값은 미리 보기만 합니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "디코더에 적용" }));
    expect(JSON.parse(onApply.mock.calls[0][0] as string)).toEqual({ deviceIdFrom: "topic[4]", metricFrom: "topic[5]" });
    fireEvent.change(screen.getByLabelText("표본 토픽"), { target: { value: "site/gwangju/hall/301/x/y" } });
    expect(screen.getByText("표본 토픽이 템플릿과 맞지 않습니다(미처리)")).toBeInTheDocument();
    fireEvent.change(template, { target: { value: "a/+/{room}" } });
    expect(screen.getByText("2번째 단계: 템플릿에는 +·#를 쓸 수 없습니다")).toBeInTheDocument();
    fireEvent.change(template, { target: { value: "a/{room}" } });
    expect(screen.getByText("{deviceId} 변수가 있어야 적용할 수 있습니다")).toBeInTheDocument();
  });

  it("chirpstack 디코더에서는 적용할 수 없다는 안내", async () => {
    await renderRoute(<TopicTemplateHelper decoderKey="chirpstack-v4" decoderConfig="" onApply={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("템플릿"), { target: { value: "d/{deviceId}" } });
    expect(screen.getByText("generic-json·single-value 디코더에서 적용할 수 있습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "디코더에 적용" })).toBeDisabled();
  });
});

describe("DSC-09.06 TLS 설정 묶음(MQTT 구독)", () => {
  it("TC-DSC-274 최소 버전·SNI 오류·고정 지문 추가(최대 5)·잘못된 지문, 만료 30일 이내 경고, mTLS 인증서·키 칸", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
    const onTls = vi.fn();
    const onSecret = vi.fn();
    await renderRoute(
      <TlsSettingsBlock
        tls={{ minVersion: "", sni: "bad host", pinnedSha256: ["zz", "", "", "", ""] }}
        onTls={onTls}
        verifyOff={false}
        onVerifyOff={vi.fn()}
        isDev
        secrets={{ CA_CERT: "not pem" }}
        onSecret={onSecret}
        clientCert
        stored={[{ kind: "CLIENT_CERT", configured: true, fingerprint: "••••9f9f", certificateExpiresAt: "2026-10-20T00:00:00Z" }]}
        showErrors
      />,
    );
    expect(await screen.findByText("클라이언트 인증서(PEM)이(가) 2026-10-20에 만료됩니다(30일 이내). 교체하세요.")).toBeInTheDocument();
    expect(screen.getByText("호스트 이름 형식이 아닙니다")).toBeInTheDocument();
    expect(screen.getByText("SHA-256 지문(hex 64자 또는 Base64 44자)이어야 합니다")).toBeInTheDocument();
    expect(screen.getByText("PEM 인증서(-----BEGIN CERTIFICATE-----)가 아닙니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 지문" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("최소 TLS 버전"), "1.3");
    expect(onTls).toHaveBeenLastCalledWith(expect.objectContaining({ minVersion: "1.3" }));
    await userEvent.click(screen.getAllByRole("button", { name: "제거" })[0]);
    expect(onTls).toHaveBeenLastCalledWith(expect.objectContaining({ pinnedSha256: ["", "", "", ""] }));
    fireEvent.change(screen.getByLabelText("클라이언트 개인 키(PEM) *"), { target: { value: "KEY" } });
    expect(onSecret).toHaveBeenCalledWith("CLIENT_KEY", "KEY");
    expect(screen.getByText(/저장됨 ••••9f9f/)).toBeInTheDocument();
  });
});

describe("DSC-01.03 Webhook 수신 소스 생성 결과", () => {
  it("TC-DSC-023 수신 URL과 HMAC 비밀값 1회 표시, [복사], 서명 curl 예시", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const url = "https://data2flow-hook.java21.net/ingest/webhook/abc";
    await renderRoute(<WebhookCreated sourceId="9" webhookUrl={url} secret={{ kind: "HMAC_KEY", value: "hk_secret_3f2a" }} />);
    expect(await screen.findByText(url)).toBeInTheDocument();
    expect(screen.getByText(/지금 한 번만 보입니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "비밀값 복사" }));
    expect(writeText).toHaveBeenCalledWith("hk_secret_3f2a");
    await userEvent.click(screen.getByRole("button", { name: "URL 복사" }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(screen.getByRole("link", { name: "소스 상세로" })).toHaveAttribute("href", "/sources/9?tab=settings");
    expect(curlExample(url)).toContain("X-D2F-Signature: $SIG");
  });

  it("복사 실패·URL 없음", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("x"))) } });
    await renderRoute(<WebhookCreated sourceId="9" webhookUrl={null} secret={{ kind: "HMAC_KEY", value: "s" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "비밀값 복사" }));
    expect(screen.queryByRole("button", { name: "URL 복사" })).toBeNull();
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});

describe("DSC-04.01 UI-DSC-05 출력 연결", () => {
  const devices = [{ id: "1042", name: "AM107-067999" }];

  it("TC-DSC-130 토픽 템플릿에 허용 밖 변수가 있으면 렌더 오류, 저장 불가 / [테스트]는 샘플 기기 렌더링 결과와 대상 응답", async () => {
    const fetchMock = vi.fn(async () => json({ header: { resultCode: "SUCCESS" }, response: { ok: true, rendered: { topic: "d2f/room-301/AM107-067999/co2" }, response: { status: 200, bodyPreview: "ok" } } }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = await renderRoute(<OutputForm initial={{ ...emptyOutput(), name: "본사", url: "mqtts://hq.example.com:8883" }} mode="create" devices={devices} idempotencyKey="idem-1" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("표본 토픽: d2f/room-301/AM107-067999/temperature")).toBeInTheDocument();
    const topic = screen.getByLabelText("토픽 템플릿");
    fireEvent.change(topic, { target: { value: "d2f/{room}/{deviceName}" } });
    expect(screen.getByText("렌더 오류: 허용되지 않는 변수 {room}")).toBeInTheDocument();
    expect(screen.getByText(/토픽 템플릿 변수는 \{spaceCode\}, \{deviceName\}, \{deviceId\}, \{metric\}만 쓸 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "테스트 발송" })).toBeDisabled();
    fireEvent.change(topic, { target: { value: "d2f/{spaceCode}/{deviceName}/{metric}" } });
    await userEvent.click(screen.getByRole("button", { name: "테스트 발송" }));
    expect(await screen.findByText("대상이 받았습니다")).toBeInTheDocument();
    expect(screen.getByText(/d2f\/room-301\/AM107-067999\/co2/)).toBeInTheDocument();
    expect(screen.getByText("대상 응답 (200)")).toBeInTheDocument();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/bff/api/core/output-connections/test");
    expect(JSON.parse(String(init.body))).toMatchObject({ sampleDeviceId: "1042", type: "MQTT_PUBLISH", target: { topicTemplate: "d2f/{spaceCode}/{deviceName}/{metric}" } });
    expect((container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement).value).toBe("idem-1");
  });

  it("Webhook: 비밀 헤더는 비밀값으로, 배치 범위, 템플릿 형식과 모르는 변수, 테스트 실패 원인", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ header: { resultCode: "SUCCESS" }, response: { ok: false, failureKind: "REFUSED", rendered: "[]", response: null } })));
    await renderRoute(<OutputForm initial={{ ...emptyOutput("WEBHOOK"), name: "웹훅", url: "https://example.com/h" }} mode="edit" outputId="301" baseVersion={2} configuredKinds={["HMAC_KEY"]} devices={devices} serverError={{ code: "VERSION_CONFLICT" }} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText(/다른 사용자가 먼저 수정했습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText("유형")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "+ 헤더" }));
    await userEvent.type(screen.getByLabelText("헤더 1 이름"), "Authorization");
    expect(screen.getByText("인증 헤더는 비밀값으로 넣으세요")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "제거" })[0]);
    fireEvent.change(screen.getByLabelText("배치 크기(1~500)"), { target: { value: "0" } });
    expect(screen.getByText("1~500 사이로 입력하세요")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("배치 크기(1~500)"), { target: { value: "50" } });
    await userEvent.selectOptions(screen.getByLabelText("형식"), "TEMPLATE");
    fireEvent.change(screen.getByLabelText("본문 템플릿"), { target: { value: "{{deviceName}} {{bogus}}" } });
    expect(screen.getByText("모르는 변수는 빈 값으로 바뀝니다: bogus")).toBeInTheDocument();
    expect(screen.getByText(/저장됨 ••••/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "테스트 발송" }));
    expect(await screen.findByText("실패: 연결 거부")).toBeInTheDocument();
  });

  it("테스트 요청 오류는 경고로, 서버 필드 오류 코드 번역", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ header: { resultCode: "PERMISSION_DENIED", resultMessage: "" } }, 403)));
    await renderRoute(<OutputForm initial={{ ...emptyOutput(), name: "본사", url: "mqtts://hq:8883" }} mode="create" devices={devices} serverFieldErrors={[{ field: "target.url", code: "FORBIDDEN_HOST", message: "" }]} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("공용 브로커 iot-data.java21.net으로는 보낼 수 없습니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "테스트 발송" }));
    await waitFor(() => expect(screen.queryByText("보내는 중…")).toBeNull());
    expect(screen.queryByText("대상이 받았습니다")).toBeNull();
  });

  it("목록(필터 요약·분당 전송·실패·지연·사용)과 빈 상태, 지표·재전송 폼, 하위 탭", async () => {
    const outputs = [
      { id: "301", name: "본사 MQTT 전달", type: "MQTT_PUBLISH" as const, target: { url: "mqtts://hq:8883" }, filter: { spaceIds: ["31"], metrics: ["co2"], qualityMin: 0, deviceIds: ["1"], groupIds: ["2"] }, format: "CANONICAL" as const, enabled: true, version: 1 },
      { id: "302", name: "꺼진 Webhook", type: "WEBHOOK" as const, target: {}, filter: null, format: "CANONICAL" as const, enabled: false, version: 1 },
    ];
    const { unmount } = await renderRoute(
      <>
        <SourcesSubTabs current="outputs" />
        <OutputList outputs={outputs} stats={{ "301": [{ t: "a", sent: 12, failed: 2, retried: 2, lagMs: 140 }] }} canAdmin />
      </>,
    );
    expect(await screen.findByRole("link", { name: "본사 MQTT 전달" })).toHaveAttribute("href", "/outputs/301");
    expect(screen.getByText("기기 1 · 그룹 1 · 공간 1 · co2 · 품질 ≤0")).toBeInTheDocument();
    expect(screen.getByText("140ms")).toBeInTheDocument();
    expect(screen.getByText("전체")).toBeInTheDocument();
    expect(screen.getByText("중지")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "출력 연결" })).toHaveAttribute("aria-current", "page");
    unmount();
    await renderRoute(<OutputList outputs={[]} stats={{}} canAdmin />);
    expect(await screen.findByRole("link", { name: "새 출력 연결" })).toHaveAttribute("href", "/outputs/new");
  });

  it("지표 요약·재전송 결과", async () => {
    await renderRoute(<OutputStats stats={[{ t: "2026-10-04T00:00:00Z", sent: 12, failed: 2, retried: 2, lagMs: 140 }]} timezone="Asia/Seoul" canAdmin replayed={7} />);
    expect(await screen.findByText("전송 12 · 실패 2 · 재시도 2 · 지연 140ms")).toBeInTheDocument();
    expect(screen.getByText("7건을 다시 보내도록 넣었습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 보내기" })).toBeInTheDocument();
  });
});

describe("DSC-08.03 UI-DSC-10 엣지 게이트웨이", () => {
  const edge = { id: "402", name: "부산-기계실", site: { id: "1", name: "광주캠퍼스" }, status: "OFFLINE", agentVersion: "1.4.1", bufferUsedBytes: 440_000_000, bufferItems: 88_000, throughput: null, lastSeenAt: "2026-10-03T20:00:00Z", latestAgentVersion: "1.4.2", updateAvailable: true, appliedConfigVersion: 5, version: 1 };

  it("목록: 상태·업데이트 가능·버퍼 %·건수, 빈 상태", async () => {
    const { unmount } = await renderRoute(<EdgeList edges={[edge, { ...edge, id: "401", name: "광주", status: "ONLINE", throughput: 86, bufferUsedBytes: null, updateAvailable: false, appliedConfigVersion: null }]} now={Date.parse("2026-10-04T00:00:00Z")} lang="ko" />);
    expect(await screen.findByText("오프라인")).toBeInTheDocument();
    expect(screen.getByText("⬆ 1.4.2")).toBeInTheDocument();
    expect(screen.getByText("41% (88k)")).toBeInTheDocument();
    expect(screen.getByText("86/분")).toBeInTheDocument();
    unmount();
    await renderRoute(<EdgeList edges={[]} now={0} lang="ko" />);
    expect(await screen.findByText("엣지 게이트웨이가 없습니다")).toBeInTheDocument();
  });

  it("등록 토큰 1회 표시와 복사, 설치 명령·오프라인 패키지", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await renderRoute(<EdgeRegistrationCard registration={{ id: "9", name: "새 엣지", status: "REGISTERING", registrationToken: "edg_reg_1", expiresAt: "2026-10-05T00:00:00Z", installCommand: "curl … edg_reg_1", offlinePackageUrl: "/pkg" }} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText(/한 번만 쓸 수 있고 다시 볼 수 없습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "토큰 복사" }));
    expect(writeText).toHaveBeenCalledWith("edg_reg_1");
    expect(screen.getByRole("link", { name: "오프라인 설치 패키지 받기" })).toHaveAttribute("href", "/pkg");
  });

  it("설정 판: 적용·배포 중 배지, 실패 결과, 잘못된 JSON이면 저장 불가, 업데이트 승인과 이력", async () => {
    const versions = [
      { version: 4, targets: [{ connectorKey: "bacnet-ip" }], decoders: {}, result: "FAILED_ROLLED_BACK", error: "timeout", desired: true, applied: false, deployedAt: "2026-10-03T00:00:00Z" },
      { version: 3, targets: [{ connectorKey: "modbus-tcp" }], decoders: {}, result: "APPLIED", desired: false, applied: true },
    ];
    const { unmount } = await renderRoute(<ConfigVersions versions={versions} canAdmin timezone="Asia/Seoul" lang="ko" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("실패·이전 판으로 복귀")).toBeInTheDocument();
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText("배포 중")).toBeInTheDocument();
    expect(screen.getByText("적용됨")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("설정(JSON)"), { target: { value: "{" } });
    expect(screen.getByText("JSON 형식이 올바르지 않습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "판 저장" })).toBeDisabled();
    unmount();
    await renderRoute(<ConfigVersions versions={[]} canAdmin={false} timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("설정 판이 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "판 저장" })).toBeNull();
  });

  it("업데이트 패널: 현재·최신, 승인 폼, 이력 배지, 불러오기 실패", async () => {
    const { unmount } = await renderRoute(<EdgeUpdatesPanel updates={{ currentVersion: "1.4.1", latestVersion: "1.4.2", availableVersions: ["1.4.2"], updates: [{ updateId: "1", fromVersion: "1.4.0", toVersion: "1.4.1", status: "SUCCEEDED", createdAt: "2026-10-01T00:00:00Z" }] }} canAdmin timezone="Asia/Seoul" lang="ko" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("현재 1.4.1 · 최신 1.4.2")).toBeInTheDocument();
    expect(screen.getByText("성공")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이 엣지 업데이트 승인" })).toBeInTheDocument();
    unmount();
    const { unmount: u2 } = await renderRoute(<EdgeUpdatesPanel updates={{ availableVersions: [], updates: [] }} canAdmin timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("업데이트 이력이 없습니다")).toBeInTheDocument();
    u2();
    await renderRoute(<EdgeUpdatesPanel updates={null} canAdmin timezone="Asia/Seoul" lang="ko" />);
    expect(await screen.findByText("업데이트 정보를 불러오지 못했습니다")).toBeInTheDocument();
  });
});

describe("입력 처리(폼 값 반영)", () => {
  it("출력 연결 폼: 모든 칸이 payload에 반영된다(유형 전환·QoS·retain·필터·품질·형식·비밀값·헤더 값·메서드)", async () => {
    const { container } = await renderRoute(<OutputForm initial={emptyOutput()} mode="create" devices={[]} />, { session: meOf("INTEGRATOR") });
    const payload = () => JSON.parse((container.querySelector('input[name="payload"]') as HTMLInputElement).value) as Record<string, unknown>;
    fireEvent.change(await screen.findByLabelText("이름"), { target: { value: "본사" } });
    fireEvent.change(screen.getByLabelText("대상 URL"), { target: { value: "mqtts://hq:8883" } });
    await userEvent.selectOptions(screen.getByLabelText("QoS"), "0");
    await userEvent.click(screen.getByLabelText("retain"));
    fireEvent.change(screen.getByLabelText("사용자 이름"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("그룹 ID"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("공간 ID"), { target: { value: "31" } });
    fireEvent.change(screen.getByLabelText("기기 ID"), { target: { value: "1042" } });
    fireEvent.change(screen.getByLabelText("측정 항목"), { target: { value: "co2" } });
    await userEvent.selectOptions(screen.getByLabelText("최소 품질"), "1");
    await userEvent.click(screen.getByLabelText("사용"));
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "pw" } });
    expect(payload()).toMatchObject({ name: "본사", url: "mqtts://hq:8883", qos: 0, retain: true, username: "u1", groupIds: "2", spaceIds: "31", deviceIds: "1042", metrics: "co2", qualityMin: "1", enabled: false, secrets: { PASSWORD: "pw" } });
    await userEvent.selectOptions(screen.getByLabelText("유형"), "WEBHOOK");
    await userEvent.selectOptions(screen.getByLabelText("메서드"), "PUT");
    fireEvent.change(screen.getByLabelText("인증 헤더 이름"), { target: { value: "X-Key" } });
    fireEvent.change(screen.getByLabelText("배치 대기(ms, 0~10000)"), { target: { value: "500" } });
    await userEvent.click(screen.getByRole("button", { name: "+ 헤더" }));
    fireEvent.change(screen.getByLabelText("헤더 1 값"), { target: { value: "v" } });
    fireEvent.change(screen.getByLabelText("헤더 값"), { target: { value: "secret-h" } });
    expect(payload()).toMatchObject({ type: "WEBHOOK", method: "PUT", authHeaderName: "X-Key", batchWaitMs: "500", headers: [{ name: "", value: "v" }], secrets: { PASSWORD: "pw", HEADER_VALUE: "secret-h" } });
  });

  it("TLS 묶음: 검증 토글·SNI·지문 추가·변경·CA·클라이언트 인증서 입력, 읽기 전용이면 편집 버튼 없음", async () => {
    const onTls = vi.fn();
    const onSecret = vi.fn();
    const onVerifyOff = vi.fn();
    const { unmount } = await renderRoute(<TlsSettingsBlock tls={{ minVersion: "", sni: "", pinnedSha256: [""] }} onTls={onTls} verifyOff onVerifyOff={onVerifyOff} isDev={false} secrets={{}} onSecret={onSecret} clientCert />);
    expect(await screen.findByText("TLS 검증 끄기는 개발 소스에서만 허용됩니다")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("TLS 서버 인증서 검증"));
    expect(onVerifyOff).toHaveBeenCalledWith(false);
    fireEvent.change(screen.getByLabelText("SNI 호스트 이름"), { target: { value: "h.example" } });
    expect(onTls).toHaveBeenLastCalledWith(expect.objectContaining({ sni: "h.example" }));
    fireEvent.change(screen.getByLabelText("고정 지문 1"), { target: { value: "abc" } });
    expect(onTls).toHaveBeenLastCalledWith(expect.objectContaining({ pinnedSha256: ["abc"] }));
    await userEvent.click(screen.getByRole("button", { name: "+ 지문" }));
    expect(onTls).toHaveBeenLastCalledWith(expect.objectContaining({ pinnedSha256: ["", ""] }));
    fireEvent.change(screen.getByLabelText("CA 묶음(PEM)"), { target: { value: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----" } });
    expect(onSecret).toHaveBeenCalledWith("CA_CERT", expect.stringContaining("BEGIN"));
    fireEvent.change(screen.getByLabelText("클라이언트 인증서(PEM) *"), { target: { value: "C" } });
    expect(onSecret).toHaveBeenCalledWith("CLIENT_CERT", "C");
    unmount();
    await renderRoute(<TlsSettingsBlock tls={{ minVersion: "1.2", sni: "", pinnedSha256: ["a"] }} onTls={vi.fn()} verifyOff={false} isDev secrets={{}} onSecret={vi.fn()} clientCert={false} readOnly />);
    expect(await screen.findByLabelText("고정 지문 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ 지문" })).toBeNull();
    expect(screen.queryByText("파일 올리기")).toBeNull();
  });
});

describe("DSC-09.06·09.08 MQTT 구독 폼의 TLS 탭과 토픽 템플릿", () => {
  it("mTLS는 TLS 탭의 인증서·키가 있어야 저장, 최소 버전·SNI가 connection.tls로, 디코더 탭 토픽 템플릿 적용", async () => {
    const initial = { ...emptyForm("MQTT_SUBSCRIBE", "mqtt"), code: "mq", name: "MQ", url: "ssl://b:8883", auth: "MTLS", decoderKey: "generic-json", decoderConfig: JSON.stringify({ deviceIdFrom: "$.id", metrics: [{ path: "$.t", key: "temperature" }] }), topics: [{ topic: "vendor/dev-1/up", qos: 1 }] };
    const { container } = await renderRoute(<SourceForm initial={initial} mode="create" models={[]} spaces={spaces} scripts={[]} testPath="/bff/api/core/sources/test" storedSecrets={[{ kind: "CA_CERT", configured: true, fingerprint: "••••caca" }]} cloned />, { session: meOf("INTEGRATOR") });
    const payload = () => JSON.parse((container.querySelector('input[name="payload"]') as HTMLInputElement).value) as Record<string, unknown>;
    expect(await screen.findByText(/복제한 소스입니다/)).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "설정 탭" });
    await userEvent.click(within(nav).getByRole("button", { name: /^인증/ }));
    expect(screen.getByText("클라이언트 인증서·키는 TLS 탭에서 넣습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeDisabled();
    await userEvent.click(within(nav).getByRole("button", { name: /^TLS/ }));
    expect(screen.getByText(/저장됨 ••••caca/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("클라이언트 인증서(PEM) *"), { target: { value: "CERT" } });
    fireEvent.change(screen.getByLabelText("클라이언트 개인 키(PEM) *"), { target: { value: "KEY" } });
    await userEvent.selectOptions(screen.getByLabelText("최소 TLS 버전"), "1.3");
    expect(payload()).toMatchObject({ tls: { minVersion: "1.3" }, tlsSecrets: { CLIENT_CERT: "CERT", CLIENT_KEY: "KEY" } });
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeEnabled();
    await userEvent.click(within(nav).getByRole("button", { name: /^디코더/ }));
    expect(screen.getByLabelText("표본 토픽")).toHaveValue("vendor/dev-1/up");
    fireEvent.change(screen.getByLabelText("템플릿"), { target: { value: "vendor/{deviceId}/up" } });
    await userEvent.click(screen.getByRole("button", { name: "디코더에 적용" }));
    expect(JSON.parse(String(payload().decoderConfig)).deviceIdFrom).toBe("topic[1]");
  });
});
