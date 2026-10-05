/**
 * 작업 지시 목록(UI-DEV-13, DEV-08.06): 보기 전환(내 작업·전체·마감 임박·지연), 통계 카드(열린 건수·지연 건수·평균 처리 시간),
 * 컬럼(제목·유형·우선순위·대상·담당자·마감·상태·출처). 모바일(`compact`)은 카드 목록. [+ 새 작업 지시] 대화상자(API-DEV-90).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Button, Card, Checkbox, Dialog, EmptyState, SelectField, Table, TextArea, TextField, cx } from "~/components/ui";
import { clientIdempotencyKey } from "~/lib/bff-client";
import { formatDateTime, formatNumber } from "~/lib/format";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import { fieldApi, type FieldApi } from "../api";
import {
  MAX_TITLE,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_TYPES,
  WORK_ORDER_VIEWS,
  checkWorkOrderInput,
  checklistLines,
  isDueSoon,
  isOverdue,
  targetDeviceIds,
  workOrderBody,
  type WorkOrder,
  type WorkOrderInput,
  type WorkOrderView,
} from "../model/work-orders";
import { PriorityBadge, WorkOrderStatusBadge } from "./common";

export interface WorkOrderCounts {
  open?: number | null;
  dueSoon?: number | null;
  overdue?: number | null;
}

export function WorkOrderViewTabs({ view, counts, base, spaceId }: { view: WorkOrderView; counts: WorkOrderCounts; base: string; spaceId?: string | null }) {
  const { t } = useTranslation();
  const suffix = spaceId ? `&spaceId=${encodeURIComponent(spaceId)}` : "";
  return (
    <nav aria-label={t("field.list.views")} className="mb-3 flex gap-1 overflow-x-auto border-b border-line">
      {WORK_ORDER_VIEWS.map((v) => {
        const n = v === "dueSoon" ? counts.dueSoon : v === "overdue" ? counts.overdue : undefined;
        return (
          <Link
            key={v}
            to={`${base}?view=${v}${suffix}`}
            aria-current={v === view ? "page" : undefined}
            className={cx("min-h-11 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px]", v === view ? "border-accent font-semibold text-accent" : "border-transparent text-muted")}
          >
            {t(`field.views.${v}`)}
            {n !== undefined && n !== null && ` (${n})`}
          </Link>
        );
      })}
    </nav>
  );
}

export function WorkOrderStats({ counts, avgLeadTimeHours, lang }: { counts: WorkOrderCounts; avgLeadTimeHours?: number | null; lang: string }) {
  const { t } = useTranslation();
  return (
    <p className="mb-3 text-[13px] text-muted" data-testid="work-order-stats">
      {t("field.list.stats", {
        open: counts.open ?? "–",
        overdue: counts.overdue ?? "–",
        hours: avgLeadTimeHours === null || avgLeadTimeHours === undefined ? "–" : formatNumber(avgLeadTimeHours, lang, { precision: 1 }),
      })}
    </p>
  );
}

export interface WorkOrderTableProps {
  orders: WorkOrder[];
  timezone: string;
  nowMs: number;
  deviceNames?: Record<string, string>;
  compact?: boolean;
  base?: string;
  emptyText?: string;
}

export function WorkOrderTable({ orders, timezone, nowMs, deviceNames = {}, compact = false, base = "/work-orders", emptyText }: WorkOrderTableProps) {
  const { t, i18n } = useTranslation();
  if (orders.length === 0) return <EmptyState title={emptyText ?? t("field.list.empty")} />;
  const target = (o: WorkOrder) => {
    const devices = targetDeviceIds(o);
    if (devices.length === 1) return deviceNames[devices[0]] ?? t("field.detail.device", { id: devices[0] });
    if (devices.length > 1) return t("field.list.deviceCount", { count: devices.length });
    return t("field.list.spaceCount", { count: o.targets.length });
  };
  const due = (o: WorkOrder) =>
    o.dueAt ? (
      <span className={cx(isOverdue(o, nowMs) && "font-semibold text-bad-ink", isDueSoon(o, nowMs) && "font-semibold text-fair-ink")}>
        {formatDateTime(o.dueAt, timezone, i18n.language)}
        {isOverdue(o, nowMs) && ` · ${t("field.views.overdue")}`}
      </span>
    ) : (
      "–"
    );
  if (compact) {
    return (
      <ul className="flex flex-col gap-2">
        {orders.map((o) => (
          <li key={o.id}>
            <Link to={`${base}/${encodeURIComponent(o.id)}`} className="block min-h-11 rounded-lg border border-line bg-panel p-3">
              <div className="flex items-center gap-2">
                <WorkOrderStatusBadge status={o.status} />
                <PriorityBadge priority={o.priority} />
              </div>
              <p className="mt-1 font-semibold">{o.title}</p>
              <p className="text-[12.5px] text-muted">
                {target(o)} · {due(o)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table>
      <thead>
        <tr>
          <th>{t("field.list.title")}</th>
          <th>{t("field.list.type")}</th>
          <th>{t("field.list.priority")}</th>
          <th>{t("field.list.target")}</th>
          <th>{t("field.list.assignee")}</th>
          <th>{t("field.list.due")}</th>
          <th>{t("field.list.status")}</th>
          <th>{t("field.list.origin")}</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td>
              <Link to={`${base}/${encodeURIComponent(o.id)}`} className="text-accent hover:underline">
                {o.title}
              </Link>
            </td>
            <td>{t(`field.types.${o.type}`, { defaultValue: o.type })}</td>
            <td>
              <PriorityBadge priority={o.priority} />
            </td>
            <td>{target(o)}</td>
            <td>{o.assigneeId ? t("field.list.user", { id: o.assigneeId }) : t("field.create.unassigned")}</td>
            <td>{due(o)}</td>
            <td>
              <WorkOrderStatusBadge status={o.status} />
            </td>
            <td>{t(`field.origins.${o.origin ?? "MANUAL"}`, { defaultValue: o.origin ?? "" })}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export interface CreateWorkOrderDialogProps {
  open: boolean;
  onClose: () => void;
  devices: { id: string; name: string }[];
  spaces: SpaceNode[];
  defaultDeviceIds?: string[];
  meId?: string | null;
  api?: FieldApi;
  now?: () => number;
  onCreated: (order: WorkOrder) => void;
}

const EMPTY: WorkOrderInput = { title: "", type: "INSPECTION", priority: "NORMAL", deviceIds: [], spaceIds: [], assigneeId: "", dueAt: "", checklist: "" };

/** 새 작업 지시(API-DEV-90). 같은 출처의 열린 작업에 연결되면 "기존 작업 지시에 추가되었습니다" */
export function CreateWorkOrderDialog({ open, onClose, devices, spaces, defaultDeviceIds = [], meId, api = fieldApi, now = Date.now, onCreated }: CreateWorkOrderDialogProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState<WorkOrderInput>({ ...EMPTY, deviceIds: defaultDeviceIds });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [key] = useState(() => clientIdempotencyKey());
  const flat = useMemo(() => flattenSpaces(spaces), [spaces]);
  const shown = devices.filter((d) => !filter || d.name.toLowerCase().includes(filter.toLowerCase()) || input.deviceIds.includes(d.id)).slice(0, 50);
  const toggle = (list: "deviceIds" | "spaceIds", id: string, on: boolean) => setInput((v) => ({ ...v, [list]: on ? [...v[list], id] : v[list].filter((x) => x !== id) }));
  const submit = async () => {
    const found = checkWorkOrderInput(input, now());
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    const result = await api.createWorkOrder(workOrderBody(input), key);
    setBusy(false);
    if (result.ok) {
      onCreated(result.data);
      return;
    }
    setFailure(t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }));
  };
  const err = (field: string) => (errors[field] ? t(`field.validation.${field}.${errors[field]}`) : undefined);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("field.create.title")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {t("field.create.submit")}
          </Button>
        </>
      }
    >
      {failure && <Alert tone="danger">{failure}</Alert>}
      <TextField label={t("field.create.titleLabel")} value={input.title} maxLength={MAX_TITLE + 10} error={err("title")} onChange={(e) => setInput((v) => ({ ...v, title: e.target.value }))} />
      <div className="grid grid-cols-2 gap-2">
        <SelectField label={t("field.list.type")} value={input.type} onChange={(e) => setInput((v) => ({ ...v, type: e.target.value }))}>
          {WORK_ORDER_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`field.types.${type}`)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("field.list.priority")} value={input.priority} onChange={(e) => setInput((v) => ({ ...v, priority: e.target.value }))}>
          {WORK_ORDER_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`field.priority.${p}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[12.5px] text-muted">{t("field.create.targets")}</legend>
        <TextField label={t("field.create.deviceFilter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-36 overflow-y-auto rounded border border-line p-2">
          {shown.map((d) => (
            <Checkbox key={d.id} label={d.name} checked={input.deviceIds.includes(d.id)} onChange={(e) => toggle("deviceIds", d.id, e.target.checked)} />
          ))}
          {shown.length === 0 && <p className="text-[12px] text-muted">{t("field.create.noDevices")}</p>}
        </div>
        <SelectField label={t("field.create.space")} value={input.spaceIds[0] ?? ""} onChange={(e) => setInput((v) => ({ ...v, spaceIds: e.target.value ? [e.target.value] : [] }))}>
          <option value="">{t("field.create.noSpace")}</option>
          {flat.map((s) => (
            <option key={s.id} value={s.id}>
              {`${"  ".repeat(s.depth - 1)}${s.name}`}
            </option>
          ))}
        </SelectField>
        {err("targets") && (
          <p role="alert" className="text-[12px] text-bad-ink">
            {err("targets")}
          </p>
        )}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <TextField type="datetime-local" label={t("field.list.due")} value={input.dueAt} error={err("dueAt")} onChange={(e) => setInput((v) => ({ ...v, dueAt: e.target.value }))} />
        <SelectField label={t("field.create.assignee")} value={input.assigneeId} onChange={(e) => setInput((v) => ({ ...v, assigneeId: e.target.value }))}>
          <option value="">{t("field.create.unassigned")}</option>
          {meId && <option value={meId}>{t("field.create.me")}</option>}
        </SelectField>
      </div>
      <TextArea label={t("field.create.checklist", { count: checklistLines(input.checklist).length })} value={input.checklist} error={err("checklist")} onChange={(e) => setInput((v) => ({ ...v, checklist: e.target.value }))} />
    </Dialog>
  );
}

/** 목록 화면의 [+ 새 작업 지시] 버튼과 대화상자 */
export function NewWorkOrderButton(props: Omit<CreateWorkOrderDialogProps, "open" | "onClose">) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {t("field.create.open")}
      </Button>
      {open && <CreateWorkOrderDialog {...props} open onClose={() => setOpen(false)} />}
    </>
  );
}

/** 목록 위 공간 필터(하위 공간 포함, DEV-08.06) */
export function SpaceFilter({ spaces, value, onChange }: { spaces: SpaceNode[]; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const flat = useMemo(() => flattenSpaces(spaces), [spaces]);
  return (
    <Card className="mb-3">
      <SelectField label={t("field.list.spaceFilter")} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("field.list.allSpaces")}</option>
        {flat.map((s) => (
          <option key={s.id} value={s.id}>
            {`${"  ".repeat(s.depth - 1)}${s.name}`}
          </option>
        ))}
      </SelectField>
    </Card>
  );
}
