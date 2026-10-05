/**
 * 실시간 원본 메시지(UI-DSC-03 실시간 메시지 탭, DSC-02.06, API-DSC-10 SSE `/bff/stream/sources/{id}/live`).
 * 토픽 필터는 구독 쿼리(`topicFilter`)로 보내고, 화면은 초당 10건까지만 보여 주며 넘친 수는 "n건 생략"(TC-DSC-100).
 * [일시정지]하면 목록을 고정하고, 행을 펼치면 원본 JSON과 디코딩 미리 보기를 나란히 보여 준다(TC-DSC-046).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Button, EmptyState, TextField } from "~/components/ui";
import { MessageBuffer, RateLimiter, type StreamEvent } from "~/lib/event-stream";
import { formatDateTime } from "~/lib/format";

export interface RawMessage {
  receivedAt: string;
  topic: string;
  sizeBytes?: number;
  size?: number;
  payload?: string;
  rawExcerpt?: string;
  truncated?: boolean;
  decoded?: unknown;
}

function pretty(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function liveMessagesUrl(sourceId: string, topicFilter: string): string {
  const query = topicFilter.trim() ? `?topicFilter=${encodeURIComponent(topicFilter.trim())}` : "";
  return `/bff/stream/sources/${encodeURIComponent(sourceId)}/live${query}`;
}

export function LiveMessages({ sourceId, timezone, now = Date.now, streamOptions }: { sourceId: string; timezone: string; now?: () => number; streamOptions?: UseLiveStreamOptions }) {
  const { t, i18n } = useTranslation();
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const buffer = useRef(new MessageBuffer<RawMessage & { seq: number }>(200));
  const limiter = useRef(new RateLimiter(10, now));
  const seq = useRef(0);
  const [, setVersion] = useState(0);
  const [serverDropped, setServerDropped] = useState(0);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => liveMessagesUrl(sourceId, filter), [sourceId, filter]);

  const onEvent = useCallback((event: StreamEvent) => {
    if (event.type === "dropped") {
      setServerDropped((n) => n + Number((event.data as { count?: number })?.count ?? 0));
      return;
    }
    if (!limiter.current.allow()) {
      setVersion((v) => v + 1);
      return;
    }
    seq.current += 1;
    buffer.current.push({ ...(event.data as RawMessage), seq: seq.current });
    setVersion((v) => v + 1);
  }, []);
  const status = useLiveStream(url, ["message", "dropped"], onEvent, streamOptions);
  const items = buffer.current.items;
  const skipped = limiter.current.dropped + serverDropped;

  const togglePause = () => {
    if (paused) buffer.current.resume();
    else buffer.current.pause();
    setPaused(!paused);
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <LiveBanner status={status} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          buffer.current.clear();
          setFilter(filterInput);
        }}
      >
        <TextField label={t("sources.live.topicFilter")} value={filterInput} onChange={(e) => setFilterInput(e.target.value)} placeholder="application/+/device/+/event/up" />
        <Button type="submit">{t("common.apply")}</Button>
        <Button onClick={togglePause} aria-pressed={paused}>
          {paused ? t("common.resume") : t("common.pause")}
        </Button>
        <LiveDot status={status} />
      </form>
      <p className="text-[12px] text-muted" role="status">
        {paused ? t("sources.live.pausedWaiting", { n: buffer.current.waiting }) : t("sources.live.rate")}
        {skipped > 0 && <span className="ml-2 text-fair-ink">{t("sources.live.skipped", { n: skipped })}</span>}
        {copied && <span className="ml-2">{t("common.copied")}</span>}
      </p>
      {items.length === 0 ? (
        <EmptyState title={t("sources.live.empty")} body={t("sources.live.emptyBody")} />
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((m) => {
            const raw = m.payload ?? m.rawExcerpt ?? "";
            return (
              <li key={m.seq} className="rounded border border-line px-2 py-1 text-[12.5px]">
                <button type="button" className="flex w-full flex-wrap gap-3 text-left" aria-expanded={open === m.seq} onClick={() => setOpen(open === m.seq ? null : m.seq)}>
                  <span className="font-mono">{formatDateTime(m.receivedAt, timezone, i18n.language, true)}</span>
                  <span className="font-mono">{m.topic}</span>
                  <span className="text-muted">{m.sizeBytes ?? m.size ?? raw.length}B</span>
                  {m.truncated && <span className="text-fair-ink">{t("sources.live.truncated")}</span>}
                </button>
                {open === m.seq && (
                  <div className="mt-1 grid gap-2 md:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11.5px] font-semibold text-muted">{t("sources.live.raw")}</span>
                        <Button variant="ghost" onClick={() => copy(raw)}>
                          {t("common.copy")}
                        </Button>
                      </div>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg p-1 font-mono">{pretty(raw)}</pre>
                    </div>
                    <div>
                      <span className="text-[11.5px] font-semibold text-muted">{t("sources.live.decoded")}</span>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg p-1 font-mono">{m.decoded ? JSON.stringify(m.decoded, null, 2) : t("sources.live.noDecoded")}</pre>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
