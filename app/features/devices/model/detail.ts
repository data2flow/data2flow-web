/**
 * UI-DEV-06 기기 상세 M4 탭 모델(DEV-02.07): 변경 이력(API-DEV-27), 규칙·알람(API-RUL-01·10), 명령 구간 띠(API-ACT-02 → 차트 주석), 온보딩 바로가기(BR-DEV-26).
 */
import type { ChartAnnotation } from "~/lib/chart-model";
import { descendantIds, type SpaceNode } from "~/lib/spaces";
import { commandLabel, requestedAt, type Command } from "~/features/control/model/control";
import type { DeviceDetail } from "./devices";

// ── 변경 이력(API-DEV-27) ────────────────────────────────────────────────────

export interface HistoryEntry {
  at: string;
  actor?: string | { userId?: string; name?: string | null; type?: string } | null;
  action: string;
  changes?: Record<string, [unknown, unknown]> | null;
}

export function actorName(actor: HistoryEntry["actor"]): string {
  if (!actor) return "–";
  if (typeof actor === "string") return actor;
  return actor.name ?? actor.userId ?? actor.type ?? "–";
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** "name: AM107 → 실습실 AM107" 목록 */
export function changeLines(changes: HistoryEntry["changes"]): string[] {
  return Object.entries(changes ?? {}).map(([field, pair]) => `${field}: ${show(Array.isArray(pair) ? pair[0] : undefined)} → ${show(Array.isArray(pair) ? pair[1] : pair)}`);
}

// ── 규칙·알람(API-RUL-01·10) ─────────────────────────────────────────────────

export interface RuleRow {
  ruleId: string;
  name: string;
  status: string;
  conditionSummary?: string | null;
  scope: { type: "DEVICE" | "SPACE" | "MODEL" | "TAG" | string; ids: string[]; includeChildren?: boolean; targetCount?: number };
  severity: string;
  openAlarms?: number;
}

export interface AlarmRow {
  id: string;
  severity: string;
  status: string;
  title: string;
  device?: { id: string; name?: string } | null;
  metric?: string | null;
  lastValue?: number | null;
  raisedAt: string;
  ruleId?: string | null;
  source?: { ruleId?: string | null } | null;
}

export type RuleVia = "DEVICE" | "SPACE" | "MODEL" | "TAG";

/**
 * 이 기기에 적용되는 규칙과 경유(직접·공간·모델·태그). API-RUL-01에 기기 필터가 없어 화면에서 scope로 가린다.
 * 공간 범위는 규칙 공간(하위 포함이면 그 하위까지)에 기기 공간이 들어가는지로 본다.
 */
export function rulesForDevice(rules: RuleRow[], device: Pick<DeviceDetail, "id" | "space" | "model" | "tags">, spaces: SpaceNode[]): { rule: RuleRow; via: RuleVia }[] {
  const out: { rule: RuleRow; via: RuleVia }[] = [];
  const ids = (rule: RuleRow) => (rule.scope?.ids ?? []).map(String);
  for (const rule of rules) {
    const type = rule.scope?.type;
    if (type === "DEVICE" && ids(rule).includes(String(device.id))) out.push({ rule, via: "DEVICE" });
    else if (type === "SPACE" && device.space?.id) {
      const spaceId = String(device.space.id);
      const covered = ids(rule).some((id) => id === spaceId || (rule.scope.includeChildren !== false && descendantIds(spaces, id).includes(spaceId)));
      if (covered) out.push({ rule, via: "SPACE" });
    } else if (type === "MODEL" && device.model?.id && ids(rule).includes(String(device.model.id))) out.push({ rule, via: "MODEL" });
    else if (type === "TAG" && ids(rule).some((tag) => (device.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase()))) out.push({ rule, via: "TAG" });
  }
  return out;
}

/** 열린 알람(ACTIVE·ACKNOWLEDGED·SUPPRESSED) 중 이 기기 것 */
export function alarmsForDevice(alarms: AlarmRow[], deviceId: string): AlarmRow[] {
  return alarms.filter((a) => String(a.device?.id ?? "") === String(deviceId) && a.status !== "CLEARED");
}

export function severityTone(severity: string): "danger" | "warning" | "info" | "neutral" {
  if (severity === "CRITICAL" || severity === "MAJOR") return "danger";
  if (severity === "MINOR" || severity === "WARNING") return "warning";
  if (severity === "INFO") return "info";
  return "neutral";
}

// ── 명령 구간 띠(AT-DEV-05.2: "냉방 켜짐" 구간이 띠로 겹쳐 보임) ──────────────

function isOffState(args: Record<string, unknown> | null | undefined): boolean {
  if (!args) return false;
  return args.on === false || args.mode === "off" || args.level === 0;
}

/**
 * 적용된(APPLIED) 명령마다 같은 기능의 다음 적용 명령까지 띠를 만든다. 끄는 명령(on=false, mode=off, level=0)은 띠를 끝내기만 한다.
 */
export function commandBands(commands: Command[], untilIso: string): ChartAnnotation[] {
  const applied = commands
    .filter((c) => c.status === "APPLIED")
    .map((c) => ({ c, at: requestedAt(c) }))
    .filter((x): x is { c: Command; at: string } => Boolean(x.at))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const bands: ChartAnnotation[] = [];
  applied.forEach(({ c, at }, i) => {
    if (isOffState(c.args)) return;
    const next = applied.slice(i + 1).find((x) => x.c.capability === c.capability);
    bands.push({ id: `cmd-${c.id}`, timeFrom: at, timeTo: next?.at ?? untilIso, type: "COMMAND", title: commandLabel(c) });
  });
  return bands;
}

// ── 온보딩 체크리스트 바로가기(UI-DEV-06, BR-DEV-26) ──────────────────────────

/** 권한이 있는 바로가기만 준다: 편집 DEV_PLACE, 소스 SRC_READ, 규칙 RULE_WRITE */
export function onboardingLink(item: string, device: Pick<DeviceDetail, "id" | "source" | "space">, permissions: readonly string[] = []): string | undefined {
  const has = (p: string) => permissions.includes(p);
  switch (item) {
    case "model":
    case "space":
      return has("DEV_PLACE") ? "?edit=1" : undefined;
    case "firstData":
    case "decodeOk":
      return device.source?.id && has("SRC_READ") ? `/sources/${encodeURIComponent(device.source.id)}` : undefined;
    case "rulesApplied":
      if (!has("RULE_WRITE")) return undefined;
      return `/rules/new?deviceId=${encodeURIComponent(device.id)}${device.space?.id ? `&spaceId=${encodeURIComponent(device.space.id)}` : ""}`;
    default:
      return undefined;
  }
}
