/**
 * POST로 여는 스트리밍 응답(SSE 본문, `text/event-stream`)을 읽는 도우미. EventSource는 GET만 되므로
 * AI 해설(API-AIA-01)·도움말 대화(API-AIA-02)는 fetch 본문을 읽어 `event:`/`data:` 줄을 이벤트로 바꾼다.
 */
import { bffFetch } from "~/lib/bff-client";

export interface SseEvent {
  event: string;
  data: unknown;
}

function parseData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** 버퍼에서 완성된 이벤트(빈 줄로 끝남)를 떼어 낸다. 남은 조각은 rest */
export function takeEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0 || event !== "message") events.push({ event, data: parseData(data.join("\n")) });
  }
  return { events, rest };
}

export type StreamOutcome = { ok: true } | { ok: false; status: number; code: string; message: string; errors?: { field: string; code: string; message: string }[] };

/**
 * POST 스트림을 열고 이벤트마다 onEvent를 부른다. 서버가 스트림 대신 JSON 오류(409 AI_DISABLED, 429, 503 …)를 주면 실패로 돌려준다.
 * 스트림 안의 `error` 이벤트도 실패로 바꾼다.
 */
export async function postStream(path: string, body: unknown, onEvent: (event: SseEvent) => void, options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<StreamOutcome> {
  let response: Response;
  try {
    response = await bffFetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal: options.signal }, { fetchImpl: options.fetchImpl });
  } catch {
    return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE", message: "" };
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("text/event-stream") || !response.body) {
    const json = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; errors?: { field: string; code: string; message: string }[] } | null;
    return { ok: false, status: response.status, code: json?.header?.resultCode ?? (response.ok ? "SERVICE_UNAVAILABLE" : "UNKNOWN"), message: json?.header?.resultMessage ?? "", errors: json?.errors };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let failure: StreamOutcome | null = null;
  const handle = (events: SseEvent[]) => {
    for (const e of events) {
      if (e.event === "error") {
        const d = (e.data ?? {}) as { resultCode?: string; resultMessage?: string };
        failure = { ok: false, status: 200, code: d.resultCode ?? "UNKNOWN", message: d.resultMessage ?? "" };
      }
      onEvent(e);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = takeEvents(buffer);
    buffer = rest;
    handle(events);
  }
  if (buffer.trim()) handle(takeEvents(`${buffer}\n\n`).events);
  return failure ?? { ok: true };
}
