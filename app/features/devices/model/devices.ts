/**
 * 기기 화면 모델(UI-DEV-04~07, DEV-02.01·02.03·02.04·02.10). 화면과 loader/action이 함께 쓰는 순수 함수만 둔다.
 */
import { looksLikeExpression } from "~/features/devmodel/model/query";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";

export const DEVICE_KINDS = ["SENSOR", "ACTUATOR", "GATEWAY", "HYBRID"] as const;
export const DEVICE_STATUSES = ["PENDING", "ACTIVE", "INACTIVE"] as const;
export const CONNECTIVITIES = ["ONLINE", "OFFLINE", "UNKNOWN"] as const;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_APPROVE = 200;

export interface LatestValue {
  metricKey: string;
  displayName?: string | null;
  unit?: string | null;
  value: number | null;
  measuredAt?: string | null;
  quality?: number | null;
}

/** API-DEV-11 목록 항목 */
export interface DeviceSummary {
  id: string;
  name: string;
  externalId: string;
  kind?: string;
  status: string;
  connectivity?: string;
  lastSeenAt?: string | null;
  firstSeenAt?: string | null;
  battery?: number | null;
  rssi?: number | null;
  model?: { id?: string; code?: string; name?: string } | null;
  space?: { id: string; name?: string; path?: string[] } | null;
  source?: { id: string; name?: string } | null;
  tags?: string[];
  virtual?: boolean;
  onboardingComplete?: boolean;
  metrics?: string[];
  sourceMeta?: { deviceName?: string; tags?: Record<string, string> } | null;
  /** core가 원본 위치 태그로 고른 추천 공간(ING-03.03) */
  suggestedSpaceId?: string | null;
  autoRegistered?: boolean;
  version?: number;
}

/** API-DEV-23 기기 상세 */
export interface DeviceDetail {
  id: string;
  name: string;
  externalId: string;
  kind: string;
  status: string;
  virtual?: boolean;
  version: number;
  source?: { id: string; name?: string; type?: string } | null;
  model?: { id: string; code?: string; name?: string; vendor?: string } | null;
  space?: { id: string; name?: string; path?: string[] } | null;
  state?: { connectivity?: string; lastSeenAt?: string | null; lastMeasuredAt?: string | null; battery?: number | null; rssi?: number | null; snr?: number | null; bestGatewayEui?: string | null; msgCount24h?: number | null } | null;
  latest?: LatestValue[];
  effective?: { expectedIntervalSec?: number; offlineMultiplier?: number; inheritedFrom?: string } | null;
  onboarding?: { firstData?: boolean; model?: boolean; space?: boolean; decodeOk?: boolean; rulesApplied?: boolean; complete?: boolean } | null;
  tags?: string[];
  groups?: { id: string; name: string }[];
  sourceMeta?: Record<string, unknown> | null;
}

/** 목록 필터(URL 쿼리 ↔ API-DEV-11 쿼리). 여러 값은 같은 이름을 반복한다 */
export const FILTER_KEYS = ["q", "status", "connectivity", "kind", "modelId", "spaceId", "includeDescendants", "sourceId", "tag", "groupId", "virtual", "sort"] as const;

export function deviceQuery(params: URLSearchParams, page: number, size = 50): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    // 검색식(q, DEV-13.03)이면 서버가 오류 열을 세므로 앞뒤 공백을 그대로 보낸다
    for (const value of params.getAll(key)) if (value.trim()) query.append(key, key === "q" && looksLikeExpression(value) ? value : value.trim());
  }
  query.set("page", String(page));
  query.set("size", String(size));
  return query;
}

/** 사용자가 고른 필터가 하나라도 있는지(빈 화면 문구를 고른다) */
export function hasFilters(params: URLSearchParams): boolean {
  return FILTER_KEYS.some((key) => key !== "sort" && key !== "includeDescendants" && params.getAll(key).some((v) => v.trim() !== ""));
}

/** 태그 입력(쉼표·줄바꿈). 대소문자를 무시하고 중복 제거, 원래 표기 유지(BR-DEV-11) */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

export function checkTags(tags: string[]): string | undefined {
  if (tags.length > MAX_TAGS) return "tagLimit";
  if (tags.some((t) => t.length > MAX_TAG_LENGTH)) return "tagLength";
  return undefined;
}

export interface DeviceInput {
  sourceId: string;
  externalId: string;
  name: string;
  kind: string;
  modelId: string;
  spaceId: string;
  expectedIntervalSec: string;
  offlineMultiplier: string;
  tags: string;
}

/** 기기 추가 폼 검증(UI-DEV-07). 값은 오류 문구 키 */
export function checkDeviceInput(input: DeviceInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.sourceId) errors.sourceId = "sourceRequired";
  const ext = input.externalId.trim();
  if (ext.length < 1 || ext.length > 128) errors.externalId = "externalIdInvalid";
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) errors.name = "nameInvalid";
  if (!DEVICE_KINDS.includes(input.kind as (typeof DEVICE_KINDS)[number])) errors.kind = "kindRequired";
  if (!input.modelId) errors.modelId = "modelRequired";
  if (!input.spaceId) errors.spaceId = "spaceRequired";
  if (input.expectedIntervalSec) {
    const n = Number(input.expectedIntervalSec);
    if (!Number.isInteger(n) || n < 10 || n > 86_400) errors.expectedIntervalSec = "intervalRange";
  }
  if (input.offlineMultiplier) {
    const n = Number(input.offlineMultiplier);
    if (!(n >= 1.5 && n <= 10)) errors.offlineMultiplier = "multiplierRange";
  }
  const tagProblem = checkTags(parseTags(input.tags));
  if (tagProblem) errors.tags = tagProblem;
  return errors;
}

/** API-DEV-12 요청 본문(외부 ID는 소문자 정규화) */
export function toCreateBody(input: DeviceInput) {
  return {
    sourceId: input.sourceId,
    externalId: input.externalId.trim().toLowerCase(),
    name: input.name.trim(),
    kind: input.kind,
    modelId: input.modelId,
    spaceId: input.spaceId,
    expectedIntervalSec: input.expectedIntervalSec ? Number(input.expectedIntervalSec) : undefined,
    offlineMultiplier: input.offlineMultiplier ? Number(input.offlineMultiplier) : undefined,
    tags: parseTags(input.tags),
  };
}

/** 모델 종류와 기기 종류가 다르면 경고(저장은 가능, BR-DEV-05) */
export function kindMismatch(deviceKind: string, model: { kind?: string } | undefined): boolean {
  return Boolean(model?.kind && deviceKind && model.kind !== deviceKind);
}

/** 승인 검증(UI-DEV-05): 모델·공간 필수, 1~200대 */
export function checkApproval(input: { count: number; modelId: string; spaceId: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.count < 1) errors.selection = "selectRequired";
  if (input.count > MAX_APPROVE) errors.selection = "selectLimit";
  if (!input.modelId) errors.modelId = "modelRequired";
  if (!input.spaceId) errors.spaceId = "spaceRequired";
  return errors;
}

/**
 * 추천 공간(AT-DEV-03.3): 원본 tags의 location(또는 space·room) 값과 이름이 같은 공간. 확정은 사용자가 한다.
 * 같은 이름이 여러 개면 더 깊은(구체적인) 공간을 고른다.
 */
export function suggestSpace(spaces: SpaceNode[], sourceMeta: DeviceSummary["sourceMeta"], suggestedSpaceId?: string | null): string | undefined {
  // core가 고른 추천 공간이 트리에 있으면 그것을 쓴다
  if (suggestedSpaceId && flattenSpaces(spaces).some((s) => s.id === String(suggestedSpaceId) && s.node.accessible !== false)) return String(suggestedSpaceId);
  const tags = sourceMeta?.tags ?? {};
  const wanted = [tags.location, tags.space, tags.room].filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim().toLowerCase());
  if (wanted.length === 0) return undefined;
  const matches = flattenSpaces(spaces).filter((s) => wanted.includes(s.name.trim().toLowerCase()) && s.node.accessible !== false);
  return matches.sort((a, b) => b.depth - a.depth)[0]?.id;
}

export interface ApproveResult {
  deviceId: string;
  ok: boolean;
  errorCode?: string;
  /** 플랫폼 브로커 기기의 서명 키(승인 때 한 번만, DSC-03.05·ADR-031) */
  signingKey?: string;
}

export function summarizeResults(results: ApproveResult[]) {
  const failed = results.filter((r) => !r.ok);
  return { succeeded: results.length - failed.length, failed: failed.length, failedById: Object.fromEntries(failed.map((r) => [r.deviceId, r.errorCode ?? "UNKNOWN"])) };
}

export type Tone = "good" | "warn" | "bad" | "muted" | "accent";

export function connectivityTone(connectivity: string | undefined | null): Tone {
  if (connectivity === "ONLINE") return "good";
  if (connectivity === "OFFLINE") return "muted";
  return "warn";
}

export function statusTone(status: string | undefined | null): "success" | "info" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "PENDING") return "info";
  return "neutral";
}

/** 온보딩 체크리스트 5항목(BR-DEV-26) */
export const ONBOARDING_ITEMS = ["firstData", "model", "space", "decodeOk", "rulesApplied"] as const;

/** 실시간 `device-update`(API-DSH-20 space 토픽)를 상세 화면 상태에 반영한다. 다른 기기 이벤트는 무시 */
export function applyDeviceUpdate(
  device: Pick<DeviceDetail, "id" | "latest" | "state">,
  update: { deviceId?: string; metrics?: { key: string; value: number | null; unit?: string | null; quality?: number | null; at?: string }[]; connection?: string; state?: { lastSeenAt?: string; battery?: number; rssi?: number } },
): Pick<DeviceDetail, "latest" | "state"> | undefined {
  if (!update || String(update.deviceId) !== String(device.id)) return undefined;
  const latest = [...(device.latest ?? [])];
  for (const m of update.metrics ?? []) {
    const index = latest.findIndex((l) => l.metricKey === m.key);
    const next: LatestValue = { ...(index >= 0 ? latest[index] : { metricKey: m.key }), value: m.value, unit: m.unit ?? (index >= 0 ? latest[index].unit : null), quality: m.quality ?? 0, measuredAt: m.at ?? null };
    if (index >= 0) latest[index] = next;
    else latest.push(next);
  }
  const lastAt = (update.metrics ?? []).map((m) => m.at).filter(Boolean).sort().at(-1);
  const state = { ...(device.state ?? {}), ...(update.connection ? { connectivity: update.connection } : {}), ...(update.state ?? {}), ...(lastAt ? { lastSeenAt: lastAt } : {}) };
  return { latest, state };
}

/** 데이터 탭이 그릴 측정 항목 후보: 최근값에 있는 키 + 모델 측정 항목 */
export function metricChoices(latest: LatestValue[] | undefined, modelMetrics: string[] = []): string[] {
  return [...new Set([...(latest ?? []).map((l) => l.metricKey), ...modelMetrics])];
}

/** CSV 가져오기 템플릿(API-DEV-19·20 헤더) */
export const CSV_TEMPLATE_HEADER = "sourceId,externalId,name,kind,modelCode,spaceId,expectedIntervalSec,offlineMultiplier,tags,virtual";

export function csvTemplateHref(): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`\ufeff${CSV_TEMPLATE_HEADER}\n`)}`;
}

/** CSV 가져오기 결과(API-DEV-19) */
export interface ImportReport {
  total: number;
  succeeded: number;
  failed: number;
  rows: { line: number; ok: boolean; errorCode?: string | null; message?: string | null }[];
}

/** 즐겨찾기 토글(API-DSH-12 favorites). 온 키만 바꾸는 PUT 본문을 만든다 */
export function toggleFavorite(favorites: { type: string; id: string }[] | undefined, type: string, id: string): { type: string; id: string }[] {
  const list = (favorites ?? []).map((f) => ({ type: f.type, id: String(f.id) }));
  const exists = list.some((f) => f.type === type && f.id === id);
  return exists ? list.filter((f) => !(f.type === type && f.id === id)) : [...list, { type, id }];
}

export function isFavorite(favorites: { type: string; id: string }[] | undefined, type: string, id: string): boolean {
  return (favorites ?? []).some((f) => f.type === type && String(f.id) === id);
}
