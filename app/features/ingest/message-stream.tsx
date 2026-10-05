/**
 * 수집 메시지 스트림(DSH-03.03, API-DSH-21): 소스·기기·처리 결과 필터는 SSE 토픽 쿼리에 반영하고,
 * 일시정지하면 화면 목록을 고정한 채 대기 건수만 센다(버퍼 500). 행을 펼치면 원본과 표준 메시지를 나란히 본다.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Button, SelectField, Table, TextField } from "~/components/ui";
import { MessageBuffer, liveUrl, type StreamEvent } from "~/lib/event-stream";
import { formatDateTime } from "~/lib/format";
import { RESULT_CODES, messageTopic, type StreamFilter } from "./model/ingest";

/** API-DSH-21 `message` 이벤트(core LiveDtos.IngestMessage) */
export interface StreamMessage {
  id?: string;
  receivedAt: string;
  sourceId: string;
  topic: string;
  deviceId?: string | null;
  externalId?: string | null;
  result: string;
  errorCode?: string | null;
  /** 원본 앞 4KB. INGEST_PAYLOAD_READ가 없으면 빠진다 */
  raw?: unknown;
  /** TEXT 또는 BASE64(바이너리) */
  rawEncoding?: string;
  rawTruncated?: boolean;
  canonical?: unknown;
}

let seq = 0;

function pretty(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export function MessageStream({
  sources,
  timezone,
  initialFilter = {},
  live = {},
}: {
  sources: { id: string; name: string }[];
  timezone: string;
  initialFilter?: StreamFilter;
  live?: UseLiveStreamOptions;
}) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<StreamFilter>(initialFilter);
  const [deviceInput, setDeviceInput] = useState(initialFilter.deviceId ?? "");
  const [b] = useState(() => new MessageBuffer<StreamMessage & { key: number }>(500));
  const [, setVersion] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const url = useMemo(() => liveUrl([messageTopic(filter)]), [filter]);
  const onEvent = useCallback((event: StreamEvent) => {
    const data = event.data as StreamMessage;
    if (!data || typeof data !== "object") return;
    seq += 1;
    b.push({ ...data, key: seq });
    setVersion((v) => v + 1);
  }, [b]);
  const status = useLiveStream(url, ["message"], onEvent, live);
  const sourceName = (id: string) => sources.find((s) => String(s.id) === String(id))?.name ?? id;
  const change = (next: StreamFilter) => {
    if (next.sourceId === filter.sourceId && next.deviceId === filter.deviceId && next.result === filter.result) return;
    b.clear();
    setFilter(next);
    setVersion((v) => v + 1);
  };
  return (
    <section aria-label={t("ingest.stream.title")} className="flex flex-col gap-3">
      <LiveBanner status={status} />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label={t("ingest.stream.source")} value={filter.sourceId ?? ""} onChange={(e) => change({ ...filter, sourceId: e.target.value || undefined })}>
          <option value="">{t("common.all")}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            change({ ...filter, deviceId: deviceInput.trim() || undefined });
          }}
        >
          <TextField label={t("ingest.stream.device")} value={deviceInput} onChange={(e) => setDeviceInput(e.target.value)} onBlur={() => change({ ...filter, deviceId: deviceInput.trim() || undefined })} />
        </form>
        <SelectField label={t("ingest.stream.result")} value={filter.result ?? ""} onChange={(e) => change({ ...filter, result: e.target.value || undefined })}>
          <option value="">{t("common.all")}</option>
          {RESULT_CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </SelectField>
        <div className="ml-auto flex items-center gap-3">
          <LiveDot status={status} />
          {b.paused && <span role="status" className="text-[12.5px] text-fair-ink">{t("ingest.stream.waiting", { n: b.waiting })}</span>}
          <Button
            onClick={() => {
              if (b.paused) b.resume();
              else b.pause();
              setVersion((v) => v + 1);
            }}
          >
            {b.paused ? t("common.resume") : t("common.pause")}
          </Button>
        </div>
      </div>
      {b.items.length === 0 ? (
        <p className="text-[13px] text-muted">{t("ingest.stream.empty")}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("ingest.stream.receivedAt")}</th>
              <th>{t("ingest.stream.source")}</th>
              <th>{t("ingest.stream.topic")}</th>
              <th>{t("ingest.stream.device")}</th>
              <th>{t("ingest.stream.result")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {b.items.map((m) => (
              <MessageRow key={m.key} message={m} sourceName={sourceName(m.sourceId)} timezone={timezone} lang={i18n.language} open={open === m.key} onToggle={() => setOpen(open === m.key ? null : m.key)} />
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

function MessageRow({ message, sourceName, timezone, lang, open, onToggle }: { message: StreamMessage; sourceName: string; timezone: string; lang: string; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <tr data-result={message.result}>
        <td className="font-mono">{formatDateTime(message.receivedAt, timezone, lang, true)}</td>
        <td>{sourceName}</td>
        <td className="max-w-[260px] truncate font-mono text-[12px]">{message.topic}</td>
        <td className="font-mono">{message.deviceId ?? message.externalId ?? "–"}</td>
        <td className={message.result === "OK" ? "" : "text-bad-ink"}>
          {message.result}
          {message.errorCode && <span className="ml-1 font-mono text-[11.5px]">{message.errorCode}</span>}
        </td>
        <td>
          <Button variant="ghost" aria-expanded={open} onClick={onToggle}>
            {open ? t("ingest.stream.collapse") : t("ingest.stream.expand")}
          </Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-[11.5px] font-semibold text-muted">{t("ingest.stream.raw")}</p>
                {message.raw === undefined || message.raw === null ? (
                  <p className="text-[12.5px] text-muted">{t("ingest.stream.rawHidden")}</p>
                ) : (
                  <pre aria-label={t("ingest.stream.raw")} className="max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-[12px]">
                    {pretty(message.raw)}
                    {message.rawTruncated ? "\n…" : ""}
                  </pre>
                )}
              </div>
              <div>
                <p className="text-[11.5px] font-semibold text-muted">{t("ingest.stream.canonical")}</p>
                <pre aria-label={t("ingest.stream.canonical")} className="max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-[12px]">
                  {pretty(message.canonical) || "–"}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
