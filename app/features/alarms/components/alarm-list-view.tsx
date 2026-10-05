/**
 * UI-RUL-04 알람 목록(RUL-02.06, RUL-04.01~03, DSH-07.01 360px, TC-RUL-058 AT-RUL-06.4).
 * 요약 바(상태·심각도 수, 누르면 필터) · 필터(URL 검색 매개변수와 같이 움직임) · 목록(심각도 → 발생 시각, 하위 알람·공간 이벤트 묶기)
 * · 일괄 [확인]·[무음 ▼](최대 200건, 건별 결과) · 실시간(SSE `/bff/stream/alarms`, 새 알람 맨 위 3초 강조, 끊김 띠).
 * 행은 표 대신 줄바꿈되는 목록으로 그려 좁은 화면(360px)에서도 가로 스크롤 없이 쓴다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Button, Card, EmptyState, Pager, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber } from "~/lib/format";
import { descendantIds, type SpaceNode } from "~/lib/spaces";
import type { StreamEvent } from "~/lib/event-stream";
import { alarmsApi, type AlarmsApi } from "../api";
import {
  ALARM_STATUSES,
  BULK_LIMIT,
  HIGHLIGHT_MS,
  OPEN_STATUSES,
  RANGES,
  SEVERITIES,
  SOURCE_TYPES,
  applyAlarmEvent,
  bulkSummary,
  durationSec,
  filterToParams,
  groupAlarms,
  spacePathText,
  type Alarm,
  type AlarmCounts,
  type AlarmFilter,
  type BulkResult,
  type LiveState,
} from "../model/alarms";
import { QUICK_SILENCE_MINUTES, quickSilence } from "../model/silence";
import { AlarmStatusChip, SeverityBadge } from "./badges";

const control = "rounded-md border border-line bg-panel px-2 py-1.5 text-[13px]";

export function formatDuration(seconds: number, t: (key: string, o?: Record<string, unknown>) => string): string {
  if (seconds >= 86400) return t("alarms.dur.days", { n: Math.floor(seconds / 86400) });
  if (seconds >= 3600) return t("alarms.dur.hours", { n: Math.floor(seconds / 3600) });
  if (seconds >= 60) return t("alarms.dur.minutes", { n: Math.floor(seconds / 60) });
  return t("alarms.dur.seconds", { n: seconds });
}

export interface AlarmListViewProps {
  alarms: Alarm[];
  counts: AlarmCounts;
  filter: AlarmFilter;
  totalPages?: number;
  spaces: SpaceNode[];
  canHandle: boolean;
  timezone: string;
  now?: () => number;
  api?: AlarmsApi;
  live?: UseLiveStreamOptions;
}

export function AlarmListView({ alarms: initial, counts: initialCounts, filter, totalPages, spaces, canHandle, timezone, now = () => Date.now(), api = alarmsApi, live }: AlarmListViewProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<LiveState>({ alarms: initial, counts: initialCounts });
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, BulkResult>>(new Map());
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stateRef = useRef<LiveState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    stateRef.current = { alarms: initial, counts: initialCounts };
    setState(stateRef.current);
    setSelected(new Set());
    setResults(new Map());
  }, [initial, initialCounts]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const spaceIds = useMemo(() => (filter.spaceId ? new Set([filter.spaceId, ...descendantIds(spaces, filter.spaceId)]) : undefined), [filter.spaceId, spaces]);
  const onEvent = useCallback(
    (event: StreamEvent) => {
      const alarm = event.data as Alarm;
      if (!alarm || typeof alarm !== "object" || alarm.id === undefined) return;
      const next = applyAlarmEvent(stateRef.current, event.type, alarm, filter, spaceIds);
      stateRef.current = { alarms: next.alarms, counts: next.counts };
      setState(stateRef.current);
      if (next.added) {
        const id = next.added;
        setHighlight((h) => new Set(h).add(id));
        timers.current.push(
          setTimeout(() => {
            setHighlight((h) => {
              const copy = new Set(h);
              copy.delete(id);
              return copy;
            });
          }, HIGHLIGHT_MS),
        );
      }
    },
    [filter, spaceIds],
  );
  const status = useLiveStream("/bff/stream/alarms", ["alarm.raised", "alarm.updated", "alarm.cleared"], onEvent, live);

  const go = (patch: Partial<AlarmFilter>) => {
    const params = filterToParams({ ...filter, page: 1, ...patch });
    const query = params.toString();
    navigate(query ? `?${query}` : "?");
  };

  const entries = useMemo(() => groupAlarms(state.alarms, filter.groupBySpaceEvent), [state.alarms, filter.groupBySpaceEvent]);
  const visibleIds = state.alarms.map((a) => a.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const copy = new Set(s);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });

  const ack = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (ids.length > BULK_LIMIT) {
      setMessage({ tone: "danger", text: t("errors.ALARM_BULK_LIMIT_EXCEEDED") });
      return;
    }
    setBusy(true);
    const response = await api.bulkAck(ids);
    setBusy(false);
    if (!response.ok) {
      setMessage({ tone: "danger", text: errorText(t, response) ?? "" });
      return;
    }
    const map = new Map(response.data.results.map((r) => [String(r.alarmId), { ...r, alarmId: String(r.alarmId) }]));
    setResults(map);
    const nowIso = new Date(now()).toISOString();
    setState((current) => ({
      ...current,
      alarms: current.alarms.map((a) => (map.get(a.id)?.ok && a.status === "ACTIVE" ? { ...a, status: "ACKNOWLEDGED", ackedAt: a.ackedAt ?? nowIso } : a)),
    }));
    const summary = bulkSummary([...map.values()]);
    setMessage({ tone: summary.failed ? "warning" : "success", text: t("alarms.bulk.ackResult", { ok: summary.ok, failed: summary.failed }) });
    setSelected(new Set(summary.failures.map((f) => f.alarmId)));
  };

  const silence = async (minutes: number) => {
    const ids = [...selected];
    if (ids.length === 0 || !minutes) return;
    if (ids.length > BULK_LIMIT) {
      setMessage({ tone: "danger", text: t("errors.ALARM_BULK_LIMIT_EXCEEDED") });
      return;
    }
    setBusy(true);
    const outcomes: BulkResult[] = [];
    // 무음은 대상 하나씩 만든다(API-RUL-25). 10건씩 나눠 동시에 보낸다
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10);
      const done = await Promise.all(part.map(async (id) => ({ id, result: await api.silence(quickSilence({ type: "ALARM", id }, minutes, now())) })));
      for (const { id, result } of done) outcomes.push(result.ok ? { alarmId: id, ok: true } : { alarmId: id, ok: false, code: result.code });
    }
    setBusy(false);
    setResults(new Map(outcomes.map((r) => [r.alarmId, r])));
    const summary = bulkSummary(outcomes);
    setMessage({ tone: summary.failed ? "warning" : "success", text: t("alarms.bulk.silenceResult", { ok: summary.ok, failed: summary.failed }) });
    setSelected(new Set(summary.failures.map((f) => f.alarmId)));
  };

  const statusPreset = filter.status.length === ALARM_STATUSES.length ? "all" : filter.status.length === OPEN_STATUSES.length && OPEN_STATUSES.every((s) => filter.status.includes(s)) ? "open" : filter.status.join(",");
  const nowMs = now();

  const row = (alarm: Alarm, child = false) => {
    const result = results.get(alarm.id);
    return (
      <li
        key={alarm.id}
        data-alarm-id={alarm.id}
        className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 py-2 text-[13px]", child && "pl-8 text-muted", highlight.has(alarm.id) && "bg-accent-soft")}
        aria-label={highlight.has(alarm.id) ? t("alarms.newAlarm", { title: alarm.title }) : undefined}
      >
        {canHandle && <input type="checkbox" aria-label={t("alarms.select", { title: alarm.title })} checked={selected.has(alarm.id)} onChange={() => toggle(alarm.id)} />}
        <span className="w-20 shrink-0">
          <SeverityBadge severity={alarm.severity} short />
        </span>
        <AlarmStatusChip alarm={alarm} />
        <Link to={`/alarms/${encodeURIComponent(alarm.id)}`} className="min-w-0 flex-1 basis-48 font-medium text-accent hover:underline">
          {alarm.title}
        </Link>
        <span className="min-w-0 basis-40 truncate text-muted">{[alarm.device?.name, spacePathText(alarm.space)].filter(Boolean).join(" · ") || "–"}</span>
        <span className="font-mono" title={t("alarms.col.values")}>
          {alarm.triggerValue == null ? "–" : formatNumber(alarm.triggerValue, i18n.language)}
          {alarm.peakValue != null && alarm.peakValue !== alarm.triggerValue ? ` / ${formatNumber(alarm.peakValue, i18n.language)}` : ""}
        </span>
        <span className="font-mono text-muted">{formatDateTime(alarm.raisedAt, timezone, i18n.language)}</span>
        <span className="text-muted">{formatDuration(durationSec(alarm, nowMs), t)}</span>
        <span className="text-muted">{t("alarms.times", { n: alarm.occurrenceCount ?? 1 })}</span>
        {alarm.ackedBy && <span className="text-muted">{alarm.ackedBy.name}</span>}
        {result && <span className={result.ok ? "text-good-ink" : "text-bad-ink"}>{result.ok ? (result.alreadyAcked ? t("alarms.bulk.already") : t("alarms.bulk.ok")) : (errorText(t, { code: result.code ?? "UNKNOWN" }) ?? "")}</span>}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <LiveBanner status={status} />
      <div className="flex flex-wrap items-center gap-2 text-[13px]" aria-label={t("alarms.summary")}>
        {OPEN_STATUSES.map((s) => (
          <button key={s} type="button" className="rounded border border-line px-2 py-1 hover:border-accent" onClick={() => go({ status: [s] })}>
            {t(`alarms.status.${s}`)} <b className="font-mono">{state.counts.byStatus[s] ?? 0}</b>
          </button>
        ))}
        <span className="mx-1 text-line">|</span>
        {SEVERITIES.filter((s) => (state.counts.bySeverity[s] ?? 0) > 0).map((s) => (
          <button key={s} type="button" className="rounded border border-line px-2 py-1 hover:border-accent" onClick={() => go({ severity: [s] })}>
            <SeverityBadge severity={s} short /> <b className="font-mono">{state.counts.bySeverity[s]}</b>
          </button>
        ))}
        <span className="ml-auto">
          <LiveDot status={status} />
        </span>
      </div>
      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-2" role="group" aria-label={t("common.filter")}>
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            {t("alarms.filter.status")}
            <select className={control} value={statusPreset} onChange={(e) => go({ status: e.target.value === "open" ? [...OPEN_STATUSES] : e.target.value === "all" ? [...ALARM_STATUSES] : (e.target.value.split(",") as AlarmFilter["status"]) })}>
              <option value="open">{t("alarms.filter.open")}</option>
              {ALARM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`alarms.status.${s}`)}
                </option>
              ))}
              <option value="all">{t("common.all")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            {t("alarms.filter.severity")}
            <select className={control} value={filter.severity[0] ?? ""} onChange={(e) => go({ severity: e.target.value ? [e.target.value as AlarmFilter["severity"][number]] : [] })}>
              <option value="">{t("common.all")}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`alarms.severity.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <SpaceSelect spaces={spaces} label={t("alarms.filter.space")} emptyLabel={t("common.all")} value={filter.spaceId} onChange={(e) => go({ spaceId: e.target.value })} />
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            {t("alarms.filter.range")}
            <select className={control} value={filter.range} onChange={(e) => go({ range: e.target.value as AlarmFilter["range"] })}>
              {RANGES.map((r) => (
                <option key={r} value={r}>
                  {t(`alarms.range.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            {t("alarms.filter.source")}
            <select className={control} value={filter.sourceType} onChange={(e) => go({ sourceType: e.target.value })}>
              <option value="">{t("common.all")}</option>
              {SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`alarms.source.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[13px]">
            <input type="checkbox" checked={filter.groupBySpaceEvent} onChange={(e) => go({ groupBySpaceEvent: e.target.checked })} />
            {t("alarms.filter.groupBySpaceEvent")}
          </label>
        </div>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {state.alarms.length === 0 ? (
          <EmptyState title={t("alarms.empty")} />
        ) : (
          <>
            {canHandle && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-2 text-[13px]">
                <label className="flex items-center gap-1">
                  <input type="checkbox" aria-label={t("alarms.selectAll")} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))} />
                  {t("alarms.selectedCount", { n: selected.size })}
                </label>
                <Button onClick={() => void ack()} disabled={busy || selected.size === 0}>
                  {t("alarms.ack")}
                </Button>
                <select className={control} aria-label={t("alarms.silence")} value="" disabled={busy || selected.size === 0} onChange={(e) => void silence(Number(e.target.value))}>
                  <option value="">{t("alarms.silenceMenu")}</option>
                  {QUICK_SILENCE_MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {t("alarms.silenceFor", { duration: formatDuration(m * 60, t) })}
                    </option>
                  ))}
                </select>
                {selected.size > BULK_LIMIT && <span className="text-bad-ink">{t("errors.ALARM_BULK_LIMIT_EXCEEDED")}</span>}
              </div>
            )}
            <ul aria-label={t("alarms.title")}>
              {entries.map((entry) =>
                entry.kind === "event" ? (
                  <li key={`ev-${entry.spaceEventId}`} className="border-b border-line">
                    <p className="bg-bg px-2 py-1 text-[12.5px] font-semibold">{t("alarms.spaceEvent", { space: spacePathText(entry.alarms[0].space) || "–", n: entry.alarms.length })}</p>
                    <ul>{entry.alarms.map((a) => row(a, true))}</ul>
                  </li>
                ) : entry.children.length > 0 ? (
                  <li key={`p-${entry.alarm.id}`}>
                    <ul>
                      {row(entry.alarm)}
                      {entry.children.map((c) => row(c, true))}
                    </ul>
                  </li>
                ) : (
                  row(entry.alarm)
                ),
              )}
            </ul>
          </>
        )}
        <Pager page={filter.page} totalPages={totalPages} />
      </Card>
    </div>
  );
}
