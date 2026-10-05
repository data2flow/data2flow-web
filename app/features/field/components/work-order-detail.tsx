/**
 * 작업 지시 상세(UI-DEV-13 상세, UI-DSH-14 작업 화면): 헤더(상태·우선순위·마감), 대상, 체크리스트(체크 즉시 저장), 첨부(사진 미리 보기·카메라),
 * 댓글, 출처, 상태 버튼(ASSIGN·START·COMPLETE·CANCEL, API-DEV-92), 완료 대화상자(유형별 결과, BR-DEV-22).
 * 오프라인이면 체크·사진·완료를 대기열에 넣고 "연결되면 전송"으로 보인다(BR-DSH-22, AT-DSH-16.3). 모바일(`compact`)은 주요 버튼을 화면 아래에 둔다(AT-DSH-16.1).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Button, Card, Checkbox, Dialog, SelectField, TextArea, TextField, cx } from "~/components/ui";
import { clientIdempotencyKey } from "~/lib/bff-client";
import { formatDateTime } from "~/lib/format";
import { fieldApi, type FieldApi } from "../api";
import { useOnline, useQueue } from "../hooks";
import type { OfflineQueue, QueuedOp } from "../model/offline-queue";
import {
  allowedActions,
  browserUrl,
  checkAttachment,
  checklistProgress,
  completionResult,
  isOverdue,
  type Attachment,
  type WorkOrderAction,
  type WorkOrderDetail,
} from "../model/work-orders";
import { OfflineBand, PhotoPicker, PriorityBadge, TouchButton, WorkOrderStatusBadge } from "./common";

export interface WorkOrderPanelProps {
  initial: WorkOrderDetail;
  canWrite: boolean;
  meId?: string | null;
  timezone: string;
  /** 모바일 작업 화면(하단 버튼 줄, 모바일 경로 링크) */
  compact?: boolean;
  api?: FieldApi;
  queue?: OfflineQueue;
  now?: () => number;
  onScan?: () => void;
}

type Message = { tone: "success" | "warning" | "danger" | "info"; text: string } | null;

export function WorkOrderPanel({ initial, canWrite, meId, timezone, compact = false, api = fieldApi, queue: injected, now = Date.now, onScan }: WorkOrderPanelProps) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const { queue, snapshot, results } = useQueue(injected);
  const [order, setOrder] = useState(initial);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<WorkOrderAction | null>(null);
  const [comment, setComment] = useState("");
  const pendingHere = snapshot.pending.filter((op) => op.target.workOrderId === order.id);

  // 새 데이터(다른 작업 지시·다시 읽기)가 오면 화면 상태를 바꾼다(렌더 중 비교, 효과로 덮어쓰지 않음)
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setOrder(initial);
  }

  const reload = useCallback(async () => {
    const result = await api.workOrder(order.id);
    if (result.ok) setOrder(result.data);
  }, [api, order.id]);

  // 대기열에서 이 작업 지시의 요청이 나가면 새로 읽는다
  const sentCount = results.filter((r) => r.op.target.workOrderId === order.id).length;
  useEffect(() => {
    if (sentCount > 0) void reload();
  }, [sentCount, reload]);

  const enqueue = async (op: Omit<QueuedOp, "id" | "createdAt" | "label">) => {
    if (!queue) return;
    await queue.enqueue({ ...op, id: clientIdempotencyKey(), createdAt: now(), label: order.title });
    setMessage({ tone: "info", text: t("field.offline.queued") });
  };

  const toggle = async (itemId: string, done: boolean) => {
    setOrder((o) => ({ ...o, checklist: o.checklist.map((c) => (c.id === itemId ? { ...c, done } : c)) }));
    if (!online) return enqueue({ kind: "checklist", key: clientIdempotencyKey(), target: { workOrderId: order.id, itemId, done } });
    const result = await api.check(order.id, itemId, done);
    if (!result.ok) {
      if (result.status === 0) return enqueue({ kind: "checklist", key: clientIdempotencyKey(), target: { workOrderId: order.id, itemId, done } });
      setOrder((o) => ({ ...o, checklist: o.checklist.map((c) => (c.id === itemId ? { ...c, done: !done } : c)) }));
      setMessage({ tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
    }
  };

  const upload = async (files: File[]) => {
    for (const file of files) {
      const invalid = checkAttachment(file);
      if (invalid) {
        setMessage({ tone: "danger", text: t(`field.attachments.invalid.${invalid}`) });
        return;
      }
    }
    for (const file of files) {
      const key = clientIdempotencyKey();
      const op = { kind: "attachment" as const, key, target: { workOrderId: order.id }, files: [{ blob: file, name: file.name }] };
      if (!online) {
        await enqueue(op);
        continue;
      }
      const result = await api.attach(order.id, file, file.name, key);
      if (result.ok) setOrder((o) => ({ ...o, attachments: [...o.attachments, result.data] }));
      else if (result.status === 0) await enqueue(op);
      else setMessage({ tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
    }
  };

  const removeAttachment = async (attachment: Attachment) => {
    const result = await api.detach(order.id, attachment.id);
    if (result.ok) setOrder((o) => ({ ...o, attachments: o.attachments.filter((a) => a.id !== attachment.id) }));
    else setMessage({ tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
  };

  const transition = async (action: WorkOrderAction, extra: { note?: string; result?: Record<string, unknown>; assigneeId?: string } = {}) => {
    setBusy(true);
    setMessage(null);
    const key = clientIdempotencyKey();
    const target = { workOrderId: order.id, action, note: extra.note ?? null, result: extra.result ? JSON.stringify(extra.result) : null };
    try {
      if (!online && action !== "ASSIGN") {
        await enqueue({ kind: "transition", key, target });
        return;
      }
      const result = await api.transition(order.id, { action, ...extra }, key);
      if (result.ok) {
        setDialog(null);
        setMessage({ tone: "success", text: t(`field.actions.done.${action}`) });
        await reload();
      } else if (result.status === 0 && action !== "ASSIGN") {
        await enqueue({ kind: "transition", key, target });
        setDialog(null);
      } else {
        setMessage({ tone: "danger", text: result.code === "WORKORDER_STATE_CONFLICT" ? t("field.errors.stateConflict") : t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
        if (result.code === "WORKORDER_STATE_CONFLICT") await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    const text = comment.trim();
    if (!text) return;
    const result = await api.comment(order.id, text);
    if (result.ok) {
      setOrder((o) => ({ ...o, comments: [...o.comments, result.data] }));
      setComment("");
    } else setMessage({ tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
  };

  const actions = canWrite ? allowedActions(order.status).filter((a) => a !== "ASSIGN" || Boolean(meId)) : [];
  const progress = checklistProgress(order.checklist);
  const overdue = isOverdue(order, now());
  const deviceHref = (id: string) => (compact ? `/m/devices/${encodeURIComponent(id)}` : `/devices/${encodeURIComponent(id)}`);
  const queuedTransition = pendingHere.find((op) => op.kind === "transition");
  const primary: WorkOrderAction | undefined = actions.includes("START") ? "START" : actions.includes("COMPLETE") ? "COMPLETE" : undefined;

  return (
    <div className={cx("flex flex-col gap-4", compact && "pb-36")}>
      {compact && <OfflineBand online={online} pending={snapshot.pending.length} />}
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <WorkOrderStatusBadge status={order.status} />
          <PriorityBadge priority={order.priority} />
          <span className="text-[12.5px] text-muted">{t(`field.types.${order.type}`, { defaultValue: order.type })}</span>
        </div>
        <h1 className="text-[18px] font-semibold">{`#${order.id} ${order.title}`}</h1>
        {order.dueAt && (
          <p className={cx("text-[13px]", overdue ? "font-semibold text-bad-ink" : "text-muted")}>
            {overdue ? t("field.list.overdueAt", { at: formatDateTime(order.dueAt, timezone, i18n.language) }) : t("field.list.dueAt", { at: formatDateTime(order.dueAt, timezone, i18n.language) })}
          </p>
        )}
        {queuedTransition && (
          <p role="status" className="text-[13px] font-semibold text-fair-ink">
            {t("field.offline.pendingAction", { action: t(`field.actions.${String(queuedTransition.target.action)}`) })}
          </p>
        )}
      </header>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card title={t("field.detail.targets")}>
        <ul className="flex flex-col gap-1 text-[13.5px]">
          {order.targets.map((target, i) => (
            <li key={`${target.deviceId ?? ""}-${target.spaceId ?? ""}-${i}`}>
              {target.deviceId ? (
                <Link className="text-accent hover:underline" to={deviceHref(target.deviceId)}>
                  {t("field.detail.device", { id: target.deviceId })}
                </Link>
              ) : (
                <Link className="text-accent hover:underline" to={`/spaces/${encodeURIComponent(String(target.spaceId))}`}>
                  {t("field.detail.space", { id: target.spaceId })}
                </Link>
              )}
            </li>
          ))}
        </ul>
        {order.origin && order.origin !== "MANUAL" && (
          <p className="mt-2 text-[12.5px] text-muted">
            {t("field.detail.origin", { origin: t(`field.origins.${order.origin}`, { defaultValue: order.origin }) })}{" "}
            {order.origin === "ALARM" && order.originRef && /^\d+$/.test(order.originRef) ? (
              <Link className="text-accent hover:underline" to={`/alarms/${order.originRef}`}>
                {`#${order.originRef}`}
              </Link>
            ) : (
              order.originRef
            )}
          </p>
        )}
        {(order.linkedOrigins?.length ?? 0) > 0 && <p className="mt-1 text-[12.5px] text-muted">{t("field.detail.linkedOrigins", { count: order.linkedOrigins?.length ?? 0 })}</p>}
      </Card>

      <Card title={t("field.detail.checklist", { done: progress.done, total: progress.total })}>
        {order.checklist.length === 0 ? (
          <p className="text-[13px] text-muted">{t("field.detail.noChecklist")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {order.checklist.map((item) => (
              <li key={item.id} className={cx(compact && "min-h-11")}>
                <Checkbox label={item.text} checked={item.done} disabled={!canWrite || order.status === "DONE" || order.status === "CANCELLED"} onChange={(e) => void toggle(item.id, e.target.checked)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={t("field.attachments.title", { count: order.attachments.length })}
        actions={canWrite && !compact && <PhotoPicker label={t("field.attachments.add")} accept="image/*,application/pdf" multiple onFiles={(files) => void upload(files)} />}
      >
        {order.attachments.length === 0 && pendingHere.every((op) => op.kind !== "attachment") ? (
          <p className="text-[13px] text-muted">{t("field.attachments.empty")}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {order.attachments.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 text-[11.5px]">
                {a.kind === "PHOTO" ? (
                  <a href={browserUrl(a.url) ?? "#"} target="_blank" rel="noreferrer">
                    <img src={browserUrl(a.url) ?? undefined} alt={a.fileName} className="aspect-square w-full rounded border border-line object-cover" />
                  </a>
                ) : (
                  <a href={browserUrl(a.url) ?? "#"} className="text-accent underline" target="_blank" rel="noreferrer">
                    {a.fileName}
                  </a>
                )}
                {canWrite && !compact && (
                  <button type="button" className="text-left text-bad-ink" aria-label={t("field.attachments.remove", { name: a.fileName })} onClick={() => void removeAttachment(a)}>
                    {t("common.delete")}
                  </button>
                )}
              </li>
            ))}
            {pendingHere
              .filter((op) => op.kind === "attachment")
              .map((op) => (
                <li key={op.id} className="flex aspect-square items-center justify-center rounded border border-dashed border-fair p-1 text-center text-[11.5px] text-fair-ink">
                  {t("field.offline.whenOnline")}
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card title={t("field.comments.title")}>
        <ul className="mb-3 flex flex-col gap-2 text-[13px]">
          {order.comments.map((c) => (
            <li key={c.id}>
              <span className="font-semibold">{c.authorName ?? c.authorId}</span> <span className="text-[11.5px] text-muted">{formatDateTime(c.createdAt, timezone, i18n.language)}</span>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
          {order.comments.length === 0 && <li className="text-muted">{t("field.comments.empty")}</li>}
        </ul>
        {canWrite && (
          <div className="flex items-end gap-2">
            <TextField label={t("field.comments.new")} value={comment} maxLength={2000} disabled={!online} onChange={(e) => setComment(e.target.value)} />
            <Button onClick={() => void addComment()} disabled={!online || !comment.trim()}>
              {t("field.comments.add")}
            </Button>
          </div>
        )}
      </Card>

      {!compact && actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button key={action} variant={action === "CANCEL" ? "danger" : action === primary ? "primary" : "secondary"} disabled={busy} onClick={() => (action === "START" || action === "ASSIGN" ? void transition(action, action === "ASSIGN" ? { assigneeId: meId ?? undefined } : {}) : setDialog(action))}>
              {action === "ASSIGN" ? t("field.actions.assignMe") : t(`field.actions.${action}`)}
            </Button>
          ))}
        </div>
      )}

      {compact && (
        <nav aria-label={t("field.mobile.workActions")} className="fixed inset-x-0 bottom-14 z-30 flex gap-2 border-t border-line bg-panel p-2">
          {onScan && <TouchButton onClick={onScan}>{t("field.mobile.scan")}</TouchButton>}
          {canWrite && <PhotoPicker touch multiple label={t("field.mobile.photo")} disabled={order.status === "DONE" || order.status === "CANCELLED"} onFiles={(files) => void upload(files)} />}
          {primary && (
            <TouchButton variant="primary" disabled={busy || Boolean(queuedTransition)} onClick={() => (primary === "START" ? void transition("START") : setDialog("COMPLETE"))}>
              {t(`field.actions.${primary}`)}
            </TouchButton>
          )}
        </nav>
      )}

      <CompleteDialog open={dialog === "COMPLETE"} type={order.type} busy={busy} onClose={() => setDialog(null)} onSubmit={(result, note) => void transition("COMPLETE", { result, note })} />
      <NoteDialog open={dialog === "CANCEL"} title={t("field.actions.CANCEL")} busy={busy} onClose={() => setDialog(null)} onSubmit={(note) => void transition("CANCEL", { note })} />
    </div>
  );
}

/** 완료 대화상자: 유형별 결과(BR-DEV-22) + 메모 */
export function CompleteDialog({ open, type, busy, onClose, onSubmit }: { open: boolean; type: string; busy?: boolean; onClose: () => void; onSubmit: (result: Record<string, unknown> | undefined, note?: string) => void }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ replacedOn: "", attributeKey: "", attributeValue: "", newDeviceId: "", note: "" });
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const missing = type === "REPLACE" && !values.newDeviceId.trim();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("field.complete.title")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={busy || missing} onClick={() => onSubmit(completionResult(type, values), values.note.trim() || undefined)}>
            {t("field.actions.COMPLETE")}
          </Button>
        </>
      }
    >
      {type === "BATTERY" && <TextField type="date" label={t("field.complete.replacedOn")} value={values.replacedOn} onChange={set("replacedOn")} />}
      {type === "CALIBRATION" && (
        <>
          <TextField label={t("field.complete.attributeKey")} placeholder="tempOffset" value={values.attributeKey} onChange={set("attributeKey")} />
          <TextField label={t("field.complete.attributeValue")} value={values.attributeValue} onChange={set("attributeValue")} />
        </>
      )}
      {type === "REPLACE" && <TextField label={t("field.complete.newDeviceId")} value={values.newDeviceId} onChange={set("newDeviceId")} hint={t("field.complete.newDeviceHint")} />}
      <TextArea label={t("field.complete.note")} value={values.note} maxLength={2000} onChange={set("note")} />
    </Dialog>
  );
}

function NoteDialog({ open, title, busy, onClose, onSubmit }: { open: boolean; title: string; busy?: boolean; onClose: () => void; onSubmit: (note?: string) => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="danger" disabled={busy} onClick={() => onSubmit(note.trim() || undefined)}>
            {title}
          </Button>
        </>
      }
    >
      <TextArea label={t("field.complete.note")} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
    </Dialog>
  );
}

/** 담당자 고르기(목록이 있을 때만) */
export function AssigneeSelect({ users, value, onChange }: { users: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <SelectField label={t("field.create.assignee")} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("field.create.unassigned")}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </SelectField>
  );
}
