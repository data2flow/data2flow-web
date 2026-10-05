/**
 * UI-RUL-05 알람 상세(RUL-02.01·02.02·02.04, RUL-04.01, TC-RUL-039·044·054 AT-RUL-06.3·06.5, TC-RUL-066 발송 이력).
 * 헤더(심각도·상태·제목, [확인] [해제] [무음 ▼] [담당자 지정]) · 요약(출처 링크, 대상, 발생·최고·마지막 값, 시각, 횟수, 억제 사유)
 * · 차트(발생 전후 측정값, 발생·해제 기준 띠, 알람 구간 음영) · 하위 알람 · 타임라인 · 알림 발송 이력 · 메모·조치 기록.
 * 조치 버튼은 ALARM_HANDLE(OPERATOR+)에게만 보이고, 서버도 다시 거부한다(403).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Badge, Button, Card, CsrfField, EmptyState, SelectField, Table, TextArea, TextField } from "~/components/ui";
import type { ChartAnnotation, ChartSeries } from "~/lib/chart-model";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber } from "~/lib/format";
import { canAck, canClear, durationSec, sortEvents, sourceLink, spacePathText, type Alarm, type AlarmEvent } from "../model/alarms";
import { QUICK_SILENCE_MINUTES } from "../model/silence";
import { formatDuration } from "./alarm-list-view";
import { AlarmStatusChip, SeverityBadge } from "./badges";

export interface Delivery {
  deliveryId: string;
  alarmId?: string;
  channel: string;
  recipient: string;
  status: string;
  skipReason?: string | null;
  attempts?: number;
  lastError?: string | null;
  sentAt?: string | null;
}

export interface AlarmDetailData {
  alarm: Alarm;
  events: AlarmEvent[];
  children: Alarm[];
  chart?: { metric?: string | null; from?: string; to?: string } | null;
}

export interface AlarmActionResult {
  intent?: string;
  ok?: boolean;
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, string>;
}

export const ACTION_TYPES = ["ONSITE", "CONFIG_CHANGE", "DEVICE_REPLACED", "OTHER"] as const;
export const NOTE_MAX = 2000;

export function AlarmDetailView({
  detail,
  deliveries,
  series,
  users,
  meId,
  canHandle,
  timezone,
  nowMs,
  result,
  chartFactory,
}: {
  detail: AlarmDetailData;
  deliveries: Delivery[] | null;
  series: ChartSeries[];
  users: { userId: string; name: string }[];
  meId?: string;
  canHandle: boolean;
  timezone: string;
  nowMs: number;
  result?: AlarmActionResult;
  chartFactory?: ChartFactory;
}) {
  const { t, i18n } = useTranslation();
  const { alarm } = detail;
  const lang = i18n.language;
  const link = sourceLink(alarm);
  const [note, setNote] = useState("");
  const value = (v: number | null | undefined) => (v == null ? "–" : `${formatNumber(v, lang)}${alarm.unit ? ` ${alarm.unit}` : ""}`);
  const raise = alarm.threshold?.raise ?? null;
  const clear = alarm.threshold?.clear ?? null;
  const band = raise != null || clear != null ? { min: Math.min(raise ?? clear ?? 0, clear ?? raise ?? 0), max: Math.max(raise ?? clear ?? 0, clear ?? raise ?? 0) } : null;
  const annotations: ChartAnnotation[] = [{ id: `alarm-${alarm.id}`, timeFrom: alarm.raisedAt, timeTo: alarm.clearedAt ?? null, type: "ALARM", title: alarm.title }];
  const targetName = alarm.device ? (alarm.device.name ?? t("alarms.detail.hiddenTarget")) : null;

  return (
    <div className="flex flex-col gap-4">
      {result?.ok && <Alert tone="success">{t(`alarms.detail.done.${result.intent ?? "x"}`, { defaultValue: t("common.done") })}</Alert>}
      {result?.error && <Alert tone="danger">{errorText(t, result.error)}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={alarm.severity} />
            <AlarmStatusChip alarm={alarm} />
          </div>
          {canHandle && (
            <div className="flex flex-wrap items-end gap-2">
              {canAck(alarm) && (
                <Form method="post">
                  <CsrfField />
                  <input type="hidden" name="intent" value="ack" />
                  <Button type="submit" variant="primary">
                    {t("alarms.ack")}
                  </Button>
                </Form>
              )}
              <Form method="post" className="flex items-end gap-1">
                <CsrfField />
                <input type="hidden" name="intent" value="silence" />
                <SelectField label={t("alarms.silence")} name="minutes" defaultValue="30">
                  {QUICK_SILENCE_MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {formatDuration(m * 60, t)}
                    </option>
                  ))}
                </SelectField>
                <Button type="submit">{t("alarms.silence")}</Button>
              </Form>
              <Form method="post" className="flex items-end gap-1">
                <CsrfField />
                <input type="hidden" name="intent" value="assign" />
                <SelectField label={t("alarms.detail.assignee")} name="userId" defaultValue={alarm.assignee?.userId ?? meId ?? ""}>
                  {users.map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.userId === meId ? t("alarms.detail.me", { name: u.name }) : u.name}
                    </option>
                  ))}
                </SelectField>
                <Button type="submit">{t("alarms.detail.assign")}</Button>
              </Form>
            </div>
          )}
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted">{t("alarms.detail.source")}</dt>
          <dd>
            {t(`alarms.source.${alarm.source.type}`)}
            {link ? (
              <>
                {" · "}
                <Link to={link} className="text-accent underline">
                  {alarm.source.type === "RULE" ? (alarm.source.ruleName ?? t("alarms.detail.openRule")) : `${alarm.source.flowName ?? t("alarms.detail.openFlow")}${alarm.source.nodeId ? ` · ${alarm.source.nodeId}` : ""}`}
                </Link>
              </>
            ) : null}
          </dd>
          <dt className="text-muted">{t("alarms.detail.target")}</dt>
          <dd>
            {targetName && alarm.device?.name ? (
              <Link to={`/devices/${encodeURIComponent(alarm.device.id)}`} className="text-accent underline">
                {targetName}
              </Link>
            ) : (
              targetName
            )}
            {targetName && alarm.space ? " · " : ""}
            {spacePathText(alarm.space) || (!targetName ? "–" : "")}
          </dd>
          <dt className="text-muted">{t("alarms.detail.values")}</dt>
          <dd className="font-mono">{t("alarms.detail.valueLine", { trigger: value(alarm.triggerValue), peak: value(alarm.peakValue), last: value(alarm.lastValue) })}</dd>
          <dt className="text-muted">{t("alarms.detail.raisedAt")}</dt>
          <dd>
            {formatDateTime(alarm.raisedAt, timezone, lang)} · {t("alarms.times", { n: alarm.occurrenceCount ?? 1 })} · {t("alarms.detail.duration", { d: formatDuration(durationSec(alarm, nowMs), t) })}
          </dd>
          {alarm.ackedAt && (
            <>
              <dt className="text-muted">{t("alarms.detail.ackedAt")}</dt>
              <dd>
                {formatDateTime(alarm.ackedAt, timezone, lang)} {alarm.ackedBy?.name ?? ""}
              </dd>
            </>
          )}
          {alarm.clearedAt && (
            <>
              <dt className="text-muted">{t("alarms.detail.clearedAt")}</dt>
              <dd>
                {formatDateTime(alarm.clearedAt, timezone, lang)} {alarm.clearReason ? `(${t(`alarms.clearReason.${alarm.clearReason}`, { defaultValue: alarm.clearReason })})` : ""}
              </dd>
            </>
          )}
          {alarm.assignee && (
            <>
              <dt className="text-muted">{t("alarms.detail.assignee")}</dt>
              <dd>{alarm.assignee.name}</dd>
            </>
          )}
          {alarm.parentAlarmId && (
            <>
              <dt className="text-muted">{t("alarms.detail.parent")}</dt>
              <dd>
                <Link to={`/alarms/${encodeURIComponent(alarm.parentAlarmId)}`} className="text-accent underline">
                  {t("alarms.detail.openParent")}
                </Link>
              </dd>
            </>
          )}
        </dl>
      </Card>

      {series.length > 0 && (
        <Card title={t("alarms.detail.chart", { metric: detail.chart?.metric ?? alarm.metric ?? "" })}>
          <TimeseriesChart series={series} timezone={timezone} annotations={annotations} target={band} factory={chartFactory} title={t("alarms.detail.chart", { metric: alarm.metric ?? "" })} />
          {(raise != null || clear != null) && <p className="mt-1 text-[12px] text-muted">{t("alarms.detail.thresholds", { raise: raise ?? "–", clear: clear ?? "–" })}</p>}
        </Card>
      )}

      {detail.children.length > 0 && (
        <Card title={t("alarms.detail.childrenTitle", { n: detail.children.length })}>
          <ul className="flex flex-col gap-1 text-[13px]">
            {detail.children.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={c.severity} short />
                <AlarmStatusChip alarm={c} />
                <Link to={`/alarms/${encodeURIComponent(c.id)}`} className="text-accent underline">
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t("alarms.detail.timeline")}>
        {detail.events.length === 0 ? (
          <EmptyState title={t("alarms.detail.noEvents")} />
        ) : (
          <ol aria-label={t("alarms.detail.timeline")} className="flex flex-col gap-1 text-[13px]">
            {sortEvents(detail.events).map((e, i) => (
              <li key={`${e.type}-${e.at}-${i}`} className="flex flex-wrap gap-2">
                <span className="font-mono text-muted">{formatDateTime(e.at, timezone, lang, true)}</span>
                <Badge tone="neutral">{t(`alarms.event.${e.type}`, { defaultValue: e.type })}</Badge>
                <span>{eventText(e, t, (id) => users.find((u) => u.userId === id)?.name ?? (alarm.assignee?.userId === id ? alarm.assignee.name : undefined))}</span>
                {e.actor?.name && <span className="text-muted">{e.actor.name}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {deliveries && (
        <Card title={t("alarms.detail.deliveries")}>
          {deliveries.length === 0 ? (
            <p className="text-[13px] text-muted">{t("alarms.detail.noDeliveries")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th scope="col">{t("alarms.detail.channel")}</th>
                  <th scope="col">{t("alarms.detail.recipient")}</th>
                  <th scope="col">{t("alarms.detail.deliveryStatus")}</th>
                  <th scope="col">{t("alarms.detail.attempts")}</th>
                  <th scope="col">{t("alarms.detail.sentAt")}</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.deliveryId}>
                    <td>{d.channel}</td>
                    <td>{d.recipient}</td>
                    <td>
                      {d.status}
                      {d.skipReason ? `_${d.skipReason}` : ""}
                      {d.lastError ? <span className="ml-1 text-bad-ink">{d.lastError}</span> : null}
                    </td>
                    <td className="font-mono">{d.attempts ?? 0}</td>
                    <td className="font-mono">{d.sentAt ? formatDateTime(d.sentAt, timezone, lang) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {canHandle && (
        <Card title={t("alarms.detail.noteTitle")}>
          <Form method="post" className="flex flex-col gap-2" onSubmit={() => setNote("")}>
            <CsrfField />
            <input type="hidden" name="intent" value="note" />
            <TextArea label={t("alarms.detail.note")} name="text" rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} error={result?.fieldErrors?.text ? t(result.fieldErrors.text, { n: NOTE_MAX }) : undefined} />
            <SelectField label={t("alarms.detail.actionType")} name="actionType" defaultValue="">
              <option value="">{t("alarms.detail.noteOnly")}</option>
              {ACTION_TYPES.map((a) => (
                <option key={a} value={a}>
                  {t(`alarms.actionType.${a}`)}
                </option>
              ))}
            </SelectField>
            <div className="flex justify-end gap-2">
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          </Form>
          {canClear(alarm) && (
            <Form method="post" className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <CsrfField />
              <input type="hidden" name="intent" value="clear" />
              <TextField label={t("alarms.detail.clearNote")} name="note" maxLength={NOTE_MAX} className="min-w-60 flex-1" />
              <Button type="submit" variant="danger">
                {t("alarms.clear")}
              </Button>
            </Form>
          )}
        </Card>
      )}
    </div>
  );
}

function eventText(event: AlarmEvent, t: (key: string, o?: Record<string, unknown>) => string, userName: (id: string) => string | undefined = () => undefined): string {
  const data = event.data ?? {};
  switch (event.type) {
    case "RAISED":
    case "RERAISED":
      return data.value != null ? t("alarms.eventText.value", { value: String(data.value) }) : "";
    case "NOTE":
      return String(data.text ?? "");
    case "ACTION":
      return `${t(`alarms.actionType.${String(data.actionType ?? "OTHER")}`, { defaultValue: String(data.actionType ?? "") })} ${String(data.text ?? "")}`.trim();
    case "ASSIGNED":
      // core 타임라인은 {assigneeId}만 남긴다(AlarmHandlingService.assign). 이름은 담당자 후보·지금 담당자에서 찾는다
      if (data.assigneeId === null) return t("alarms.eventText.unassigned");
      return t("alarms.eventText.assigned", { name: String((data.assignee as { name?: string } | undefined)?.name ?? data.name ?? (data.assigneeId != null ? (userName(String(data.assigneeId)) ?? `#${String(data.assigneeId)}`) : "")) });
    case "NOTIFIED":
      return t("alarms.eventText.notified", { channel: String(data.channel ?? ""), recipient: String(data.recipient ?? ""), status: String(data.status ?? "") });
    case "ESCALATED":
      return t("alarms.eventText.escalated", { step: String(data.stepNo ?? "") });
    case "CLEARED":
      return data.reason ? t(`alarms.clearReason.${String(data.reason)}`, { defaultValue: String(data.reason) }) : String(data.note ?? "");
    default:
      return "";
  }
}
