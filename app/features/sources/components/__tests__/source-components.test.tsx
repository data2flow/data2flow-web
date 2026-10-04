/**
 * 데이터 소스 화면 부품(client): 설정 폼(UI-DSC-02/08), 연결 테스트 패널(UI-DSC-09), 매핑 편집기, 실시간 메시지(UI-DSC-03),
 * 상태 버튼(DSC-07.01), 커넥터 카탈로그(UI-DSC-07), 기기 자격증명(UI-DSC-06).
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../../test/render";
import type { EventSourceLike } from "~/lib/event-stream";
import { DeviceCredentialsPanel, publishExample } from "../../device-credentials";
import { emptyForm, type SourceFormValues } from "../../model/source";
import { BASIC_CONNECTORS } from "../../model/catalog";
import { ConnectorCatalog } from "../catalog";
import { IngestTabs, Sparkline } from "../common";
import { ConnectionTestPanel } from "../connection-test-panel";
import { LifecycleActions } from "../lifecycle-actions";
import { LiveMessages, liveMessagesUrl } from "../live-messages";
import { MappingEditor } from "../mapping-editor";
import { SourceForm } from "../source-form";
import { useSourceStates } from "../source-state-live";
import { StateBadge } from "../common";

afterEach(() => vi.unstubAllGlobals());

const spaces = [{ id: "1", type: "SITE", name: "광주캠퍼스", children: [{ id: "31", type: "ROOM", name: "실습실" }] }];
const models = [{ id: "11", code: "EM300-TH", name: "EM300-TH" }];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mqtt(patch: Partial<SourceFormValues> = {}): SourceFormValues {
  return { ...emptyForm("MQTT_SUBSCRIBE", "mqtt"), code: "academy", name: "아카데미", url: "wss://iot-data.java21.net:443/mqtt", topics: [{ topic: "application/+/device/+/event/up", qos: 1 }], ...patch };
}

async function renderForm(initial: SourceFormValues, extra: Partial<Parameters<typeof SourceForm>[0]> = {}) {
  const result = await renderRoute(<SourceForm initial={initial} mode="create" models={models} spaces={spaces} scripts={[{ id: "5", name: "ESP 디코더" }]} testPath="/bff/api/core/sources/test" idempotencyKey="k-1" {...extra} />, { session: meOf("INTEGRATOR") });
  await screen.findByRole("navigation", { name: "설정 탭" });
  return result;
}

describe("UI-DSC-02/08 소스 설정 폼", () => {
  it("TC-DSC-031 URL·토픽 형식 오류 문구, 토픽 20개에서 [+ 토픽] 비활성, client-id 미리 보기", async () => {
    await renderForm(mqtt());
    expect(await screen.findByText(/실제 접속 ID: data2flow-academy-prod-0, data2flow-academy-prod-1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "연결" }));
    const url = screen.getByLabelText("브로커 주소");
    await userEvent.clear(url);
    await userEvent.type(url, "http://x");
    expect(screen.getByText("브로커 주소 형식이 올바르지 않습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /^구독/ }));
    const topic = screen.getByLabelText("토픽 1");
    await userEvent.clear(topic);
    await userEvent.type(topic, "a/#/b");
    expect(screen.getByText("토픽 형식이 올바르지 않습니다")).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "+ 토픽" });
    for (let i = 0; i < 19; i++) await userEvent.click(add);
    expect(screen.getAllByLabelText(/^토픽 \d+$/)).toHaveLength(20);
    expect(add).toBeDisabled();
    expect(screen.getAllByText("토픽은 20개까지 넣을 수 있습니다").length).toBeGreaterThan(0);
  });

  it("TC-DSC-234 오류가 있는 탭에 빨간 점, TC-DSC-030 QoS 0 토픽은 \"유실 가능\" 배지", async () => {
    await renderForm(mqtt({ url: "bad", topics: [{ topic: "a", qos: 0 }] }), { mode: "edit", secretConfigured: true, baseVersion: 3 });
    const tabs = screen.getByRole("navigation", { name: "설정 탭" });
    expect(within(tabs).getByRole("button", { name: /연결/ }).querySelector('[aria-label="오류 있음"]')).not.toBeNull();
    expect(within(tabs).getByRole("button", { name: /^기본/ }).querySelector('[aria-label="오류 있음"]')).toBeNull();
    expect(screen.getByText("유실 가능")).toBeInTheDocument();
    expect(document.querySelector('input[name="baseVersion"]')).toHaveValue("3");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("TC-DSC-267 MQTT 3.1.1이면 5.0 전용 필드 비활성, 공유 구독 그룹 → 실제 토픽 $share/{group}/…", async () => {
    await renderForm(mqtt());
    await userEvent.click(screen.getByRole("button", { name: "연결" }));
    await userEvent.selectOptions(screen.getByLabelText("프로토콜 버전"), "3.1.1");
    expect(screen.getByLabelText("세션 만료(초)")).toBeDisabled();
    expect(screen.getByLabelText("receive maximum")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /^구독/ }));
    await userEvent.type(screen.getByLabelText("공유 구독 그룹(선택)"), "g1");
    expect(screen.getByText("실제 토픽: $share/g1/application/+/device/+/event/up")).toBeInTheDocument();
  });

  it("TC-DSC-053 정책: 자동 등록 한도 0~10,000, 무수신 60~86,400을 벗어나면 저장이 막히고, 기본 모델·공간은 payload에 들어간다", async () => {
    await renderForm(mqtt());
    await userEvent.click(screen.getByRole("button", { name: "정책" }));
    await userEvent.selectOptions(screen.getByLabelText("기본 기기 모델"), "11");
    await userEvent.selectOptions(screen.getByLabelText("기본 공간"), "31");
    const payload = () => JSON.parse((document.querySelector('input[name="payload"]') as HTMLInputElement).value) as SourceFormValues;
    expect(payload()).toMatchObject({ defaultModelId: "11", defaultSpaceId: "31" });
    const limit = screen.getByLabelText("시간당 자동 등록 한도(0~10,000)");
    await userEvent.clear(limit);
    await userEvent.type(limit, "10001");
    expect(screen.getByText("0~10,000 사이로 입력하세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초안으로 저장" })).toBeDisabled();
    await userEvent.clear(limit);
    await userEvent.type(limit, "100");
    const noData = screen.getByLabelText("무수신 알람 기준(초, 60~86,400)");
    await userEvent.clear(noData);
    await userEvent.type(noData, "59");
    expect(screen.getByText("60~86,400초 사이로 입력하세요")).toBeInTheDocument();
  });

  it("인증 방식별 필드, 저장된 비밀값은 지문과 '비우면 유지', 디코더 스크립트 선택, TLS 검증 끄기 경고", async () => {
    await renderForm(mqtt({ auth: "USERPASS" }), { mode: "edit", secretConfigured: true, secretFingerprint: "••••a1b2" });
    await userEvent.click(screen.getByRole("button", { name: /^인증/ }));
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute("placeholder", "••••a1b2");
    expect(screen.getByText("비우면 기존 값을 유지합니다")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("인증 방식"), "HEADER");
    expect(screen.getByLabelText("헤더 이름")).toHaveValue("Authorization");
    await userEvent.click(screen.getByRole("button", { name: "연결" }));
    await userEvent.click(screen.getByLabelText("TLS 인증서 검증 끄기"));
    expect(screen.getByText(/중간자 공격/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("영속 세션(clean start 끔)"));
    await userEvent.click(screen.getByRole("button", { name: "디코더" }));
    await userEvent.selectOptions(screen.getByLabelText("디코더"), "script");
    expect(screen.getByText("스크립트를 선택하세요")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("DECODE 스크립트"), "5");
    expect(screen.queryByText("스크립트를 선택하세요")).toBeNull();
  });

  it("TC-DSC-045 generic-json을 고르면 매핑 편집기가 열리고 미리 보기가 바로 바뀐다, 경로 오류 문구", async () => {
    await renderForm(mqtt());
    await userEvent.click(screen.getByRole("button", { name: "디코더" }));
    await userEvent.selectOptions(screen.getByLabelText("디코더"), "generic-json");
    expect(await screen.findByText("generic-json 매핑")).toBeInTheDocument();
    const path = screen.getByLabelText("경로 1");
    await userEvent.clear(path);
    await userEvent.type(path, "$..x");
    expect(screen.getByText("경로 문법이 올바르지 않습니다: 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초안으로 저장" })).toBeDisabled();
  });

  it("TC-DSC-093 연결 테스트 중에는 저장이 비활성, 결과 패널 표시, 결과는 저장 payload에 들어가지 않는다", async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    await renderForm(mqtt());
    const before = (document.querySelector('input[name="payload"]') as HTMLInputElement).value;
    await userEvent.click(screen.getByRole("button", { name: "연결 테스트" }));
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeDisabled();
    // BR-DSC-07·API-DSC-57: 기본 15초, 쿼리 timeoutSec(5~30)
    expect(screen.getByText("연결 테스트 중… (최대 15초)")).toBeInTheDocument();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/bff/api/core/sources/test?timeoutSec=15");
    expect(JSON.parse(String(init.body))).toMatchObject({ code: "academy", connection: { url: "wss://iot-data.java21.net:443/mqtt" } });
    await act(async () => release(json({ header: { resultCode: "SUCCESS" }, response: { steps: [{ name: "DNS", status: "OK", ms: 12 }, { name: "SUBSCRIBE", status: "OK", ms: 9 }], preview: [{ at: "x", topic: "t/1", size: 412, rawExcerpt: "{}" }] } })));
    expect(await screen.findByText("모든 단계 성공, 메시지 1건 수신")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장 후 활성화" })).toBeEnabled();
    expect((document.querySelector('input[name="payload"]') as HTMLInputElement).value).toBe(before);
  });

  it("연결 테스트 제한 시간 입력은 5~30초로 묶어 쿼리로 보낸다, 토픽 한도는 조직 값(API-DSC-71)", async () => {
    const fetchMock = vi.fn(async () => json({ header: { resultCode: "SUCCESS" }, response: { ok: false, stage: "AUTH", steps: [{ name: "AUTH", status: "FAILED" }], preview: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    await renderForm(mqtt(), { maxTopics: 1 });
    const timeout = screen.getByLabelText("제한 시간(초)");
    await userEvent.clear(timeout);
    await userEvent.type(timeout, "99");
    await userEvent.click(screen.getByRole("button", { name: "연결 테스트" }));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/bff/api/core/sources/test?timeoutSec=30");
    expect(await screen.findByText(/연결 테스트에 실패했습니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "구독" }));
    expect(screen.getByText("토픽 1/1")).toBeInTheDocument();
    expect(screen.getByText("토픽은 1개까지 넣을 수 있습니다")).toBeInTheDocument();
  });

  it("연결 테스트 오류 응답은 문구로, 읽기 전용이면 입력 비활성·저장 버튼 없음·서버 오류 표시", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ header: { resultCode: "SOURCE_CONFIG_INVALID", resultMessage: "" } }, 400)));
    const { unmount } = await renderForm(mqtt());
    await userEvent.click(screen.getByRole("button", { name: "연결 테스트" }));
    expect(await screen.findByText("소스 설정이 올바르지 않습니다.")).toBeInTheDocument();
    unmount();
    await renderForm(mqtt(), { readOnly: true, mode: "edit", serverError: { code: "VERSION_CONFLICT" } });
    expect(screen.getByText(/읽기 전용입니다/)).toBeInTheDocument();
    expect(screen.getByText(/다른 사용자가 먼저 수정했습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(screen.getByLabelText("이름")).toBeDisabled();
  });

  it("플랫폼 브로커·가상 환경 폼은 유형에 맞는 연결 필드만(TC-DSC-015)", async () => {
    const { unmount } = await renderForm({ ...emptyForm("PLATFORM_BROKER", "platform-broker"), code: "esp", name: "ESP" });
    await userEvent.click(screen.getByRole("button", { name: "연결" }));
    expect(screen.getByLabelText("기기 키 패턴")).toHaveValue("{externalId}");
    expect(screen.queryByLabelText("브로커 주소")).toBeNull();
    expect(screen.queryByRole("button", { name: "인증" })).toBeNull();
    unmount();
    await renderForm({ ...emptyForm("SIMULATION", "simulation"), code: "sim", name: "SIM" });
    await userEvent.click(screen.getByRole("button", { name: "연결" }));
    expect(screen.getByLabelText("시나리오 ID(선택)")).toBeInTheDocument();
  });
});

describe("UI-DSC-09 연결 테스트 패널", () => {
  it("TC-DSC-091 TLS 실패 단계에 원인 코드와 인증서 체인, TC-DSC-268 부분 성공 안내, 미리보기 펼침", async () => {
    const retry = vi.fn();
    const { rerender } = await renderRoute(
      <ConnectionTestPanel testing={false} onRetry={retry} result={{ steps: [{ name: "DNS", status: "OK", ms: 12 }, { name: "TLS", status: "FAILED", ms: 40, code: "TLS_UNTRUSTED_CA", detail: "self-signed", tlsChain: [{ subject: "CN=x", issuer: "CN=x", notAfter: "2027-01-01" }] }], preview: [] }} />,
    );
    expect(await screen.findByText("TLS_UNTRUSTED_CA")).toBeInTheDocument();
    expect(screen.getByText(/연결 테스트에 실패했습니다/)).toBeInTheDocument();
    // TLS 실패 시 체인은 [서버 인증서 체인 보기]로 펼친다(TC-DSC-278)
    expect(screen.queryByText("인증서: CN=x · 발급자 CN=x · 만료 2027-01-01")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "서버 인증서 체인 보기" }));
    expect(screen.getByText("인증서: CN=x · 발급자 CN=x · 만료 2027-01-01")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 테스트" }));
    expect(retry).toHaveBeenCalled();
    rerender(<ConnectionTestPanel testing={false} result={{ steps: [{ name: "SUBSCRIBE", status: "OK" }], preview: [], lossPossible: true }} />);
    expect(await screen.findByText(/부분 성공: 구독은 성공했지만 메시지가 없습니다. 토픽과 QoS를 확인하세요/)).toBeInTheDocument();
    expect(screen.getByText(/QoS 0/)).toBeInTheDocument();
  });

  it("TC-DSC-092 미리보기 메시지 최대 10건, 펼치면 원문과 디코딩 결과", async () => {
    const preview = Array.from({ length: 12 }, (_, i) => ({ at: "x", topic: `t/${i}`, size: 10 + i, rawExcerpt: `{"n":${i}}`, decoded: i === 0 ? { externalId: "24e1", metrics: [{ key: "temperature", value: 22.3, unit: "℃" }] } : null }));
    await renderRoute(<ConnectionTestPanel testing={false} result={{ steps: [{ name: "SUBSCRIBE", status: "OK" }], preview }} />);
    expect(await screen.findByText("미리보기 (10/10)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(10);
    expect(screen.getByText("→ 24e1 · temperature 22.3℃")).toBeInTheDocument();
    await userEvent.click(screen.getByText("t/1"));
    expect(screen.getByText('{"n":1}')).toBeInTheDocument();
    expect(screen.getByText("디코딩 결과 없음")).toBeInTheDocument();
  });

  it("대기·진행 중·오류 상태", async () => {
    const { rerender } = await renderRoute(<ConnectionTestPanel testing={false} result={null} />);
    expect(await screen.findByText(/결과는 저장하지 않습니다/)).toBeInTheDocument();
    rerender(<ConnectionTestPanel testing result={null} />);
    expect(screen.getByText("연결 테스트 중… (최대 15초)")).toBeInTheDocument();
    rerender(<ConnectionTestPanel testing result={null} timeoutSec={30} />);
    expect(screen.getByText("연결 테스트 중… (최대 30초)")).toBeInTheDocument();
    rerender(<ConnectionTestPanel testing={false} result={null} error="오류" />);
    expect(screen.getByText("오류")).toBeInTheDocument();
  });
});

describe("generic-json 매핑 편집기", () => {
  it("측정 항목 추가·제거, 중복 키 오류, 잘못된 테스트 JSON, 읽기 전용", async () => {
    const onChange = vi.fn();
    const { unmount } = await renderRoute(<MappingEditor value='{"deviceIdFrom":"topic[1]","metrics":[{"path":"$.temp","key":"temperature"}]}' onChange={onChange} />);
    expect(await screen.findByText("temperature = 22.4")).toBeInTheDocument();
    expect(screen.getByText("esp-01")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ 측정 항목" }));
    await userEvent.type(screen.getByLabelText("키 2"), "temperature");
    expect(screen.getByText("같은 측정 항목 키를 두 번 매핑했습니다: temperature")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(expect.any(String), false);
    await userEvent.click(screen.getAllByRole("button", { name: "제거" })[1]);
    expect(onChange).toHaveBeenLastCalledWith(expect.any(String), true);
    const payload = screen.getByLabelText("테스트 메시지(JSON)");
    await userEvent.clear(payload);
    await userEvent.type(payload, "x");
    expect(screen.getByText("JSON 형식이 올바르지 않습니다")).toBeInTheDocument();
    const id = screen.getByLabelText("기기 ID 위치");
    await userEvent.clear(id);
    expect(screen.getByText("필수 항목입니다")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "제거" }));
    expect(screen.getAllByText("필수 항목입니다").length).toBe(2);
    unmount();
    await renderRoute(<MappingEditor value="{}" readOnly onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "+ 측정 항목" })).toBeNull();
  });
});

class FakeSource implements EventSourceLike {
  static last: FakeSource | undefined;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeSource.last = this;
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent);
  }
}

describe("DSC-02.06 실시간 원본 메시지", () => {
  const message = (i: number) => ({ receivedAt: "2026-10-03T00:00:00Z", topic: `application/1/device/${i}/event/up`, sizeBytes: 412, payload: `{"n":${i}}`, decoded: i === 0 ? { temperature: 22.3 } : undefined });

  it("TC-DSC-100 토픽 필터가 구독 쿼리를 바꾸고, 초당 10건 초과는 \"n건 생략\", 일시정지·계속, 펼침·복사(TC-DSC-046)", async () => {
    let now = 0;
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const options = { createSource: (url: string) => new FakeSource(url), checkSession: async () => true };
    await renderRoute(<LiveMessages sourceId="7" timezone="Asia/Seoul" now={() => now} streamOptions={options} />);
    await waitFor(() => expect(FakeSource.last?.url).toBe("/bff/stream/sources/7/live"));
    expect(screen.getByText("아직 받은 메시지가 없습니다")).toBeInTheDocument();
    act(() => {
      for (let i = 0; i < 12; i++) FakeSource.last!.emit("message", message(i));
    });
    expect(screen.getAllByText(/application\/1\/device/)).toHaveLength(10);
    expect(screen.getByText("2건 생략")).toBeInTheDocument();
    act(() => FakeSource.last!.emit("dropped", { count: 3 }));
    expect(screen.getByText("5건 생략")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "일시정지" }));
    now = 2000;
    act(() => FakeSource.last!.emit("message", message(20)));
    expect(screen.getByText("일시정지 중 1건 대기")).toBeInTheDocument();
    expect(screen.queryByText("application/1/device/20/event/up")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "계속" }));
    expect(screen.getByText("application/1/device/20/event/up")).toBeInTheDocument();
    await userEvent.click(screen.getByText("application/1/device/0/event/up"));
    expect(screen.getByText(/"temperature": 22.3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "복사" }));
    expect(writeText).toHaveBeenCalledWith('{"n":0}');
    expect(await screen.findByText("복사했습니다.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("토픽 필터"), "application/#");
    await userEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(FakeSource.last?.url).toBe(liveMessagesUrl("7", "application/#")));
    expect(FakeSource.last?.url).toBe("/bff/stream/sources/7/live?topicFilter=application%2F%23");
  });

  it("디코딩 결과가 없으면 안내, 복사 실패는 조용히", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("x"))) } });
    FakeSource.last = undefined;
    await renderRoute(<LiveMessages sourceId="7" timezone="UTC" streamOptions={{ createSource: (u) => new FakeSource(u), checkSession: async () => true }} />);
    await waitFor(() => expect(FakeSource.last).toBeDefined());
    act(() => FakeSource.last!.emit("message", { receivedAt: "2026-10-03T00:00:00Z", topic: "x/y", rawExcerpt: "not json", truncated: true }));
    await userEvent.click(await screen.findByText("x/y"));
    expect(screen.getByText("디코딩 미리 보기가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("잘림")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "복사" }));
    expect(screen.queryByText("복사했습니다.")).toBeNull();
  });
});

describe("DSC-07.01 TC-DSC-168 상태 버튼과 확인 대화상자", () => {
  it("[보관]은 코드를 그대로 입력해야 확인 버튼이 켜진다, 사용처 요약", async () => {
    await renderRoute(<LifecycleActions code="chirpstack-s3" lifecycle="ACTIVE" version={3} usage={{ deviceCount: 9, flows: [{ id: "1", name: "환기" }] }} />, { session: meOf("INTEGRATOR") });
    await userEvent.click(await screen.findByRole("button", { name: "보관" }));
    expect(screen.queryByRole("button", { name: "활성화" })).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "소스 보관" });
    expect(within(dialog).getByText("사용처: 기기 9대 · 플로우 1개")).toBeInTheDocument();
    expect(within(dialog).getByText("환기")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "보관" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/소스 코드 chirpstack-s3/), "chirpstack-s3");
    expect(confirm).toBeEnabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("DRAFT는 [활성화] 폼 버튼, [복제]는 코드 형식·이름이 있어야 켜진다", async () => {
    await renderRoute(<LifecycleActions code="sim-a" lifecycle="DRAFT" version={1} />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByRole("button", { name: "활성화" })).toHaveAttribute("value", "activate");
    await userEvent.click(screen.getByRole("button", { name: "복제" }));
    const dialog = screen.getByRole("dialog", { name: "소스 복제" });
    const submit = within(dialog).getByRole("button", { name: "복제" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("이름"), "복제본");
    expect(submit).toBeEnabled();
    const code = within(dialog).getByLabelText("코드");
    await userEvent.clear(code);
    await userEvent.type(code, "Bad");
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.getByRole("dialog", { name: "소스 삭제" })).toBeInTheDocument();
  });
});

describe("UI-DSC-07 커넥터 카탈로그", () => {
  const connectors = [...BASIC_CONNECTORS, { connectorKey: "kafka", name: "Apache Kafka", category: "QUEUE", standard: "Kafka 3", version: "3.7", transports: ["tcp"], authMethods: ["NONE", "SASL"], ackMode: "BEFORE_STORE", scaling: "SCALABLE", enabled: true }, { connectorKey: "bacnet-ip", name: "BACnet/IP", category: "BUILDING", transports: ["udp"], authMethods: [], enabled: false, disabledReason: "LICENSE" }];

  it("TC-DSC-017 분류 탭·검색 \"mqtt\"·결과 없음 문구, 사용 불가는 링크 없음, TC-DSC-233 카드 항목", async () => {
    await renderRoute(<ConnectorCatalog connectors={connectors} templates={[{ key: "chirpstack-v4", name: "ChirpStack v4", connectorKey: "mqtt" }]} catalogError />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText(/기본 유형으로 만들 수 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ChirpStack v4" })).toHaveAttribute("href", "/sources/new/mqtt?template=chirpstack-v4");
    expect(screen.getByText("사용 불가(라이선스)")).toBeInTheDocument();
    expect(screen.getByText("BACnet/IP").closest("a")).toBeNull();
    expect(screen.getByText("Kafka 3 · v3.7")).toBeInTheDocument();
    expect(screen.getByText("인증 2종 · SCALABLE")).toBeInTheDocument();
    expect(screen.getByText("Apache Kafka").closest("a")).toHaveAttribute("href", "/sources/new/kafka");
    await userEvent.click(screen.getByRole("tab", { name: "메시지 큐" }));
    expect(screen.queryByText("MQTT 3.1.1/5.0")).toBeNull();
    expect(screen.getByText("Apache Kafka")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "전체" }));
    await userEvent.type(screen.getByLabelText("커넥터 검색"), "mqtt");
    expect(screen.getByText("MQTT 3.1.1/5.0")).toBeInTheDocument();
    expect(screen.queryByText("Apache Kafka")).toBeNull();
    await userEvent.type(screen.getByLabelText("커넥터 검색"), "zzz");
    expect(screen.getByText("조건에 맞는 커넥터가 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "가상 환경" })).toHaveAttribute("href", "/sources/new/simulation");
    // M5: 유형 카드 7종 모두 만들 수 있다(나머지는 커넥터 스키마 폼)
    expect(screen.getByRole("link", { name: "OPC UA" })).toHaveAttribute("href", "/sources/new/opcua");
  });
});

describe("UI-DSC-06 플랫폼 브로커 자격증명", () => {
  function routes(state: { items: unknown[] }) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/bff/api/core/platform-broker") return json({ response: { wssUrl: "wss://iot-data.java21.net/mqtt", topicRules: ["devices/{deviceKey}/telemetry"] } });
      if (path.endsWith("/credentials") && method === "GET") return json({ response: state.items });
      if (path.endsWith("/credentials") && method === "POST") {
        state.items = [{ id: "c1", type: "PASSWORD", username: "dev-esp", status: "ACTIVE", expiresAt: null, lastUsedAt: null }];
        return json({ response: { credentialId: "c1", username: "dev-esp", password: "Pw-Once", signingKey: "sk-once" } }, 201);
      }
      if (path.endsWith("/revoke")) {
        state.items = [{ id: "c1", type: "PASSWORD", username: "dev-esp", status: "REVOKED" }];
        return json({ response: { status: "REVOKED" } });
      }
      return json({ header: { resultCode: "RESOURCE_NOT_FOUND" } }, 404);
    });
  }

  it("TC-DSC-113 [발급] 결과(비밀번호·서명 키·mosquitto_pub 예시)는 한 번만, 닫으면 사라짐, [폐기] 확인 후 REVOKED", async () => {
    const state = { items: [] as unknown[] };
    vi.stubGlobal("fetch", routes(state));
    await renderRoute(<DeviceCredentialsPanel deviceId="1060" externalId="esp-01" canAdmin timezone="Asia/Seoul" />, { session: meOf("INTEGRATOR") });
    expect(await screen.findByText("발급한 자격증명이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("devices/esp-01/telemetry")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "발급" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "발급" }));
    expect(await screen.findByText("Pw-Once")).toBeInTheDocument();
    expect(screen.getByText("sk-once")).toBeInTheDocument();
    expect(screen.getByText(/mosquitto_pub -L wss:\/\/iot-data.java21.net\/mqtt -u dev-esp/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "확인했습니다(닫기)" }));
    expect(screen.queryByText("Pw-Once")).toBeNull();
    expect(screen.getByText("만료 없음")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "폐기" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "폐기" }));
    expect(await screen.findByText("폐기됨")).toBeInTheDocument();
  });

  it("TC-DSC-112 INTEGRATOR 미만에게는 [발급]·[폐기]가 없고, 목록 오류는 문구로", async () => {
    vi.stubGlobal("fetch", routes({ items: [{ id: "c1", type: "PASSWORD", username: "dev-esp", status: "ACTIVE", expiresAt: "2027-01-01T00:00:00Z" }] }));
    const { unmount } = await renderRoute(<DeviceCredentialsPanel deviceId="1060" externalId="esp-01" canAdmin={false} timezone="UTC" />, { session: meOf("OPERATOR") });
    expect(await screen.findByText("dev-esp")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "발급" })).toBeNull();
    expect(screen.queryByRole("button", { name: "폐기" })).toBeNull();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => json({ header: { resultCode: "PERMISSION_DENIED" } }, 403)));
    await renderRoute(<DeviceCredentialsPanel deviceId="1" externalId="x" canAdmin={false} timezone="UTC" />);
    expect(await screen.findByText("이 작업을 할 권한이 없습니다.")).toBeInTheDocument();
  });

  it("예시 명령은 브로커 정보가 없어도 기본 주소", () => {
    expect(publishExample(null, { credentialId: "1", username: "u", password: "p" }, "t")).toContain("wss://iot-data.java21.net/mqtt");
  });
});

describe("수집 구역 탭·스파크라인", () => {
  it("권한 있는 구역만, 현재 구역 표시", async () => {
    await renderRoute(
      <>
        <IngestTabs current="sources" />
        <Sparkline values={[1, 2, 3]} label="spark" />
        <Sparkline values={null} label="none" />
      </>,
      { session: meOf("VIEWER") },
    );
    expect(await screen.findByRole("img", { name: "spark" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "데이터 소스" })).toBeNull();
    expect(screen.queryByRole("img", { name: "none" })).toBeNull();
  });

  it("OPERATOR에게는 네 구역", async () => {
    await renderRoute(<IngestTabs current="sources" />, { session: meOf("OPERATOR") });
    expect(await screen.findByRole("link", { name: "데이터 소스" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });
});

describe("DSC-02.01 연결 상태 실시간 반영(sources 토픽)", () => {
  function Probe({ enabled = true }: { enabled?: boolean }) {
    const { states } = useSourceStates(enabled, { createSource: (u) => new FakeSource(u), checkSession: async () => true });
    return <StateBadge state={states["7"] ?? "CONNECTED"} />;
  }

  it("TC-DSC-060 source-state 이벤트가 오면 다시 불러오지 않고 배지가 바로 바뀐다", async () => {
    FakeSource.last = undefined;
    await renderRoute(<Probe />);
    await waitFor(() => expect(FakeSource.last?.url).toBe("/bff/stream/live?topics=sources"));
    expect(screen.getByText("연결됨")).toBeInTheDocument();
    act(() => FakeSource.last!.emit("source-state", { sourceId: "7", state: "DISCONNECTED", previousState: "CONNECTED", at: "2026-10-04T00:00:00Z" }));
    expect(await screen.findByText("끊김")).toBeInTheDocument();
    act(() => FakeSource.last!.emit("source-state", { sourceId: "8", state: "ERROR" }));
    act(() => FakeSource.last!.emit("source-state", { sourceId: "7", state: "??" }));
    expect(screen.getByText("끊김")).toBeInTheDocument();
  });

  it("꺼져 있으면 연결하지 않는다", async () => {
    FakeSource.last = undefined;
    await renderRoute(<Probe enabled={false} />);
    expect(FakeSource.last).toBeUndefined();
  });
});
