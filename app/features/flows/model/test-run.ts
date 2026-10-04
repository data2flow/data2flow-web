/**
 * 시험 실행·과거 재생 입력 검증(UI-FLW-06, FLW-03.05·03.06): 직접 입력은 JSON + 표준 메시지(CanonicalTelemetry v1, EVT-ING-02) 모양,
 * 과거 재생 기간은 최대 7일(API-FLW-13). 순수 함수라 node에서 시험한다.
 */
import { zonedDayStartUtc } from "~/lib/format";
import type { ReplayJob } from "./types";

export const REPLAY_MAX_DAYS = 7;
export const REPLAY_POLL_MS = 2000;

/** 직접 입력 예시(표준 메시지 v1). 기기·공간이 있으면 그 값을 넣는다 */
export function sampleMessage(nowIso: string, deviceId?: string | null, spaceId?: string | null): Record<string, unknown> {
  return {
    v: 1,
    messageId: "00000000-0000-4000-8000-000000000001",
    deviceId: deviceId ? Number(deviceId) || deviceId : 1,
    ...(spaceId ? { spaceId: Number(spaceId) || spaceId } : {}),
    measuredAt: nowIso,
    receivedAt: nowIso,
    virtual: false,
    metrics: [
      { key: "temperature", value: 28.1, unit: "℃", quality: 0 },
      { key: "humidity", value: 41, unit: "%", quality: 0 },
    ],
  };
}

/**
 * 엔진은 직접 입력을 contracts `CanonicalTelemetry`로 읽고(필수: organizationId·sourceId·externalId·deviceStatus·rawMessageId·receivedAt),
 * 빠지면 400 FLOW_TEST_INPUT_INVALID다. 사용자가 측정값만 적어도 시험할 수 있게 봉투 항목의 빈자리를 시험용 값으로 채운다.
 */
export function toCanonicalTelemetry(message: Record<string, unknown>, nowIso: string): Record<string, unknown> {
  const measuredAt = typeof message.measuredAt === "string" ? message.measuredAt : nowIso;
  return {
    v: 1,
    messageId: "00000000-0000-4000-8000-000000000001",
    organizationId: 1,
    sourceId: 1,
    externalId: `test-${String(message.deviceId ?? "device")}`,
    deviceStatus: "ACTIVE",
    receivedAt: measuredAt,
    late: false,
    virtual: false,
    rawMessageId: 1,
    ...message,
  };
}

export type MessageCheck = { ok: true; message: Record<string, unknown> } | { ok: false; error: "json" | "schema"; field?: string };

/** JSON 형식 → 표준 메시지 필수 항목(deviceId, measuredAt ISO-8601, metrics[{key, value}] 1개 이상) */
export function checkTestMessage(text: string): MessageCheck {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "json" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "schema" };
  const message = value as Record<string, unknown>;
  if (message.deviceId === undefined || message.deviceId === null || message.deviceId === "") return { ok: false, error: "schema", field: "deviceId" };
  if (typeof message.measuredAt !== "string" || Number.isNaN(Date.parse(message.measuredAt))) return { ok: false, error: "schema", field: "measuredAt" };
  const metrics = message.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0 || metrics.some((m) => !m || typeof m !== "object" || typeof (m as { key?: unknown }).key !== "string" || !("value" in (m as object)))) {
    return { ok: false, error: "schema", field: "metrics" };
  }
  return { ok: true, message };
}

export type RangeCheck = { ok: true; from: string; to: string } | { ok: false; error: "required" | "order" | "tooLong" };

/** 날짜(시간대 기준, 끝 날짜 포함) → UTC 구간. 최대 7일 */
export function replayRange(fromDate: string, toDate: string, timezone: string): RangeCheck {
  const from = zonedDayStartUtc(fromDate, timezone);
  const endDay = /^\d{4}-\d{2}-\d{2}$/.test(toDate) ? new Date(Date.parse(`${toDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : "";
  const to = zonedDayStartUtc(endDay, timezone);
  if (!from || !to) return { ok: false, error: "required" };
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0) return { ok: false, error: "order" };
  if (span > REPLAY_MAX_DAYS * 86_400_000) return { ok: false, error: "tooLong" };
  return { ok: true, from, to };
}

export const replayDone = (job: ReplayJob | null | undefined) => Boolean(job && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status));

/** 엔진은 전체 건수를 세기 전에는 `progress.total`을 null로 준다 */
export function replayPercent(job: ReplayJob | null | undefined): number {
  const p = job?.progress;
  if (!p || p.total == null || p.total <= 0) return job?.status === "SUCCEEDED" ? 100 : 0;
  return Math.min(100, Math.round((p.processed / p.total) * 100));
}
