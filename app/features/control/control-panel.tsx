/**
 * UI-ACT-01 기기 제어 패널(ACT-04.01 표준 컨트롤, ACT-02.04 원하는 상태·실제 상태, ACT-04.02 명령 결과 실시간 표시).
 * - 컨트롤은 기능 정의(attributes)와 모델 제약·조직 한계(effectiveConstraints)로 만든다(API-ACT-03)
 * - [적용]은 바뀐 값이 있을 때만 켜지고, 명령마다 Idempotency-Key를 붙여 API-ACT-01로 보낸다. 1초 안의 연타는 버린다
 * - 명령 상태는 실시간 구독 `commands:{deviceId}`(event `command-status`)로, 기기 보고는 `space:{spaceId}`(event `device-update`)로 받는다(API-DSH-20)
 * - APPLIED가 되면 섀도(API-ACT-04)를 다시 읽는다. 실패·거부는 사유를 보여 준다
 * - M4: 수동 우선 남은 시간(30초마다 다시 셈)과 [자동으로 되돌리기](ACT-06.05, API-ACT-06), 오프라인 대기열 명령 수(ACT-07.01),
 *   LoRaWAN Class A `QUEUED_FOR_DOWNLINK` 예상 전달 시각(ACT-07.02), 단계형 정수 속성(FanSpeed·Ventilation level)은 단계 버튼(ACT-04.01)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Alert, Badge, Button, Card, EmptyState, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { liveUrl, type StreamEvent } from "~/lib/event-stream";
import { formatDateTime } from "~/lib/format";
import { controlApi, type ControlApi } from "./api";
import { SourceLabel } from "./command-history";
import {
  PROGRESS_STEPS,
  attributeRange,
  changedArgs,
  createDebounceGuard,
  currentValue,
  mergeReported,
  nextStatus,
  progressOf,
  syncState,
  validateArgs,
  writableAttributes,
  type AttributeDef,
  type CapabilityControl,
  type CommandSource,
  type ControlInfo,
  type Shadow,
} from "./model/control";

const QUEUED = new Set(["QUEUED", "QUEUED_FOR_DOWNLINK"]);

export interface TrackedCommand {
  id: string;
  capability: string;
  status: string;
  reason?: string;
  /** 명령 출처(플로우면 flowName, 사용자면 userName — core가 붙인다, ADR-043) */
  source?: CommandSource | null;
  /** Class A 다운링크 예상 전달 시각(API-ACT-01 `expectedDeliveryAt`) */
  expectedDeliveryAt?: string | null;
}

/** 실시간 `command-status`(commands:{deviceId}, API-DSH-20): 실패 사유는 reason(상태 사유 코드), message(차단 사유 문구) */
export interface CommandStatusEvent {
  commandId?: string;
  deviceId?: string;
  capability?: string;
  command?: string;
  status?: string;
  reason?: string | null;
  message?: string | null;
  source?: CommandSource | null;
  at?: string;
}

/** 실시간 `device-update`(space:{id}, API-DSH-20). 액추에이터 보고면 state가 {reported, delta, reportedVersion, origin, at} */
export interface DeviceUpdateEvent {
  deviceId?: string;
  connection?: string | null;
  state?: { reported?: Record<string, Record<string, unknown>> | null; delta?: Record<string, Record<string, unknown>> | null; reportedVersion?: number; origin?: string; at?: string } | string | null;
}

export interface DeviceControlPanelProps {
  deviceId: string;
  spaceId?: string | null;
  /** loader가 읽은 API-ACT-03. null이면 읽기 실패 */
  initial: ControlInfo | null;
  canControl: boolean;
  timezone: string;
  lang: string;
  api?: ControlApi;
  live?: UseLiveStreamOptions;
  now?: () => number;
}

function fmtValue(value: unknown, unit?: string): string {
  if (value === undefined || value === null) return "–";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  return `${String(value)}${unit ?? ""}`;
}

export function DeviceControlPanel({ deviceId, spaceId, initial, canControl, timezone, lang, api = controlApi, live, now = Date.now }: DeviceControlPanelProps) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ControlInfo | null>(initial);
  const [shadow, setShadow] = useState<Shadow | null | undefined>(initial?.shadow);
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [commands, setCommands] = useState<TrackedCommand[]>(() => (initial?.pending ?? []).map((p) => ({ id: p.commandId, capability: p.capability, status: p.status })));
  const [notice, setNotice] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const guard = useMemo(() => createDebounceGuard(1000, now), [now]);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  // 수동 우선 남은 시간을 30초마다 다시 센다
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!info?.manualOverride) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [info?.manualOverride]);

  const refreshShadow = useCallback(async () => {
    const result = await api.shadow(deviceId);
    if (result.ok) setShadow(result.data);
  }, [api, deviceId]);

  const track = useCallback((id: string, capability: string, status: string, reason?: string, source?: CommandSource | null, expectedDeliveryAt?: string | null) => {
    setCommands((list) => {
      const existing = list.find((c) => c.id === id);
      if (existing) return list.map((c) => (c.id === id ? { ...c, status: nextStatus(c.status, status), reason: reason ?? c.reason, source: source ?? c.source, expectedDeliveryAt: expectedDeliveryAt ?? c.expectedDeliveryAt } : c));
      return [{ id, capability, status, reason, source, expectedDeliveryAt }, ...list].slice(0, 20);
    });
  }, []);

  const onEvent = useCallback(
    (event: StreamEvent) => {
      if (event.type === "command-status") {
        const data = event.data as CommandStatusEvent;
        if (!data?.commandId || !data.status) return;
        if (data.deviceId && data.deviceId !== deviceId) return;
        const reason = data.message ?? data.reason ?? undefined;
        const known = commandsRef.current.find((c) => c.id === data.commandId);
        const capability = known?.capability ?? data.capability;
        if (capability) track(data.commandId, capability, data.status, reason, data.source);
        // 기능 이름이 없거나 사유 없는 실패면 명령 상세(API-ACT-02)를 읽는다
        if (!capability || (progressOf(data.status).failed && !reason)) {
          void api.commandDetail(data.commandId).then((detail) => {
            if (detail.ok) track(detail.data.id, detail.data.capability, data.status!, detail.data.message ?? detail.data.statusReason ?? reason, detail.data.source);
          });
        }
        if (data.status === "APPLIED") void refreshShadow();
      } else if (event.type === "device-update") {
        const data = event.data as DeviceUpdateEvent;
        // 측정값 갱신(metrics)이나 기기 상태 문자열은 섀도와 무관하다. 액추에이터 보고 상태만 합친다
        if (data?.deviceId !== deviceId || !data.state || typeof data.state !== "object") return;
        const state = data.state;
        setShadow((s) => {
          const merged = mergeReported(s, state.reported ?? {}, state.at);
          return { ...merged, ...(state.delta ? { delta: state.delta } : {}), ...(data.connection ? { connectivity: data.connection } : {}) };
        });
      }
    },
    [api, deviceId, refreshShadow, track],
  );
  const url = info?.controllable ? liveUrl([`commands:${deviceId}`, spaceId ? `space:${spaceId}` : ""]) : null;
  const status = useLiveStream(url, ["command-status", "device-update"], onEvent, live);

  if (!info) return <Alert tone="warning">{t("control.panel.unavailable")}</Alert>;
  if (!info.controllable) return <EmptyState title={t("control.panel.notControllable")} />;

  const pendingCaps = new Set(commands.filter((c) => !progressOf(c.status).terminal).map((c) => c.capability));
  const queuedCount = new Set([...commands.filter((c) => QUEUED.has(c.status)).map((c) => c.id), ...(info.pending ?? []).filter((p) => QUEUED.has(p.status)).map((p) => p.commandId)]).size;
  const circuitOpen = info.driver?.status === "CIRCUIT_OPEN";
  const overrideMinutes = info.manualOverride?.until ? Math.max(0, Math.ceil((Date.parse(info.manualOverride.until) - now()) / 60_000)) : null;

  const setEdit = (capability: string, attribute: string, value: unknown) => setEdits((e) => ({ ...e, [capability]: { ...(e[capability] ?? {}), [attribute]: value } }));

  const apply = async (capability: CapabilityControl) => {
    const args = changedArgs(shadow, capability.name, edits[capability.name] ?? {});
    if (Object.keys(args).length === 0 || validateArgs(capability, args).length > 0) return;
    if (!guard()) return;
    setNotice(null);
    const result = await api.command(deviceId, { capability: capability.name, command: "set", args });
    if (result.ok) {
      track(result.data.id, capability.name, result.data.status, result.data.message ?? result.data.statusReason ?? undefined, null, result.data.expectedDeliveryAt);
      setEdits((e) => ({ ...e, [capability.name]: {} }));
      setShadow((s) => ({ ...(s ?? {}), desired: { ...(s?.desired ?? {}), [capability.name]: { ...(s?.desired?.[capability.name] ?? {}), ...args } } }));
    } else {
      setNotice({ tone: "danger", text: errorText(t, { code: result.code, message: result.message }) ?? "" });
    }
  };

  const releaseOverride = async () => {
    if (!info.manualOverride) return;
    const result = await api.releaseOverride(deviceId, info.manualOverride.capability);
    if (result.ok) {
      setInfo({ ...info, manualOverride: null });
      setNotice({ tone: "success", text: t("control.panel.overrideReleased") });
    } else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  return (
    <div className="flex flex-col gap-3">
      <LiveBanner status={status} />
      {info.emergencyStop && <Alert tone="danger">{t("control.panel.emergencyStop")}</Alert>}
      {circuitOpen && <Alert tone="warning">{t("control.panel.circuitOpen")}</Alert>}
      {!canControl && <Alert tone="info">{t("control.panel.readOnly")}</Alert>}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span>
          {t("control.panel.driver")}: <span className="font-mono">{info.driver?.name ?? info.driver?.type ?? "–"}</span>
        </span>
        <Badge tone={shadow?.connectivity === "ONLINE" ? "success" : shadow?.connectivity === "OFFLINE" ? "danger" : "neutral"}>{t(`control.connectivity.${shadow?.connectivity ?? "UNKNOWN"}`, { defaultValue: shadow?.connectivity ?? "UNKNOWN" })}</Badge>
        {queuedCount > 0 && <Badge tone="warning">{t("control.panel.queued", { n: queuedCount })}</Badge>}
        {shadow?.reportedAt && <span className="text-muted">{t("control.panel.reportedAt", { at: formatDateTime(shadow.reportedAt, timezone, lang, true) })}</span>}
        {overrideMinutes !== null && (
          <span className="inline-flex items-center gap-2">
            <Badge tone="warning">{t("control.panel.manualOverride", { n: overrideMinutes })}</Badge>
            {canControl && (
              <Button variant="ghost" onClick={releaseOverride}>
                {t("control.panel.releaseOverride")}
              </Button>
            )}
          </span>
        )}
        {info.protection?.nextAllowedAt && <span className="text-muted">{t("control.panel.protection", { at: formatDateTime(info.protection.nextAllowedAt, timezone, lang, true) })}</span>}
        <LiveDot status={status} />
      </div>
      {info.capabilities.map((capability) => (
        <CapabilityCard
          key={capability.name}
          capability={capability}
          shadow={shadow}
          edits={edits[capability.name] ?? {}}
          sync={syncState(shadow, capability.name, pendingCaps)}
          command={commands.find((c) => c.capability === capability.name)}
          canControl={canControl}
          timezone={timezone}
          lang={lang}
          onEdit={(attribute, value) => setEdit(capability.name, attribute, value)}
          onApply={() => void apply(capability)}
        />
      ))}
    </div>
  );
}

function CapabilityCard({
  capability,
  shadow,
  edits,
  sync,
  command,
  canControl,
  timezone,
  lang,
  onEdit,
  onApply,
}: {
  capability: CapabilityControl;
  shadow: Shadow | null | undefined;
  edits: Record<string, unknown>;
  sync: "synced" | "pending" | "deviceChanged";
  command?: TrackedCommand;
  canControl: boolean;
  timezone: string;
  lang: string;
  onEdit: (attribute: string, value: unknown) => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const writable = writableAttributes(capability);
  const writableNames = new Set(writable.map((a) => a.name));
  const args = changedArgs(shadow, capability.name, edits);
  const problems = validateArgs(capability, args);
  const changed = Object.keys(args).length > 0;
  const syncBadge = sync === "synced" ? <Badge tone="success">{t("control.sync.synced")}</Badge> : sync === "pending" ? <Badge tone="warning">{t("control.sync.pending")}</Badge> : <Badge tone="info">{t("control.sync.deviceChanged")}</Badge>;
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <span className="font-mono">{capability.name}</span>
          {syncBadge}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {capability.attributes.map((attribute) => {
          const reported = shadow?.reported?.[capability.name]?.[attribute.name];
          const desired = shadow?.desired?.[capability.name]?.[attribute.name];
          const range = attributeRange(capability, attribute.name);
          const problem = problems.find((p) => p.attribute === attribute.name);
          const value = edits[attribute.name] ?? currentValue(shadow, capability.name, attribute.name);
          return (
            <div key={attribute.name} className="grid gap-1 sm:grid-cols-[160px_1fr_auto] sm:items-center">
              <span className="text-[13px] font-medium">{t(`control.attr.${attribute.name}`, { defaultValue: attribute.name })}</span>
              <div>
                {writableNames.has(attribute.name) ? (
                  <AttributeInput capability={capability.name} attribute={attribute} range={range} value={value} disabled={!canControl} onChange={(v) => onEdit(attribute.name, v)} />
                ) : (
                  <span className="font-mono">{fmtValue(reported, range.unit)}</span>
                )}
                {problem && (
                  <p role="alert" className="mt-1 text-[12.5px] text-bad">
                    {problem.kind === "range" ? t("control.validation.range", { min: range.min ?? "", max: range.max ?? "", unit: range.unit ?? "" }) : problem.kind === "enum" ? t("control.validation.enum") : t("control.validation.type")}
                  </p>
                )}
              </div>
              {writableNames.has(attribute.name) && (
                <span className="text-[12px] text-muted">
                  {t("control.panel.desiredReported", { desired: fmtValue(desired, range.unit), reported: fmtValue(reported, range.unit) })}
                </span>
              )}
            </div>
          );
        })}
        {writable.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {command ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <CommandProgress command={command} expectedAt={command.expectedDeliveryAt ? formatDateTime(command.expectedDeliveryAt, timezone, lang) : undefined} />
                {command.source && command.source.type !== "USER" && (
                  <span className="text-[12px] text-muted">
                    <SourceLabel source={command.source} />
                  </span>
                )}
              </span>
            ) : (
              <span />
            )}
            {canControl && (
              <Button variant="primary" disabled={!changed || problems.length > 0} onClick={onApply}>
                {t("control.panel.apply")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export function AttributeInput({ capability, attribute, range, value, disabled, onChange }: { capability: string; attribute: AttributeDef; range: ReturnType<typeof attributeRange>; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const { t } = useTranslation();
  const label = `${capability} ${t(`control.attr.${attribute.name}`, { defaultValue: attribute.name })}`;
  if (attribute.type === "boolean") {
    const checked = Boolean(value);
    return (
      <label className="inline-flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            // 잠금 해제(Lock.locked=false)는 확인을 받는다
            if (capability === "Lock" && attribute.name === "locked" && !e.target.checked && !window.confirm(t("control.panel.unlockConfirm"))) return;
            onChange(e.target.checked);
          }}
        />
        {checked ? t("control.on") : t("control.off")}
      </label>
    );
  }
  if (attribute.type === "enum") {
    return (
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {(range.enum ?? []).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cx("rounded-md border px-2.5 py-1 text-[12.5px]", value === option ? "border-accent bg-accent-soft text-accent" : "border-line text-text")}
          >
            {t(`control.enum.${option}`, { defaultValue: option })}
          </button>
        ))}
      </div>
    );
  }
  if (attribute.type === "integer" && range.min !== undefined && range.max !== undefined && range.max - range.min <= 10 && range.max >= range.min) {
    // 단계 버튼(FanSpeed·Ventilation level 1~N, UI-ACT-01)
    const levels = Array.from({ length: range.max - range.min + 1 }, (_, i) => (range.min as number) + i);
    return (
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {levels.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={value === level}
            disabled={disabled}
            onClick={() => onChange(level)}
            className={cx("min-w-8 rounded-md border px-2.5 py-1 font-mono text-[12.5px]", value === level ? "border-accent bg-accent-soft text-accent" : "border-line text-text")}
          >
            {level}
          </button>
        ))}
      </div>
    );
  }
  if (attribute.type === "number" || attribute.type === "integer") {
    const numeric = typeof value === "number" ? value : value === undefined || value === null || value === "" ? "" : Number(value);
    const step = range.step ?? (attribute.type === "integer" ? 1 : 0.5);
    // 비운 입력은 ""로 두어(현재 값으로 되돌아가지 않게) 변경 없음으로 본다
    const toNumber = (raw: string): number | "" => (raw === "" ? "" : Number(raw));
    return (
      <div className="flex flex-wrap items-center gap-2">
        {range.min !== undefined && range.max !== undefined && (
          <input type="range" aria-label={`${label} ${t("control.panel.slider")}`} min={range.min} max={range.max} step={step} value={numeric === "" ? range.min : numeric} disabled={disabled} onChange={(e) => onChange(toNumber(e.target.value))} />
        )}
        <input type="number" aria-label={label} className="w-24 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[13px]" step={step} value={numeric} disabled={disabled} onChange={(e) => onChange(toNumber(e.target.value))} />
        <span className="text-[12px] text-muted">{range.min !== undefined && range.max !== undefined ? t("control.panel.rangeHint", { min: range.min, max: range.max, unit: range.unit ?? "" }) : range.unit}</span>
      </div>
    );
  }
  // 사용자 정의 기능의 문자열 속성 등
  return <input aria-label={label} className="rounded-md border border-line bg-panel px-2 py-1 text-[13px]" value={value === undefined || value === null ? "" : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

/** 진행 칩: ✓요청 ✓전송 ✓응답 ✓적용, 실패하면 빨간 사유(ACT-04.02). Class A 대기는 예상 전달 시각(ACT-07.02) */
export function CommandProgress({ command, expectedAt }: { command: Pick<TrackedCommand, "status" | "reason">; expectedAt?: string }) {
  const { t } = useTranslation();
  const progress = progressOf(command.status);
  const statusText = t(`control.status.${command.status}`, { defaultValue: command.status });
  if (progress.failed) {
    const reason = command.status === "TIMEOUT" ? t("control.panel.timeout") : command.reason ? (t(`errors.${command.reason}`, { defaultValue: "" }) || command.reason) : undefined;
    return (
      <span role="status" aria-label={t("control.panel.progressLabel", { status: statusText })} className="text-[12.5px] text-bad">
        {statusText}
        {reason && ` — ${reason}`}
      </span>
    );
  }
  return (
    <span role="status" aria-label={t("control.panel.progressLabel", { status: statusText })} className="inline-flex flex-wrap items-center gap-2 text-[12.5px]">
      {PROGRESS_STEPS.map((step, index) => (
        <span key={step} className={index < progress.done ? "text-good" : "text-muted"}>
          {index < progress.done ? "✓" : "○"} {t(`control.step.${step}`)}
        </span>
      ))}
      {progress.waiting && <Badge tone="warning">{statusText}</Badge>}
      {command.status === "QUEUED_FOR_DOWNLINK" && <span className="text-muted">{expectedAt ? t("control.panel.nextUplink", { at: expectedAt }) : t("control.panel.nextUplinkUnknown")}</span>}
    </span>
  );
}
