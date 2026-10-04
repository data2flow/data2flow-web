/**
 * UI-ACT-07 자동화 비상 정지(ACT-06.03)와 전역 띠(00-navigation.md §1.3 "유지보수·비상 정지 띠").
 * - [⏻ 자동화 비상 정지]: EMERGENCY_STOP(OPERATOR 이상). 범위(조직 전체 / 공간 + 하위), 사유 1~200자, 확인 입력 "정지"(API-ACT-20)
 * - 붉은 띠: 진행 중인 비상 정지(API-ACT-21 `?active=true`). 해제는 EMERGENCY_RELEASE(ADMIN·INTEGRATOR)만 [해제]
 * - 주황 띠: 진행 중인 유지보수(API-OPS-23 `status=ACTIVE`). 끝내기는 유지보수 권한(DEV_PLACE)에게만 [종료](API-OPS-21)
 * - 다른 사용자의 비상 정지를 5초 안에 보이도록(AT-ACT-09.4) 5초마다 다시 읽는다. API-DSH-20에 비상 정지 토픽이 없어 SSE 대신 조회한다
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Button, Dialog, TextArea, TextField, cx } from "~/components/ui";
import { bffJson } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import { findSpace } from "~/lib/spaces";
import { controlAdminApi, type ControlAdminApi } from "./admin-api";
import { emergencyBody, emergencyProblems, type EmergencyStop, type MaintenanceWindow } from "./model/admin";

export const BAND_POLL_MS = 5000;

export interface GlobalBandsProps {
  initialStops: EmergencyStop[];
  initialMaintenance: MaintenanceWindow[];
  spaces?: SpaceNode[];
  canRelease: boolean;
  canEndMaintenance: boolean;
  timezone: string;
  lang: string;
  api?: ControlAdminApi;
  /** 테스트에서 끈다 */
  pollMs?: number | null;
  /** 바깥(비상 정지 실행 직후)에서 다시 읽으라는 신호 */
  refreshKey?: number;
}

function scopeText(t: (k: string, o?: Record<string, unknown>) => string, stop: Pick<EmergencyStop, "scope">, spaces?: SpaceNode[]): string {
  if (stop.scope.type === "ORG") return t("control.emergency.scopeOrg");
  const name = findSpace(spaces, stop.scope.spaceId)?.name ?? `#${stop.scope.spaceId ?? ""}`;
  return t("control.emergency.scopeSpace", { name });
}

/** 헤더 아래 전체 폭 띠(비상 정지 빨강, 유지보수 주황) */
export function GlobalBands({ initialStops, initialMaintenance, spaces, canRelease, canEndMaintenance, timezone, lang, api = controlAdminApi, pollMs = BAND_POLL_MS, refreshKey = 0 }: GlobalBandsProps) {
  const { t } = useTranslation();
  const [stops, setStops] = useState(initialStops);
  const [maintenance, setMaintenance] = useState(initialMaintenance);
  const [releasing, setReleasing] = useState<EmergencyStop | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setStops(initialStops), [initialStops]);
  useEffect(() => setMaintenance(initialMaintenance), [initialMaintenance]);

  const refresh = useCallback(async () => {
    const [s, m] = await Promise.all([api.activeEmergencyStops(), api.activeMaintenance()]);
    if (s.ok) setStops((s.data.responses ?? []).filter((x) => x.active !== false));
    if (m.ok) setMaintenance((m.data.responses ?? []).filter((x) => x.status === "ACTIVE"));
  }, [api]);

  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refreshKey, refresh]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, refresh]);

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

  if (stops.length === 0 && maintenance.length === 0 && !error) return null;
  return (
    <div aria-live="polite">
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
        <div key={m.id} role="status" className="border-b border-warn bg-warn-soft px-4 py-2 text-[13px] text-text">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <span>
              {t("control.maintenance.band", {
                target: m.targetName ?? `#${m.targetId}`,
                until: m.endsAt ? formatDateTime(m.endsAt, timezone, lang) : t("control.maintenance.noEnd"),
                reason: m.reason ?? "",
              })}
            </span>
            {canEndMaintenance && (
              <button type="button" className="rounded border border-warn px-2 py-0.5 font-medium" onClick={() => void endMaintenance(m.id)}>
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

/** [⏻ 자동화 비상 정지] 버튼과 실행 대화상자 */
export function EmergencyStopButton({ api = controlAdminApi, loadSpaces, onStarted, compact = false }: { api?: ControlAdminApi; loadSpaces?: () => Promise<SpaceNode[]>; onStarted?: () => void; compact?: boolean }) {
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
      <button type="button" onClick={() => void openDialog()} className={cx("rounded-md border border-bad px-2 py-1 text-[12.5px] font-medium text-bad hover:bg-bad-soft", compact && "px-1.5")} aria-label={t("control.emergency.button")}>
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
          <SpaceSelect spaces={spaces} label={t("control.emergency.space")} value={spaceId} onChange={(e) => setSpaceId(e.target.value)} error={submitted && problems.includes("space") ? t("control.emergency.spaceRequired") : undefined} />
        )}
        <TextField label={t("control.emergency.reason")} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} error={submitted && problems.includes("reason") ? t("control.emergency.reasonRequired") : undefined} />
        <TextField label={t("control.emergency.confirmLabel", { word: confirmWord })} value={confirm} onChange={(e) => setConfirm(e.target.value)} error={submitted && problems.includes("confirm") ? t("control.emergency.confirmMismatch", { word: confirmWord }) : undefined} />
        <p className="text-[12.5px] text-muted">{t("control.emergency.manualStillAllowed")}</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </Dialog>
    </>
  );
}
