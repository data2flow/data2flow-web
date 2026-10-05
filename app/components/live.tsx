/**
 * 실시간 연결 훅과 끊김 띠(00-navigation.md §1.3 "실시간 연결 상태", DSH-05.01).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LiveConnection, type EventSourceLike, type StreamEvent, type StreamStatus } from "~/lib/event-stream";

export interface UseLiveStreamOptions {
  /** 테스트에서 가짜 EventSource를 넣는다 */
  createSource?: (url: string) => EventSourceLike;
  checkSession?: () => Promise<boolean>;
}

/** url이 null이면 연결하지 않는다. 핸들러는 최신 것을 쓴다(다시 연결하지 않음) */
export function useLiveStream(url: string | null, events: string[], onEvent: (event: StreamEvent) => void, options: UseLiveStreamOptions = {}): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("closed");
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);
  const eventKey = events.join(",");
  const { createSource, checkSession } = options;
  useEffect(() => {
    if (!url || typeof window === "undefined") return;
    if (!createSource && typeof EventSource === "undefined") return;
    const connection = new LiveConnection({
      url,
      events: eventKey.split(","),
      onEvent: (event) => handler.current(event),
      onStatus: setStatus,
      createSource,
      checkSession,
    });
    connection.start();
    return () => connection.stop();
  }, [url, eventKey, createSource, checkSession]);
  return status;
}

export function LiveBanner({ status }: { status: StreamStatus }) {
  const { t } = useTranslation();
  if (status !== "retrying") return null;
  return (
    <div role="status" className="mb-3 rounded-md border border-fair/30 bg-fair-soft px-3 py-2 text-[13px] text-fair-ink">
      {t("live.disconnected")}
    </div>
  );
}

/** 제목줄 옆 작은 연결 표시 */
export function LiveDot({ status }: { status: StreamStatus }) {
  const { t } = useTranslation();
  const tone = status === "open" ? "bg-good" : status === "retrying" ? "bg-fair" : "bg-muted";
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-muted">
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${tone}`} />
      {t(`live.status.${status}`)}
    </span>
  );
}
