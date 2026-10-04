/**
 * 모바일 셸(UI-DSH-14, DSH-13.04): 하단 탭(알람·공간·작업·내 알림·QR), 상단 오프라인 띠. 360px 화면에서 버튼은 44px 이상(AT-DSH-16.1).
 * 모바일 기기 상세(UI-DEV-17): 이름·연결 상태·마지막 수신·배터리·현재값·최근 알람·열린 작업 지시, [작업 시작]·[사진 올리기](OPERATOR 이상).
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";
import { useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Alert, Card, EmptyState, StatusDot, cx } from "~/components/ui";
import { clientIdempotencyKey } from "~/lib/bff-client";
import { liveUrl, type StreamEvent } from "~/lib/event-stream";
import { formatDateTime, formatNumber, formatRelative } from "~/lib/format";
import { fieldApi, type FieldApi, type FieldDevice } from "../api";
import { useOnline, useQueue } from "../hooks";
import { allowedActions, checkAttachment, type WorkOrder } from "../model/work-orders";
import { OfflineBand, PhotoPicker, TouchButton, WorkOrderStatusBadge } from "./common";

export const MOBILE_TABS = [
  { key: "alarms", to: "/m/alarms", icon: "🔔" },
  { key: "spaces", to: "/m/spaces", icon: "🏢" },
  { key: "work", to: "/m/work-orders", icon: "🛠" },
  { key: "notifications", to: "/m/notifications", icon: "✉" },
  { key: "scan", to: "/m/scan", icon: "▣" },
] as const;

export function MobileShell({ title, children }: { title?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  const online = useOnline();
  const { snapshot } = useQueue();
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col bg-bg">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-panel px-4 py-2">
        <span className="text-[15px] font-semibold">{title ?? "data2flow"}</span>
        <Link to="/" className="text-[12.5px] text-muted">
          {t("field.mobile.desktop")}
        </Link>
      </header>
      <OfflineBand online={online} pending={snapshot.pending.length} />
      <main className="flex-1 px-3 py-3 pb-20">{children}</main>
      <nav aria-label={t("field.mobile.tabs")} className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-14 max-w-xl border-t border-line bg-panel">
        {MOBILE_TABS.map((tab) => (
          <NavLink key={tab.key} to={tab.to} className={({ isActive }) => cx("flex min-h-11 flex-1 flex-col items-center justify-center text-[11px]", isActive ? "font-semibold text-accent" : "text-muted")}>
            <span aria-hidden>{tab.icon}</span>
            {t(`field.mobile.tab.${tab.key}`)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export interface MobileAlarm {
  id: string;
  severity: string;
  status: string;
  title: string;
  raisedAt: string;
}

export interface MobileDeviceProps {
  device: FieldDevice;
  orders: WorkOrder[];
  alarms: MobileAlarm[];
  canWrite: boolean;
  timezone: string;
  now?: () => number;
  api?: FieldApi;
}

/** QR로 연 모바일 기기 상세(UI-DEV-17, AT-DSH-16.2) */
export function MobileDevice({ device, orders: initialOrders, alarms, canWrite, timezone, now = Date.now, api = fieldApi }: MobileDeviceProps) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const { queue } = useQueue();
  const [orders, setOrders] = useState(initialOrders);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const lang = i18n.language;
  const connectivity = device.state?.connectivity ?? "UNKNOWN";
  const first = orders[0];

  const start = async (order: WorkOrder) => {
    const result = await api.transition(order.id, { action: "START" }, clientIdempotencyKey());
    if (result.ok) {
      setOrders((list) => list.map((o) => (o.id === order.id ? result.data : o)));
      setMessage({ tone: "success", text: t("field.actions.done.START") });
    } else setMessage({ tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
  };

  const upload = async (order: WorkOrder, files: File[]) => {
    for (const file of files) {
      const invalid = checkAttachment(file);
      if (invalid) return setMessage({ tone: "danger", text: t(`field.attachments.invalid.${invalid}`) });
      const key = clientIdempotencyKey();
      if (!online && queue) {
        await queue.enqueue({ id: clientIdempotencyKey(), kind: "attachment", label: order.title, createdAt: now(), key, target: { workOrderId: order.id }, files: [{ blob: file, name: file.name }] });
        setMessage({ tone: "info", text: t("field.offline.queued") });
        continue;
      }
      const result = await api.attach(order.id, file, file.name, key);
      setMessage(result.ok ? { tone: "success", text: t("field.attachments.uploaded") } : { tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-16">
      <header>
        <h1 className="text-[18px] font-semibold">{device.name}</h1>
        <p className="text-[12.5px] text-muted">{device.space?.path?.join(" › ") ?? device.space?.name ?? ""}</p>
      </header>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Card>
        <dl className="grid grid-cols-2 gap-2 text-[13px]">
          <dt className="text-muted">{t("field.device.connectivity")}</dt>
          <dd>
            <StatusDot tone={connectivity === "ONLINE" ? "good" : connectivity === "OFFLINE" ? "bad" : "muted"} label={t(`field.device.conn.${connectivity}`, { defaultValue: connectivity })} />
          </dd>
          <dt className="text-muted">{t("field.device.lastSeen")}</dt>
          <dd>{device.state?.lastSeenAt ? formatRelative(device.state.lastSeenAt, now(), lang) : "–"}</dd>
          <dt className="text-muted">{t("field.device.battery")}</dt>
          <dd>{device.state?.battery === null || device.state?.battery === undefined ? "–" : `${formatNumber(device.state.battery, lang, { precision: 0 })}%`}</dd>
        </dl>
      </Card>
      <Card title={t("field.device.latest")}>
        {(device.latest ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">{t("field.device.noLatest")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {(device.latest ?? []).map((m) => (
              <li key={m.metricKey} className="rounded border border-line p-2">
                <p className="text-[12px] text-muted">{m.displayName ?? m.metricKey}</p>
                <p className="font-mono text-[17px]">{`${typeof m.value === "number" ? formatNumber(m.value, lang) : String(m.value ?? "–")}${m.unit ?? ""}`}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("field.device.alarms")}>
        {alarms.length === 0 ? (
          <p className="text-[13px] text-muted">{t("field.device.noAlarms")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {alarms.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link to={`/alarms/${encodeURIComponent(a.id)}`} className="text-accent">
                  {`[${t(`field.severity.${a.severity}`, { defaultValue: a.severity })}] ${a.title}`}
                </Link>{" "}
                <span className="text-[11.5px] text-muted">{formatDateTime(a.raisedAt, timezone, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("field.device.openOrders", { count: orders.length })}>
        {orders.length === 0 ? (
          <p className="text-[13px] text-muted">{t("field.device.noOrders")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2">
                <Link to={`/m/work-orders/${encodeURIComponent(o.id)}`} className="min-h-11 flex-1 py-2 text-accent">
                  {o.title}
                </Link>
                <WorkOrderStatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canWrite && first && (
        <nav aria-label={t("field.mobile.workActions")} className="fixed inset-x-0 bottom-14 z-30 mx-auto flex max-w-xl gap-2 border-t border-line bg-panel p-2">
          {allowedActions(first.status).includes("START") && <TouchButton variant="primary" onClick={() => void start(first)}>{t("field.actions.START")}</TouchButton>}
          <PhotoPicker touch label={t("field.mobile.photo")} onFiles={(files) => void upload(first, files)} />
        </nav>
      )}
    </div>
  );
}

export interface LiveNotification {
  id: string;
  title: string;
  body?: string | null;
  link?: string | null;
  severity?: string | null;
  at: string;
}

/** 내 알림(이 연결에서 받은 웹 알림, `notifications` 토픽). 읽음 수 개념은 없다(M4 웹 알림과 같음) */
export function MobileNotifications({ timezone, live }: { timezone: string; live?: UseLiveStreamOptions }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<LiveNotification[]>([]);
  useLiveStream(liveUrl(["notifications"]), ["notification"], (event: StreamEvent) => {
    const data = (event.data ?? {}) as Partial<LiveNotification> & { notificationId?: string; message?: string; createdAt?: string };
    const item: LiveNotification = {
      id: String(data.id ?? data.notificationId ?? `${Date.now()}`),
      title: String(data.title ?? data.message ?? ""),
      body: data.body ?? null,
      link: data.link ?? null,
      severity: data.severity ?? null,
      at: String(data.at ?? data.createdAt ?? new Date().toISOString()),
    };
    setItems((list) => [item, ...list.filter((n) => n.id !== item.id)].slice(0, 50));
  }, live);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-muted">
        {t("field.notifications.hint")}{" "}
        <Link to="/me/notifications" className="text-accent">
          {t("field.notifications.settings")}
        </Link>
      </p>
      {items.length === 0 ? (
        <EmptyState title={t("field.notifications.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <li key={n.id} className="rounded-lg border border-line bg-panel p-3">
              {n.link ? (
                <Link to={n.link} className="font-semibold text-accent">
                  {n.title}
                </Link>
              ) : (
                <p className="font-semibold">{n.title}</p>
              )}
              {n.body && <p className="text-[13px]">{n.body}</p>}
              <p className="text-[11.5px] text-muted">{formatDateTime(n.at, timezone, i18n.language)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
