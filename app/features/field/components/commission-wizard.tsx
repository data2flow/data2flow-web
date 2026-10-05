/**
 * 현장 설치(UI-DEV-21, DEV-13.05, API-DEV-137): ① QR 스캔 → ② 기기 확인·공간 → ③ 평면도에서 위치 탭 → ④ 사진(0~5장) → ⑤ 저장 → ⑥ 첫 수신 대기.
 * 저장은 대기열에 넣고 연결되어 있으면 바로 보낸다. 오프라인이면 기기에 보관했다가 연결되면 넣은 순서대로 보내고 결과를 하나씩 보여 준다(AT-DEV-27.4).
 * 같은 저장은 `clientOpId`(UUID)로 멱등(BR-DEV-37). 서버에 더 새로운 설치 기록이 있으면 409 COMMISSION_CONFLICT와 서버 값을 나란히 보여 준다(AT-DEV-27.5).
 * 대기 화면은 `space:{공간}`의 `commissioning` 이벤트로 첫 수신(VERIFIED)·문제(PROBLEM, 10분 무수신 체크리스트, BR-DEV-38)를 받는다.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Alert, Card, StatusDot } from "~/components/ui";
import { SpaceSelect } from "~/components/space-picker";
import { clientIdempotencyKey } from "~/lib/bff-client";
import { liveUrl, type StreamEvent } from "~/lib/event-stream";
import { formatDateTime } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import { ratioFromClick } from "~/features/spaces/model/space-forms";
import { fieldApi, type FieldApi, type FieldDevice } from "../api";
import { useOnline, useQueue } from "../hooks";
import {
  MAX_COMMISSION_PHOTOS,
  commissionTone,
  failedChecks,
  formatCountdown,
  remainingWaitMs,
  type CommissionResult,
  type CommissionStatusView,
  type CommissioningEvent,
  type ServerCommission,
} from "../model/commissioning";
import type { OfflineQueue, QueueResult } from "../model/offline-queue";
import { browserUrl } from "../model/work-orders";
import { OfflineBand, PhotoPicker, TouchButton } from "./common";
import { QrScanner, type ScannerDeps } from "./qr-scanner";

type Step = "scan" | "confirm" | "position" | "photos" | "wait";

export interface CommissionWizardProps {
  spaces: SpaceNode[];
  timezone: string;
  api?: FieldApi;
  queue?: OfflineQueue;
  now?: () => number;
  scanner?: ScannerDeps;
  live?: UseLiveStreamOptions;
  /** 처음 열 때 이미 아는 토큰(`/m/commission?token=`) */
  initialToken?: string | null;
}

interface Pending {
  opId: string;
  deviceId: string;
  deviceName: string;
  spaceId: string;
  x: number | null;
  y: number | null;
  installedAt: string;
}

export function CommissionWizard({ spaces, timezone, api = fieldApi, queue: injected, now = Date.now, scanner, live, initialToken }: CommissionWizardProps) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const { queue, snapshot, results } = useQueue(injected);
  const [step, setStep] = useState<Step>("scan");
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<FieldDevice | null>(null);
  const [spaceId, setSpaceId] = useState("");
  const [plan, setPlan] = useState<string | null | undefined>(undefined);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [mine, setMine] = useState<Pending[]>([]);
  const [waiting, setWaiting] = useState<{ pending: Pending; result: CommissionResult } | null>(null);
  const image = useRef<HTMLDivElement>(null);

  const reset = () => {
    setDevice(null);
    setSpaceId("");
    setPlan(undefined);
    setPoint(null);
    setPhotos([]);
    setError(null);
    setWaiting(null);
    setStep("scan");
  };

  const open = async (token: string) => {
    setError(null);
    const resolved = await api.resolveQr(token);
    if (!resolved.ok) {
      setError(resolved.status === 404 ? t("field.scan.notFound") : t(`errors.${resolved.code}`, { defaultValue: t("errors.UNKNOWN") }));
      return;
    }
    const detail = await api.device(resolved.data.deviceId);
    if (!detail.ok) {
      setError(t("field.scan.notFound"));
      return;
    }
    setDevice(detail.data);
    setSpaceId(detail.data.space?.id ? String(detail.data.space.id) : "");
    setStep("confirm");
  };

  const started = useRef(false);
  useEffect(() => {
    if (initialToken && !started.current) {
      started.current = true;
      void open(initialToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  const toPosition = async () => {
    setStep("position");
    setPlan(undefined);
    const result = await api.floorplan(spaceId);
    setPlan(result.ok ? (result.data.imageUrl ?? null) : null);
  };

  const tap = (event: MouseEvent<HTMLDivElement>) => {
    if (!image.current) return;
    setPoint(ratioFromClick(event.clientX, event.clientY, image.current.getBoundingClientRect()));
  };

  const save = async () => {
    if (!queue || !device) return;
    const opId = clientIdempotencyKey();
    const pending: Pending = { opId, deviceId: device.id, deviceName: device.name, spaceId, x: point?.x ?? null, y: point?.y ?? null, installedAt: new Date(now()).toISOString() };
    await queue.enqueue({
      id: opId,
      kind: "commission",
      label: device.name,
      createdAt: now(),
      key: clientIdempotencyKey(),
      target: { deviceId: device.id, spaceId, x: pending.x, y: pending.y, installedAt: pending.installedAt },
      files: photos.map((p) => ({ blob: p, name: p.name })),
    });
    setMine((list) => [...list, pending]);
    if (online) void queue.flush();
    setDevice(null);
    setPhotos([]);
    setPoint(null);
    setStep("scan");
  };

  // 보낸 결과 중 방금 저장한 건이 성공이면 대기 화면으로
  const lastResult = results[results.length - 1];
  useEffect(() => {
    if (!lastResult || lastResult.op.kind !== "commission" || !lastResult.outcome.ok) return;
    const pending = mine.find((p) => p.opId === lastResult.op.id);
    if (pending && pending === mine[mine.length - 1] && snapshot.pending.length === 0) {
      setWaiting({ pending, result: lastResult.outcome.response as CommissionResult });
      setStep("wait");
    }
  }, [lastResult, mine, snapshot.pending.length]);

  const commissionResults = results.filter((r) => r.op.kind === "commission");
  const queued = snapshot.pending.filter((op) => op.kind === "commission");

  return (
    <div className="flex flex-col gap-3 pb-20">
      <OfflineBand online={online} pending={snapshot.pending.length} />
      <ol aria-label={t("field.commission.steps")} className="flex gap-1 text-[11.5px] text-muted">
        {(["scan", "confirm", "position", "photos", "wait"] as Step[]).map((s, i) => (
          <li key={s} aria-current={s === step ? "step" : undefined} className={s === step ? "font-semibold text-accent" : undefined}>
            {`${i + 1}.${t(`field.commission.step.${s}`)}`}
          </li>
        ))}
      </ol>
      {error && <Alert tone="danger">{error}</Alert>}

      {step === "scan" && (
        <Card title={t("field.commission.step.scan")}>
          <QrScanner onToken={(token) => void open(token)} deps={scanner} />
        </Card>
      )}

      {step === "confirm" && device && (
        <Card title={t("field.commission.step.confirm")}>
          <p className="text-[15px] font-semibold">{device.name}</p>
          <p className="text-[12.5px] text-muted">{[device.model?.name ?? device.model?.code, device.externalId, t(`field.deviceStatus.${device.status}`, { defaultValue: device.status })].filter(Boolean).join(" · ")}</p>
          <div className="mt-3">
            <SpaceSelect spaces={spaces} label={t("field.commission.space")} emptyLabel={t("field.commission.chooseSpace")} value={spaceId} onChange={(e) => setSpaceId(e.target.value)} />
          </div>
          <div className="mt-3 flex gap-2">
            <TouchButton onClick={reset}>{t("field.commission.rescan")}</TouchButton>
            <TouchButton variant="primary" disabled={!spaceId} onClick={() => void toPosition()}>
              {t("field.commission.next")}
            </TouchButton>
          </div>
        </Card>
      )}

      {step === "position" && device && (
        <Card title={t("field.commission.step.position")}>
          {plan === undefined && <p className="text-[13px] text-muted">{t("common.loading")}</p>}
          {plan === null && <Alert tone="info">{t("field.commission.noFloorplan")}</Alert>}
          {plan && (
            <div ref={image} role="presentation" data-testid="commission-floorplan" onClick={tap} className="relative cursor-crosshair overflow-hidden rounded border border-line">
              <img src={browserUrl(plan) ?? undefined} alt={t("field.commission.floorplanAlt")} className="block w-full" />
              {point && (
                <span aria-label={t("field.commission.here")} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent px-2 py-0.5 text-[11.5px] text-white" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>
                  ● {t("field.commission.here")}
                </span>
              )}
            </div>
          )}
          {point && <p className="mt-1 font-mono text-[12px] text-muted">{`x ${point.x.toFixed(3)} · y ${point.y.toFixed(3)}`}</p>}
          <div className="mt-3 flex gap-2">
            <TouchButton onClick={() => setStep("confirm")}>{t("field.commission.back")}</TouchButton>
            <TouchButton variant="primary" disabled={plan === undefined || (Boolean(plan) && !point)} onClick={() => setStep("photos")}>
              {t("field.commission.nextPhotos")}
            </TouchButton>
          </div>
        </Card>
      )}

      {step === "photos" && device && (
        <Card title={t("field.commission.photos", { count: photos.length, max: MAX_COMMISSION_PHOTOS })}>
          <ul className="mb-3 flex flex-wrap gap-2 text-[12px]">
            {photos.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex items-center gap-1 rounded border border-line px-2 py-1">
                {p.name}
                <button type="button" className="text-bad-ink" aria-label={t("field.commission.removePhoto", { name: p.name })} onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <PhotoPicker touch multiple label={t("field.commission.addPhoto")} disabled={photos.length >= MAX_COMMISSION_PHOTOS} onFiles={(files) => setPhotos((list) => [...list, ...files.filter((f) => f.type.startsWith("image/"))].slice(0, MAX_COMMISSION_PHOTOS))} />
            <TouchButton variant="primary" onClick={() => void save()}>
              {t("field.commission.save")}
            </TouchButton>
          </div>
        </Card>
      )}

      {step === "wait" && waiting && <FirstDataWait pending={waiting.pending} result={waiting.result} api={api} timezone={timezone} now={now} live={live} onNext={reset} />}

      {(queued.length > 0 || commissionResults.length > 0) && (
        <Card title={t("field.commission.queueTitle")}>
          <ul className="flex flex-col gap-2 text-[13px]">
            {queued.map((op) => (
              <li key={op.id} className="text-fair-ink">
                {t("field.commission.queued", { name: op.label })}
              </li>
            ))}
            {commissionResults.map((r) => (
              <SentResult key={r.op.id} result={r} mine={mine.find((p) => p.opId === r.op.id)} timezone={timezone} lang={i18n.language} spaces={spaces} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function spaceName(spaces: SpaceNode[], id: string | null | undefined): string {
  if (!id) return "–";
  const stack = [...spaces];
  while (stack.length) {
    const node = stack.pop() as SpaceNode;
    if (String(node.id) === String(id)) return node.name;
    stack.push(...(node.children ?? []));
  }
  return String(id);
}

/** 보낸 결과 한 줄. 409면 서버 값과 내 입력을 나란히(AT-DEV-27.5) */
function SentResult({ result, mine, timezone, lang, spaces }: { result: QueueResult; mine?: Pending; timezone: string; lang: string; spaces: SpaceNode[] }) {
  const { t } = useTranslation();
  const { op, outcome } = result;
  if (outcome.ok) return <li className="text-good-ink">{t("field.commission.sent", { name: op.label })}</li>;
  if (outcome.code === "COMMISSION_CONFLICT") {
    const server = (outcome.response ?? {}) as ServerCommission;
    return (
      <li role="alert" className="rounded border border-bad p-2">
        <p className="font-semibold text-bad-ink">{t("field.commission.conflict", { name: op.label })}</p>
        <table className="mt-1 w-full text-[12.5px]">
          <thead>
            <tr>
              <th />
              <th className="text-left">{t("field.commission.server")}</th>
              <th className="text-left">{t("field.commission.mine")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="text-left font-normal text-muted">{t("field.commission.space")}</th>
              <td>{spaceName(spaces, server.spaceId)}</td>
              <td>{spaceName(spaces, mine?.spaceId ?? String(op.target.spaceId))}</td>
            </tr>
            <tr>
              <th className="text-left font-normal text-muted">{t("field.commission.installedAt")}</th>
              <td>{formatDateTime(server.installedAt ?? null, timezone, lang)}</td>
              <td>{formatDateTime(String(op.target.installedAt), timezone, lang)}</td>
            </tr>
            <tr>
              <th className="text-left font-normal text-muted">{t("field.commission.installedBy")}</th>
              <td>{server.installedByName ?? server.installedBy ?? "–"}</td>
              <td>{t("field.create.me")}</td>
            </tr>
          </tbody>
        </table>
      </li>
    );
  }
  return <li className="text-bad-ink">{t("field.commission.failed", { name: op.label, code: outcome.code ?? outcome.status })}</li>;
}

/** ⑥ 첫 수신 대기(타이머, 체크리스트) */
export function FirstDataWait({ pending, result, api, timezone, now, live, onNext }: { pending: Pending; result: CommissionResult; api: FieldApi; timezone: string; now: () => number; live?: UseLiveStreamOptions; onNext: () => void }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<CommissionStatusView>({ deviceId: pending.deviceId, status: result.status, installedAt: result.installedAt, waitUntil: result.waitUntil });
  const [tick, setTick] = useState(now());
  const reload = useMemo(
    () => async () => {
      const r = await api.commissionStatus(pending.deviceId);
      if (r.ok) setStatus(r.data);
    },
    [api, pending.deviceId],
  );
  const done = status.status === "VERIFIED" || status.status === "PROBLEM";
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(timer);
  }, [done, now]);
  const left = remainingWaitMs(status, tick);
  const expired = left === 0;
  useEffect(() => {
    if (expired && !done) void reload();
  }, [expired, done, reload]);
  useLiveStream(liveUrl([`space:${pending.spaceId}`]), ["commissioning"], (event: StreamEvent) => {
    const data = event.data as CommissioningEvent;
    if (String(data.deviceId) !== pending.deviceId) return;
    setStatus((s) => ({ ...s, status: data.status, firstSeenAt: data.firstSeenAt ?? s.firstSeenAt, checklist: data.checklist ?? s.checklist }));
    if (data.status === "VERIFIED") void reload();
  }, live);
  const latest = Array.isArray(status.latest) ? (status.latest as { metricKey?: string; key?: string; value?: unknown; unit?: string | null }[]) : [];
  return (
    <Card title={done ? t(`field.commission.status.${status.status}`) : t("field.commission.waitTitle", { time: formatCountdown(left) })}>
      <p className="font-semibold">{pending.deviceName}</p>
      <StatusDot tone={commissionTone(status.status)} label={t(`field.commission.status.${status.status}`, { defaultValue: status.status })} />
      {status.status === "VERIFIED" && (
        <div role="status" className="mt-2 text-[13px]">
          <p className="font-semibold text-good-ink">{t("field.commission.firstData", { at: formatDateTime(status.firstSeenAt ?? null, timezone, i18n.language) })}</p>
          <ul className="mt-1 font-mono">
            {latest.map((m, i) => (
              <li key={m.metricKey ?? m.key ?? i}>{`${m.metricKey ?? m.key}: ${String(m.value)}${m.unit ?? ""}`}</li>
            ))}
          </ul>
        </div>
      )}
      {!done && <p className="mt-2 text-[13px] text-muted">{t("field.commission.waiting")}</p>}
      {status.status === "PROBLEM" && (
        <div role="alert" className="mt-2 text-[13px]">
          <p className="font-semibold text-bad-ink">{t("field.commission.problem")}</p>
          <ul className="mt-1 list-disc pl-5">
            {failedChecks(status.checklist).map((k) => (
              <li key={k}>{t(`field.commission.hint.${k}`, { defaultValue: t(`field.commission.check.${k}`) })}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex">
        <TouchButton variant="primary" onClick={onNext}>
          {t("field.commission.nextDevice")}
        </TouchButton>
      </div>
    </Card>
  );
}

