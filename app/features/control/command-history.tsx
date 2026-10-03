/**
 * UI-ACT-02 명령 이력(ACT-04.03, ACT-02.02·02.03): 요청 시각, 기기, 기능·명령·인자, 출처(플로우는 링크), 상태, 소요 시간, 사유.
 * 행을 펼치면 상태 타임라인과 멱등 키를 보여 준다. 거부(REJECTED)·차단(BLOCKED)된 명령도 그대로 나온다.
 * 대기 중(QUEUED·DELAYED·QUEUED_FOR_DOWNLINK) 명령은 제어 권한이 있으면 취소할 수 있다(API-ACT-02 cancel).
 */
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useSearchParams } from "react-router";
import { Alert, Badge, Button, ButtonLink, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { controlApi, type ControlApi } from "./api";
import { CANCELLABLE, HISTORY_STATUSES, SOURCE_TYPES, commandDurationMs, commandLabel, failureReason, progressOf, requestedAt, type Command, type CommandSource } from "./model/control";

export function statusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "APPLIED") return "success";
  const p = progressOf(status);
  if (p.failed) return "danger";
  if (p.waiting) return "warning";
  return "info";
}

export function SourceLabel({ source }: { source?: CommandSource | null }) {
  const { t } = useTranslation();
  if (!source) return <span>–</span>;
  if (source.type === "FLOW" && source.flowId) {
    const text = t("control.history.source.flow", { name: source.flowName ?? source.flowId, version: source.flowVersion ?? "?", node: source.nodeId ?? "" });
    return (
      <Link to={`/automation/flows/${encodeURIComponent(source.flowId)}`} className="text-accent hover:underline">
        {text}
      </Link>
    );
  }
  if (source.type === "USER") return <span>{t("control.history.source.user", { name: source.userName ?? source.userId ?? "" })}</span>;
  return <span>{t(`control.history.sourceType.${source.type}`, { defaultValue: source.type })}</span>;
}

export interface CommandHistoryProps {
  rows: Command[];
  /** "더 보기" 주소(다음 커서) */
  moreHref?: string | null;
  showDevice: boolean;
  canControl: boolean;
  timezone: string;
  lang: string;
  failed?: boolean;
  api?: ControlApi;
}

export function CommandHistory({ rows: initialRows, moreHref, showDevice, canControl, timezone, lang, failed, api = controlApi }: CommandHistoryProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initialRows);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fmt = (iso?: string | null) => formatDateTime(iso ?? undefined, timezone, lang, true);

  const cancel = async (id: string) => {
    setNotice(null);
    const result = await api.cancel(id);
    if (result.ok) setRows((list) => list.map((r) => (r.id === id ? { ...r, ...result.data } : r)));
    else setNotice(errorText(t, result) ?? "");
  };

  return (
    <div className="flex flex-col gap-3">
      {failed && <Alert tone="warning">{t("control.history.unavailable")}</Alert>}
      {notice && <Alert tone="danger">{notice}</Alert>}
      {rows.length === 0 && !failed ? (
        <EmptyState title={t("control.history.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("control.history.col.time")}</th>
              {showDevice && <th>{t("control.history.col.device")}</th>}
              <th>{t("control.history.col.command")}</th>
              <th>{t("control.history.col.source")}</th>
              <th>{t("control.history.col.status")}</th>
              <th>{t("control.history.col.duration")}</th>
              <th>{t("control.history.col.reason")}</th>
              <th>
                <span className="sr-only">{t("control.history.col.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const duration = commandDurationMs(c);
              const reason = failureReason(c);
              const expanded = open === c.id;
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td className="font-mono text-[12px]">{fmt(requestedAt(c))}</td>
                    {showDevice && (
                      <td>
                        <Link to={`/devices/${encodeURIComponent(c.deviceId)}?tab=commands`} className="text-accent hover:underline">
                          {c.deviceName ?? c.deviceId}
                        </Link>
                      </td>
                    )}
                    <td className="font-mono text-[12px]">{commandLabel(c)}</td>
                    <td>
                      <SourceLabel source={c.source} />
                    </td>
                    <td>
                      <Badge tone={statusTone(c.status)}>{t(`control.status.${c.status}`, { defaultValue: c.status })}</Badge>
                    </td>
                    <td className="font-mono">{duration === null ? "–" : `${(duration / 1000).toFixed(1)}s`}</td>
                    <td className="text-[12.5px]">{reason ? t(`errors.${reason}`, { defaultValue: "" }) || reason : ""}</td>
                    <td className="whitespace-nowrap">
                      <Button variant="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.id)}>
                        {expanded ? t("control.history.collapse") : t("control.history.expand")}
                      </Button>
                      {canControl && CANCELLABLE.has(c.status) && (
                        <Button variant="ghost" onClick={() => void cancel(c.id)}>
                          {t("control.history.cancel")}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={showDevice ? 8 : 7}>
                        <ol aria-label={t("control.history.timeline")} className="flex flex-col gap-0.5 text-[12.5px]">
                          {(c.timeline ?? []).map((step, i) => (
                            <li key={`${step.status}-${i}`}>
                              <span className="font-mono">{fmt(step.at)}</span> {t(`control.status.${step.status}`, { defaultValue: step.status })}
                              {step.reason && ` — ${step.reason}`}
                            </li>
                          ))}
                        </ol>
                        <p className="mt-1 text-[12px] text-muted">
                          {t("control.history.commandId")}: <span className="font-mono">{c.id}</span>
                          {c.idempotencyKey && (
                            <>
                              {" · "}
                              {t("control.history.idempotencyKey")}: <span className="font-mono">{c.idempotencyKey}</span>
                            </>
                          )}
                          {c.priority && ` · ${t("control.history.priority")}: ${c.priority}`}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      )}
      {moreHref && (
        <div className="flex justify-end">
          <ButtonLink to={moreHref}>{t("common.more")}</ButtonLink>
        </div>
      )}
    </div>
  );
}

/** 이력 필터(기간·출처·상태·기능). GET 폼이라 주소에 남는다 */
export function HistoryFilters({ hidden = {} }: { hidden?: Record<string, string> }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  return (
    <Form method="get" className="mb-3 flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <TextField label={t("control.history.filter.from")} name="from" type="datetime-local" defaultValue={params.get("from") ?? ""} />
      <TextField label={t("control.history.filter.to")} name="to" type="datetime-local" defaultValue={params.get("to") ?? ""} />
      <SelectField label={t("control.history.filter.source")} name="sourceType" defaultValue={params.get("sourceType") ?? ""}>
        <option value="">{t("common.all")}</option>
        {SOURCE_TYPES.map((s) => (
          <option key={s} value={s}>
            {t(`control.history.sourceType.${s}`)}
          </option>
        ))}
      </SelectField>
      <SelectField label={t("control.history.filter.status")} name="status" defaultValue={params.get("status") ?? ""}>
        <option value="">{t("common.all")}</option>
        {HISTORY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`control.status.${s}`)}
          </option>
        ))}
      </SelectField>
      <TextField label={t("control.history.filter.capability")} name="capability" defaultValue={params.get("capability") ?? ""} />
      <Button type="submit">{t("common.search")}</Button>
    </Form>
  );
}
