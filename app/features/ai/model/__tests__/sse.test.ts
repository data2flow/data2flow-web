/**
 * POST 스트림 읽기(API-AIA-01·02 SSE 본문) 단위 시험.
 */
import { describe, expect, it, vi } from "vitest";
import { postStream, takeEvents, type SseEvent } from "../sse";

function sseResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream;charset=UTF-8" } });
}

describe("AIA-01.01 스트림 이벤트 읽기", () => {
  it("빈 줄로 끝난 이벤트만 떼고, 주석·여러 data 줄·JSON 아닌 값을 다룬다", () => {
    const { events, rest } = takeEvents(': ping\n\nevent: delta\ndata: {"text":"가"}\n\nevent: done\r\ndata: a\r\ndata: b\r\n\r\nevent: delta\ndata: {"te');
    expect(events).toEqual([
      { event: "delta", data: { text: "가" } },
      { event: "done", data: "a\nb" },
    ]);
    expect(rest).toBe('event: delta\ndata: {"te');
  });

  it("조각난 청크를 이어 붙여 이벤트를 차례로 넘기고 성공을 돌려준다", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['event: delta\ndata: {"text":"최근 "}\n', '\nevent: verification\ndata: {"status":"VERIFIED"}\n\n', 'event: done\ndata: {"commentaryId":"9"}']));
    const seen: SseEvent[] = [];
    const outcome = await postStream("/bff/api/ai/commentaries", { subjectId: "1" }, (e) => seen.push(e), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome).toEqual({ ok: true });
    expect(seen.map((e) => e.event)).toEqual(["delta", "verification", "done"]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("accept")).toBe("text/event-stream");
    expect(init.method).toBe("POST");
  });

  it("스트림 대신 JSON 오류(409 AI_DISABLED·503)면 코드와 함께 실패", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ header: { isSuccessful: false, resultCode: "AI_PROVIDER_UNAVAILABLE", resultMessage: "x" } }), { status: 503, headers: { "Content-Type": "application/json" } }));
    expect(await postStream("/p", {}, () => {}, { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, status: 503, code: "AI_PROVIDER_UNAVAILABLE", message: "x", errors: undefined });
  });

  it("스트림 안의 error 이벤트는 실패로, 네트워크 오류는 SERVICE_UNAVAILABLE", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['event: error\ndata: {"resultCode":"AI_QUOTA_EXCEEDED","resultMessage":"한도"}\n\n']));
    expect(await postStream("/p", {}, () => {}, { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ ok: false, code: "AI_QUOTA_EXCEEDED" });
    const broken = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await postStream("/p", {}, () => {}, { fetchImpl: broken as unknown as typeof fetch })).toMatchObject({ ok: false, code: "SERVICE_UNAVAILABLE" });
  });
});
