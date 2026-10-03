/**
 * 소스 연결 상태 실시간 갱신(DSC-02.01 "상태가 바뀌면 5초 이내에 화면에 반영", API-DSH-20 `sources` 토픽 → `source-state`).
 * 목록·상세가 함께 쓴다. 권한(SRC_READ)이 없으면 서버가 토픽을 거절하고 이벤트가 오지 않을 뿐 화면은 그대로다.
 */
import { useCallback, useState } from "react";
import { useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { liveUrl, type StreamEvent, type StreamStatus } from "~/lib/event-stream";
import { parseSourceStateEvent } from "../model/source";

/** sourceId → 최근 실시간 상태 */
export function useSourceStates(enabled = true, options: UseLiveStreamOptions = {}): { states: Record<string, string>; status: StreamStatus } {
  const [states, setStates] = useState<Record<string, string>>({});
  const onEvent = useCallback((event: StreamEvent) => {
    const parsed = parseSourceStateEvent(event.data);
    if (!parsed) return;
    setStates((prev) => (prev[parsed.sourceId] === parsed.state ? prev : { ...prev, [parsed.sourceId]: parsed.state }));
  }, []);
  const status = useLiveStream(enabled ? liveUrl(["sources"]) : null, ["source-state"], onEvent, options);
  return { states, status };
}
