/**
 * 실패 메시지 개별 목록(UI-ING-04): 체크 선택, [선택 재처리]·[폐기](사유 2~200자) — 재처리·폐기 권한(INGEST_REPROCESS)이 있을 때만,
 * 항목을 누르면 원본 상세 패널(UI-ING-03).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button, CsrfField, Dialog, Table, TextArea } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { RawMessagePanel, SelectionNotice, type RawMessageDetail } from "./failures-panels";
import { checkDiscardReason, reprocessProblem } from "./model/ingest";
import type { BffJsonResult } from "~/lib/bff-client";

export interface FailureItem {
  id: string;
  rawMessageId?: string | null;
  stage: string;
  errorCode: string;
  errorMessage?: string | null;
  attempts?: number;
  status: string;
  sourceId?: string | null;
  sourceName?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
  createdAt?: string;
  lockedBy?: string | null;
}

export function FailureItems({
  items,
  canReprocess,
  timezone,
  idempotencyKey,
  loadRaw,
}: {
  items: FailureItem[];
  canReprocess: boolean;
  timezone: string;
  idempotencyKey: string;
  loadRaw?: (id: string) => Promise<BffJsonResult<RawMessageDetail>>;
}) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const allSelectable = items.filter((i) => i.status === "OPEN").map((i) => i.id);
  const problem = reprocessProblem(selected.length);
  const reasonOk = checkDiscardReason(reason);
  return (
    <div className="flex flex-col gap-3">
      <Form method="post" className="flex flex-col gap-2">
        <CsrfField />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        {selected.map((id) => (
          <input key={id} type="hidden" name="dlqItemId" value={id} />
        ))}
        <Table>
          <thead>
            <tr>
              {canReprocess && (
                <th>
                  <input
                    type="checkbox"
                    aria-label={t("ingest.failures.selectAll")}
                    checked={allSelectable.length > 0 && allSelectable.every((id) => selected.includes(id))}
                    onChange={(e) => setSelected(e.target.checked ? allSelectable : [])}
                  />
                </th>
              )}
              <th>{t("ingest.failures.failedAt")}</th>
              <th>{t("ingest.failures.source")}</th>
              <th>{t("ingest.failures.device")}</th>
              <th>{t("ingest.failures.errorCode")}</th>
              <th>{t("ingest.failures.errorMessage")}</th>
              <th>{t("ingest.failures.attempts")}</th>
              <th>{t("ingest.failures.status")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} data-item={item.id}>
                {canReprocess && (
                  <td>
                    <input type="checkbox" aria-label={t("ingest.failures.selectItem", { id: item.id })} disabled={item.status !== "OPEN"} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
                  </td>
                )}
                <td className="font-mono">
                  {item.rawMessageId ? (
                    <button type="button" className="text-accent hover:underline" onClick={() => setRaw(String(item.rawMessageId))}>
                      {formatDateTime(item.createdAt, timezone, i18n.language, true)}
                    </button>
                  ) : (
                    formatDateTime(item.createdAt, timezone, i18n.language, true)
                  )}
                </td>
                <td>{item.sourceName ?? item.sourceId ?? "–"}</td>
                <td>{item.deviceName ?? item.deviceId ?? t("ingest.failures.unidentified")}</td>
                <td className="font-mono">{item.errorCode}</td>
                <td className="max-w-[280px] truncate">{item.errorMessage ?? "–"}</td>
                <td>{item.attempts ?? 0}</td>
                <td>
                  {t(`ingest.failures.itemStatus.${item.status}`, { defaultValue: item.status })}
                  {item.lockedBy && <span className="ml-1 text-[11.5px] text-fair-ink">{t("ingest.failures.locked")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {canReprocess && (
          <div className="flex flex-wrap items-center gap-2">
            <SelectionNotice count={selected.length} />
            <Button type="submit" name="intent" value="reprocess" variant="primary" disabled={problem !== undefined}>
              {t("ingest.failures.reprocessSelected")}
            </Button>
            <Button variant="danger" disabled={problem !== undefined} onClick={() => setDiscardOpen(true)}>
              {t("ingest.failures.discard")}
            </Button>
          </div>
        )}
      </Form>
      <Dialog
        title={t("ingest.failures.discardTitle")}
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        footer={
          <Form method="post" onSubmit={(e) => (!reasonOk ? (e.preventDefault(), setTouched(true)) : setDiscardOpen(false))}>
            <CsrfField />
            <input type="hidden" name="intent" value="discard" />
            <input type="hidden" name="reason" value={reason} />
            {selected.map((id) => (
              <input key={id} type="hidden" name="dlqItemId" value={id} />
            ))}
            <Button type="submit" variant="danger">
              {t("ingest.failures.discardConfirm", { n: selected.length })}
            </Button>
          </Form>
        }
      >
        <p className="text-[13px]">{t("ingest.failures.discardBody", { n: selected.length })}</p>
        <TextArea label={t("ingest.failures.reason")} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} error={touched && !reasonOk ? t("ingest.failures.reasonRequired") : undefined} />
      </Dialog>
      {raw && <RawMessagePanel rawMessageId={raw} timezone={timezone} onClose={() => setRaw(null)} load={loadRaw} />}
    </div>
  );
}
