/**
 * 수집 모니터·실패 메시지 부품(UI-DSH-03, UI-ING-01, UI-ING-04): TC-DSH-021·025·026·027, TC-ING-090.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import type { EventSourceLike } from "~/lib/event-stream";
import { IngestAreaTabs } from "../area-tabs";
import { FailureItems, type FailureItem } from "../failure-items";
import { RawMessagePanel, ReprocessResultPanel, SelectionNotice } from "../failures-panels";
import { LiveMonitor } from "../live-monitor";
import { MessageStream } from "../message-stream";
import { PipelineDiagram } from "../pipeline-diagram";
import { SummaryCards } from "../summary-cards";

class FakeEventSource implements EventSourceLike {
  static all: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(l);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data: JSON.stringify(data), lastEventId: "" } as MessageEvent);
  }
}
const live = { createSource: (url: string) => new FakeEventSource(url), checkSession: async () => true };
const last = () => FakeEventSource.all[FakeEventSource.all.length - 1];

afterEach(() => {
  FakeEventSource.all = [];
  vi.useRealTimers();
});

const stages = [
  { key: "SOURCE", inPerMin: 14, failPerMin: 0 },
  { key: "DECODE", inPerMin: 14, failPerMin: 0 },
  { key: "SCRIPT", inPerMin: 14, failPerMin: 12, latencyP95Ms: 1 },
];

describe("DSH-03.01 흐름 다이어그램", () => {
  it("TC-DSH-021 실패 단계 강조와 '실패 12/분', 누르면 SCRIPT_ERROR 실패 목록", async () => {
    await renderRoute(<PipelineDiagram stages={stages} />);
    const script = await screen.findByRole("link", { name: "스크립트 단계 실패 메시지 보기" });
    expect(script).toHaveAttribute("href", "/ingest/failures?stage=SCRIPT&code=SCRIPT_ERROR");
    expect(script).toHaveClass("border-bad");
    expect(within(script).getByText("실패 12/분")).toBeInTheDocument();
    expect(screen.getAllByText("실패 없음")).toHaveLength(5);
    // 소스·검증 단계는 실패 보관함이 없어 링크가 아니다
    expect(screen.queryByRole("link", { name: "소스 단계 실패 메시지 보기" })).toBeNull();
  });

  it("TC-DSH-021 실시간 ingest-stats로 5초마다 갱신되고 '갱신 n초 전'이 늘어난다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let now = Date.parse("2026-10-04T00:00:00Z");
    const clock = () => now;
    await renderRoute(
      <LiveMonitor initial={{ stages, sources: [{ id: "7", name: "ChirpStack s3", state: "CONNECTED", perMin: 11.9, lastMessageAt: "2026-10-03T23:59:48Z" }] }} counts={[{ sourceId: "7", name: "ChirpStack s3", type: "MQTT_SUBSCRIBE", counts: { OK: 712, DUPLICATE: 31 } }]} loadedAt={now} now={clock} live={live} />,
    );
    expect(await screen.findByText("갱신 0초 전")).toBeInTheDocument();
    await waitFor(() => expect(last()?.url).toBe(`/bff/stream/live?topics=ingest`));
    expect(screen.getByText("712")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ChirpStack s3" })).toHaveAttribute("href", "/sources/7");
    now += 3000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("갱신 3초 전")).toBeInTheDocument();
    act(() => last().emit("ingest-stats", { stages: [{ key: "SCRIPT", inPerMin: 20, failPerMin: 0 }], sources: [{ id: "7", name: "ChirpStack s3", state: "DISCONNECTED", perMin: 0 }] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("갱신 0초 전")).toBeInTheDocument();
    expect(screen.queryByText("실패 12/분")).toBeNull();
    expect(screen.getByText("DISCONNECTED")).toBeInTheDocument();
  });
});

describe("UI-ING-01 요약 카드", () => {
  it("값과 경고 띠(원인 후보), 요약이 없으면 –", async () => {
    const { unmount } = await renderRoute(<SummaryCards summary={{ perMinute: 12.4, latencyP95Ms: 420, streamLagSec: 3, heartbeat: { totalMs: 2100 }, failuresToday: 7, alerts: [{ level: "WARNING", code: "HEARTBEAT_DELAYED", message: "하트비트 지연", causeHints: ["flow"] }] }} />);
    expect(await screen.findByText("0.42s")).toBeInTheDocument();
    expect(screen.getByText("2.1s")).toBeInTheDocument();
    expect(document.querySelector('[data-card="heartbeat"]')).toHaveAttribute("data-tone", "warn");
    expect(screen.getByText(/원인 후보: flow/)).toBeInTheDocument();
    unmount();
    await renderRoute(<SummaryCards summary={null} />);
    expect((await screen.findAllByText("–")).length).toBe(5);
  });
});

describe("DSH-03.03 메시지 스트림", () => {
  const sources = [{ id: "7", name: "ChirpStack s3" }];
  const msg = (i: number, extra: Record<string, unknown> = {}) => ({ receivedAt: "2026-10-04T00:00:00Z", sourceId: "7", topic: `application/1/device/${i}/event/up`, deviceId: String(i), result: "OK", canonical: { v: 1, i }, ...extra });

  it("TC-DSH-026 일시정지하면 목록 고정과 'N건 대기', 재개하면 반영", async () => {
    await renderRoute(<MessageStream sources={sources} timezone="Asia/Seoul" live={live} />);
    await waitFor(() => expect(last()).toBeDefined());
    act(() => {
      for (let i = 0; i < 3; i++) last().emit("message", msg(i));
    });
    expect(screen.getAllByText("ChirpStack s3", { selector: "td" })).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "일시정지" }));
    act(() => {
      for (let i = 3; i < 33; i++) last().emit("message", msg(i));
    });
    expect(screen.getByText("일시정지 중 30건 대기")).toBeInTheDocument();
    expect(screen.getAllByText("ChirpStack s3", { selector: "td" })).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "계속" }));
    expect(screen.getAllByText("ChirpStack s3", { selector: "td" })).toHaveLength(33);
  });

  it("TC-DSH-027 필터가 SSE 토픽 쿼리에 반영되고, 행을 펼치면 원본과 표준 메시지를 나란히(원본 권한 없으면 안내)", async () => {
    await renderRoute(<MessageStream sources={sources} timezone="Asia/Seoul" live={live} />);
    await waitFor(() => expect(last()?.url).toBe(`/bff/stream/live?topics=${encodeURIComponent("ingest-messages?sourceId=&deviceId=&result=")}`));
    await userEvent.selectOptions(screen.getByLabelText("소스"), "7");
    await userEvent.selectOptions(screen.getByLabelText("처리 결과"), "SCRIPT_ERROR");
    await userEvent.type(screen.getByLabelText("기기"), "1042{Enter}");
    await waitFor(() => expect(decodeURIComponent(last().url)).toBe("/bff/stream/live?topics=ingest-messages?sourceId=7&deviceId=1042&result=SCRIPT_ERROR"));
    act(() => {
      last().emit("message", msg(1, { result: "SCRIPT_ERROR", raw: '{"temp":1}' }));
      last().emit("message", msg(2));
      last().emit("message", "not-an-object");
    });
    const [first, second] = screen.getAllByRole("button", { name: "펼치기" });
    await userEvent.click(first);
    expect(screen.getByLabelText("표준 메시지")).toHaveTextContent('"i": 2');
    expect(screen.getByText("원본 권한 없음")).toBeInTheDocument();
    await userEvent.click(second);
    expect(screen.getByLabelText("원본")).toHaveTextContent('"temp": 1');
    await userEvent.click(screen.getByRole("button", { name: "접기" }));
    expect(screen.queryByLabelText("원본")).toBeNull();
  });
});

const items: FailureItem[] = [
  { id: "500", rawMessageId: "8812300", stage: "DECODE", errorCode: "ING_EXTERNAL_ID_MISSING", errorMessage: "externalId 없음", attempts: 1, status: "OPEN", sourceName: "ChirpStack s3", createdAt: "2026-10-03T14:10:00Z" },
  { id: "501", stage: "DECODE", errorCode: "ING_EXTERNAL_ID_MISSING", attempts: 1, status: "OPEN", lockedBy: "kim.op", deviceName: "AM107-067999", createdAt: "2026-10-03T14:11:00Z" },
  { id: "502", stage: "DECODE", errorCode: "ING_EXTERNAL_ID_MISSING", attempts: 1, status: "RESOLVED", createdAt: "2026-10-03T14:12:00Z" },
];

describe("ING-07.03 실패 메시지 목록", () => {
  it("TC-ING-090 선택 수에 따라 버튼이 켜지고, 폐기 대화상자는 사유 2자 이상이어야 제출된다", async () => {
    await renderRoute(<FailureItems items={items} canReprocess timezone="Asia/Seoul" idempotencyKey="k" />, { session: meOf("INTEGRATOR") });
    const reprocess = await screen.findByRole("button", { name: "선택 재처리" });
    expect(reprocess).toBeDisabled();
    expect(screen.getByLabelText("502 선택")).toBeDisabled();
    expect(screen.getAllByText("(식별 불가)")).toHaveLength(2);
    expect(screen.getByText("다른 사용자가 처리 중")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("모두 선택"));
    expect(screen.getByText("2개 선택")).toBeInTheDocument();
    expect(reprocess).toBeEnabled();
    expect(document.querySelectorAll('input[name="dlqItemId"]')).toHaveLength(2);
    await userEvent.click(screen.getByLabelText("500 선택"));
    expect(screen.getByText("1개 선택")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("모두 선택"));
    await userEvent.click(screen.getByLabelText("모두 선택"));
    expect(screen.getByText("0개 선택")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("500 선택"));
    await userEvent.click(screen.getByRole("button", { name: "폐기" }));
    const dialog = screen.getByRole("dialog", { name: "실패 메시지 폐기" });
    await userEvent.type(within(dialog).getByLabelText("폐기 사유"), "x");
    await userEvent.click(within(dialog).getByRole("button", { name: "1건 폐기" }));
    expect(within(dialog).getByText("폐기 사유를 입력하세요")).toBeInTheDocument();
  });

  it("권한이 없으면 선택·버튼이 없고, 시각을 누르면 원본 상세 패널", async () => {
    const load = vi.fn(async () => ({ ok: true as const, status: 200, data: { id: "8812300", receivedAt: "2026-10-03T14:10:00Z", topic: "devices/x", status: "DECODE_ERROR", errorCode: "ING_EXTERNAL_ID_MISSING", trace: [{ stage: "DECODE", ok: false, ms: 1 }], canonical: null, stored: [{ metricKey: "temperature", value: 22, unit: "℃", quality: 1 }] } }));
    await renderRoute(<FailureItems items={items} canReprocess={false} timezone="Asia/Seoul" idempotencyKey="k" loadRaw={load} />);
    expect(screen.queryByRole("button", { name: "선택 재처리" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "2026-10-03 23:10:00" }));
    expect(await screen.findByText("원본 메시지 8812300")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("8812300");
    expect(screen.getByText("원본 권한 없음")).toBeInTheDocument();
    expect(screen.getByText("22℃")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByText("원본 메시지 8812300")).toBeNull();
  });

  it("원본 상세: payload가 있으면 보이고, 실패하면 오류 문구", async () => {
    const { unmount } = await renderRoute(<RawMessagePanel rawMessageId="1" timezone="UTC" onClose={() => {}} load={async () => ({ ok: true, status: 200, data: { id: "1", payload: '{"a":1}', canonical: { v: 1 } } })} />);
    expect(await screen.findByText('{"a":1}')).toBeInTheDocument();
    unmount();
    await renderRoute(<RawMessagePanel rawMessageId="2" timezone="UTC" onClose={() => {}} load={async () => ({ ok: false, status: 404, code: "ING_RAW_MESSAGE_NOT_FOUND", message: "" })} />);
    expect(await screen.findByText("원본 메시지를 찾을 수 없습니다.")).toBeInTheDocument();
  });

  it("재처리 결과 패널과 5,000건 초과 안내", async () => {
    await renderRoute(
      <>
        <ReprocessResultPanel result={{ results: [{ id: "500", outcome: "RESOLVED" }, { id: "501", outcome: "LOCKED", errorCode: "ING_DLQ_ITEM_LOCKED" }, { id: "503", outcome: "SAME_ERROR", errorCode: "X" }] }} />
        <SelectionNotice count={5001} />
      </>,
    );
    expect(await screen.findByText("재처리 결과")).toBeInTheDocument();
    expect(screen.getByText("ING_DLQ_ITEM_LOCKED")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("한 번에 최대 5,000건까지 재처리할 수 있습니다");
  });
});

describe("수집 구역 탭", () => {
  it("모니터·소스·스크립트·실패 메시지", async () => {
    await renderRoute(<IngestAreaTabs current="failures" />);
    expect(await screen.findByRole("link", { name: "실패 메시지" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "데이터 소스" })).toHaveAttribute("href", "/sources");
    expect(screen.getByRole("link", { name: "스크립트" })).toHaveAttribute("href", "/scripts");
  });
});
