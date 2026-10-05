/**
 * UI-ACT-07 자동화 비상 정지(ACT-06.03)와 전역 띠(00-navigation.md §1.3 "유지보수·비상 정지 띠").
 * - [⏻ 자동화 비상 정지]: EMERGENCY_STOP(OPERATOR 이상). 범위(조직 전체 / 공간 + 하위), 사유 1~200자, 확인 입력 "정지"(API-ACT-20)
 * - 붉은 띠: 진행 중인 비상 정지(API-ACT-21 `?active=true`). 해제는 EMERGENCY_RELEASE(ADMIN·INTEGRATOR)만 [해제]
 * - 주황 띠: 진행 중인 유지보수(API-OPS-23 `status=ACTIVE`). 끝내기는 유지보수 권한(DEV_PLACE)에게만 [종료](API-OPS-21)
 * - 다른 사용자의 비상 정지를 5초 안에 보이도록(AT-ACT-09.4) 실시간 구독(API-DSH-20)의 `emergency-stop` 이벤트를 받는다.
 *   core는 토픽과 상관없이 조직의 모든 연결에 이 이벤트를 보내므로 본인 웹 알림 토픽(`notifications`) 하나로 연결한다.
 *   이벤트 {id, state: STARTED|RELEASED, scope, reason, at}: 시작이면 띠를 바로 그리고 목록을 다시 읽어 실행자를 채우고, 해제면 띠를 지운다.
 *   끊겼다가 다시 연결되면 놓친 이벤트가 있을 수 있어 목록을 다시 읽는다
 * - 같은 연결의 `notification`(본인 웹 알림 {id, category, title, link, createdAt, alarmId}, RUL-03.01)은 오른쪽 아래 알림으로 띄운다
 * - 유지보수에는 실시간 토픽이 없어 5초마다 다시 읽는다
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Button, Dialog, TextArea, TextField, cx } from "~/components/ui";
import { bffJson } from "~/lib/bff-client";
import { liveUrl, type StreamEvent } from "~/lib/event-stream";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import { findSpace } from "~/lib/spaces";
import { controlAdminApi, type ControlAdminApi } from "./admin-api";
import { emergencyBody, emergencyProblems, type EmergencyStop, type MaintenanceWindow } from "./model/admin";

/** 유지보수 띠 다시 읽기 주기(비상 정지는 실시간 이벤트로 받는다) */
export const BAND_POLL_MS = 5000;
/** 웹 알림은 최근 것 몇 개만 보여 준다 */
export const MAX_NOTICES = 3;

/** 실시간 `emergency-stop` 이벤트 본문(core LiveHub, EVT-ACT-03). 숫자 ID가 올 수도 있어 문자열로 맞춘다 */
interface EmergencyStopEvent {
  id: string | number;
  state: "STARTED" | "RELEASED" | string;
  scope?: { type?: string; spaceId?: string | number | null; includeChildren?: boolean | null } | null;
  reason?: string | null;
  at?: string | null;
}

/** 실시간 `notification` 이벤트 본문(API-DSH-20 `notifications` 토픽). 읽음 수는 없다 */
export interface WebNotice {
  id: string;
  category: string;
  title?: string | null;
  link?: string | null;
  createdAt?: string | null;
  alarmId?: string | null;
}

const LIVE_EVENTS = ["emergency-stop", "notification"];

function stopFromEvent(event: EmergencyStopEvent): EmergencyStop {
  const scope = event.scope ?? {};
  return {
    emergencyStopId: String(event.id),
    scope: scope.type === "SPACE" ? { type: "SPACE", spaceId: scope.spaceId == null ? undefined : String(scope.spaceId), includeChildren: scope.includeChildren ?? true } : { type: "ORG" },
    reason: event.reason ?? "",
    startedAt: event.at ?? new Date().toISOString(),
    active: true,
  };
}

export interface GlobalBandsProps {
  initialStops: EmergencyStop[];
  initialMaintenance: MaintenanceWindow[];
  spaces?: SpaceNode[];
  canRelease: boolean;
  canEndMaintenance: boolean;
  timezone: string;
  lang: string;
  api?: ControlAdminApi;
  /** 유지보수 다시 읽기 주기. 테스트에서 끈다 */
  pollMs?: number | null;
  /** 바깥(비상 정지 실행 직후)에서 다시 읽으라는 신호 */
  refreshKey?: number;
  /** 실시간 연결을 열지 않는다(로그인 전 등) */
  live?: boolean;
  /** 테스트에서 가짜 EventSource를 넣는다 */
  streamOptions?: UseLiveStreamOptions;
}

function scopeText(t: (k: string, o?: Record<string, unknown>) => string, stop: Pick<EmergencyStop, "scope">, spaces?: SpaceNode[]): string {
  if (stop.scope.type === "ORG") return t("control.emergency.scopeOrg");
  // core는 공간 범위의 spaceId를 JSON 숫자로 줄 수 있다
  const spaceId = stop.scope.spaceId == null ? undefined : String(stop.scope.spaceId);
  const name = findSpace(spaces, spaceId)?.name ?? `#${spaceId ?? ""}`;
  return t("control.emergency.scopeSpace", { name });
}

/** 헤더 아래 전체 폭 띠(비상 정지 빨강, 유지보수 주황) */
export function GlobalBands({
  initialStops,
  initialMaintenance,
  spaces,
  canRelease,
  canEndMaintenance,
  timezone,
  lang,
  api = controlAdminApi,
  pollMs = BAND_POLL_MS,
  refreshKey = 0,
  live = true,
  streamOptions,
}: GlobalBandsProps) {
  const { t } = useTranslation();
  const [stops, setStops] = useState(initialStops);
  const [maintenance, setMaintenance] = useState(initialMaintenance);
  const [releasing, setReleasing] = useState<EmergencyStop | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setStops(initialStops), [initialStops]);
  useEffect(() => setMaintenance(initialMaintenance), [initialMaintenance]);

  const [notices, setNotices] = useState<WebNotice[]>([]);

  const refreshStops = useCallback(async () => {
    const s = await api.activeEmergencyStops();
    if (s.ok) setStops((s.data.responses ?? []).filter((x) => x.active !== false));
  }, [api]);

  const refreshMaintenance = useCallback(async () => {
    const m = await api.activeMaintenance();
    if (m.ok) setMaintenance((m.data.responses ?? []).filter((x) => x.status === "ACTIVE"));
  }, [api]);

  useEffect(() => {
    if (refreshKey > 0) void Promise.all([refreshStops(), refreshMaintenance()]);
  }, [refreshKey, refreshStops, refreshMaintenance]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => void refreshMaintenance(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, refreshMaintenance]);

  const onLiveEvent = useCallback(
    (event: StreamEvent) => {
      if (event.type === "emergency-stop") {
        const data = event.data as EmergencyStopEvent | null;
        if (!data || data.id == null) return;
        const id = String(data.id);
        if (data.state === "RELEASED") {
          setStops((list) => list.filter((s) => s.emergencyStopId !== id));
          setReleasing((current) => (current?.emergencyStopId === id ? null : current));
        } else {
          setStops((list) => (list.some((s) => s.emergencyStopId === id) ? list : [...list, stopFromEvent(data)]));
          // 실행자 이름 등은 목록 조회에만 있다
          void refreshStops();
        }
        return;
      }
      if (event.type === "notification") {
        const data = event.data as WebNotice | null;
        if (!data || data.id == null) return;
        const notice = { ...data, id: String(data.id), alarmId: data.alarmId == null ? null : String(data.alarmId) };
        setNotices((list) => [notice, ...list.filter((n) => n.id !== notice.id)].slice(0, MAX_NOTICES));
      }
    },
    [refreshStops],
  );
  const status = useLiveStream(live ? liveUrl(["notifications"]) : null, LIVE_EVENTS, onLiveEvent, streamOptions ?? {});
  // 다시 연결되면 끊긴 동안 놓친 비상 정지 시작·해제를 목록으로 맞춘다
  const wasRetrying = useRef(false);
  useEffect(() => {
    if (status === "retrying") wasRetrying.current = true;
    else if (status === "open" && wasRetrying.current) {
      wasRetrying.current = false;
      void refreshStops();
    }
  }, [status, refreshStops]);

  const release = async () => {
    if (!releasing) return;
    setError(null);
    const result = await api.releaseEmergencyStop(releasing.emergencyStopId, note.trim() || undefined);
    if (!result.ok) {
      setError(errorText(t, result) ?? null);
      return;
    }
    setStops((list) => list.filter((s) => s.emergencyStopId !== releasing.emergencyStopId));
    setReleasing(null);
    setNote("");
  };

  const endMaintenance = async (id: string) => {
    const result = await bffJson(`/bff/api/core/maintenance-windows/${encodeURIComponent(id)}/end`, { method: "POST", body: {} });
    if (result.ok) setMaintenance((list) => list.filter((m) => m.id !== id));
    else setError(errorText(t, result) ?? null);
  };

  const noticeList = <NoticeList notices={notices} timezone={timezone} lang={lang} onDismiss={(id) => setNotices((list) => list.filter((n) => n.id !== id))} />;
  if (stops.length === 0 && maintenance.length === 0 && !error) return noticeList;
  return (
    <div aria-live="polite">
      {noticeList}
      {stops.map((stop) => (
        <div key={stop.emergencyStopId} role="alert" className="border-b border-bad bg-bad px-4 py-2 text-[13px] text-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <span>
              {t("control.emergency.band", {
                scope: scopeText(t, stop, spaces),
                user: stop.startedBy?.name ?? stop.startedBy?.userId ?? "",
                at: formatDateTime(stop.startedAt, timezone, lang),
                reason: stop.reason,
              })}
            </span>
            {canRelease && (
              <button type="button" className="rounded border border-white px-2 py-0.5 font-medium" onClick={() => setReleasing(stop)}>
                {t("control.emergency.release")}
              </button>
            )}
          </div>
        </div>
      ))}
      {maintenance.map((m) => (
        <div key={m.id} role="status" className="border-b border-fair bg-fair-soft px-4 py-2 text-[13px] text-text">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <span>
              {t("control.maintenance.band", {
                target: m.targetName ?? `#${m.targetId}`,
                until: m.endsAt ? formatDateTime(m.endsAt, timezone, lang) : t("control.maintenance.noEnd"),
                reason: m.reason ?? "",
              })}
            </span>
            {canEndMaintenance && (
              <button type="button" className="rounded border border-fair px-2 py-0.5 font-medium" onClick={() => void endMaintenance(m.id)}>
                {t("control.maintenance.end")}
              </button>
            )}
          </div>
        </div>
      ))}
      {error && !releasing && (
        <div className="mx-auto max-w-7xl px-4 pt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <Dialog
        title={t("control.emergency.releaseTitle")}
        open={Boolean(releasing)}
        onClose={() => setReleasing(null)}
        footer={
          <>
            <Button onClick={() => setReleasing(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void release()}>
              {t("control.emergency.release")}
            </Button>
          </>
        }
      >
        {releasing && <p className="text-[13px]">{t("control.emergency.releaseBody", { scope: scopeText(t, releasing, spaces) })}</p>}
        <TextArea label={t("control.emergency.releaseNote")} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        {error && <Alert tone="danger">{error}</Alert>}
      </Dialog>
    </div>
  );
}

/** 본인 웹 알림(오른쪽 아래). 링크가 있으면 [열기]로 그 화면에 간다 */
function NoticeList({ notices, timezone, lang, onDismiss }: { notices: WebNotice[]; timezone: string; lang: string; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  if (notices.length === 0) return null;
  return (
    <ul aria-label={t("control.notice.title")} className="fixed bottom-4 right-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {notices.map((n) => (
        <li key={n.id} role="status" data-notice={n.id} className="rounded-md border border-line bg-panel px-3 py-2 text-[13px] shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] text-muted">
                {t("control.notice.title")}
                {n.createdAt ? ` · ${formatDateTime(n.createdAt, timezone, lang)}` : ""}
              </p>
              <p className="truncate font-medium">{n.title ?? (n.alarmId ? `#${n.alarmId}` : n.category)}</p>
            </div>
            <button type="button" className="text-muted" aria-label={t("control.notice.dismiss")} onClick={() => onDismiss(n.id)}>
              ×
            </button>
          </div>
          {n.link && n.link.startsWith("/") && !n.link.startsWith("//") && (
            <Link className="text-[12.5px] text-accent" to={n.link} onClick={() => onDismiss(n.id)}>
              {t("control.notice.open")}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** [⏻ 자동화 비상 정지] 버튼과 실행 대화상자 */
export function EmergencyStopButton({
  api = controlAdminApi,
  loadSpaces,
  onStarted,
  compact = false,
}: {
  api?: ControlAdminApi;
  loadSpaces?: () => Promise<SpaceNode[]>;
  onStarted?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState<"ORG" | "SPACE">("ORG");
  const [spaceId, setSpaceId] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [spaces, setSpaces] = useState<SpaceNode[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmWord = t("control.emergency.confirmWord");
  const problems = emergencyProblems({ scopeType, spaceId, reason, confirm, confirmWord });

  const openDialog = async () => {
    setOpen(true);
    setError(null);
    setSubmitted(false);
    const load =
      loadSpaces ??
      (async () => {
        const result = await bffJson<SpaceNode[]>("/bff/api/core/spaces");
        return result.ok ? (result.data ?? []) : [];
      });
    setSpaces(await load());
  };

  const submit = async () => {
    setSubmitted(true);
    if (problems.length > 0 || busy) return;
    setBusy(true);
    const result = await api.startEmergencyStop(emergencyBody(scopeType, spaceId || undefined, reason));
    setBusy(false);
    if (!result.ok) {
      setError(errorText(t, result) ?? null);
      return;
    }
    setOpen(false);
    setReason("");
    setConfirm("");
    onStarted?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        className={cx("rounded-md border border-bad px-2 py-1 text-[12.5px] font-medium text-bad-ink hover:bg-bad-soft", compact && "px-1.5")}
        aria-label={t("control.emergency.button")}
      >
        ⏻ {compact ? "" : t("control.emergency.button")}
      </button>
      <Dialog
        title={t("control.emergency.title")}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void submit()}>
              {t("control.emergency.start")}
            </Button>
          </>
        }
      >
        <fieldset className="flex flex-wrap items-center gap-3 text-[13px]">
          <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("control.emergency.scope")}</legend>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="es-scope" checked={scopeType === "ORG"} onChange={() => setScopeType("ORG")} />
            {t("control.emergency.scopeOrg")}
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="es-scope" checked={scopeType === "SPACE"} onChange={() => setScopeType("SPACE")} />
            {t("control.emergency.scopeSpaceOption")}
          </label>
        </fieldset>
        {scopeType === "SPACE" && (
          <SpaceSelect
            spaces={spaces}
            label={t("control.emergency.space")}
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            error={submitted && problems.includes("space") ? t("control.emergency.spaceRequired") : undefined}
          />
        )}
        <TextField
          label={t("control.emergency.reason")}
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          error={submitted && problems.includes("reason") ? t("control.emergency.reasonRequired") : undefined}
        />
        <TextField
          label={t("control.emergency.confirmLabel", { word: confirmWord })}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={submitted && problems.includes("confirm") ? t("control.emergency.confirmMismatch", { word: confirmWord }) : undefined}
        />
        <p className="text-[12.5px] text-muted">{t("control.emergency.manualStillAllowed")}</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </Dialog>
    </>
  );
}
