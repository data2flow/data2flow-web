/**
 * UI-RUL-07 알림 템플릿 모델(RUL-05.01, RUL-03.04, API-RUL-22). 변수 추출·알 수 없는 변수 경고·길이 한도.
 */
import { idOf, rowsOf, type NotificationTemplate, type TemplateVariable } from "./types";

/** 문서에 적힌 기본 변수(UI-RUL-07). 서버 변수 목록(API-RUL-22 variables)을 받지 못할 때 쓴다 */
export const DEFAULT_VARIABLES = ["alarm.severity", "alarm.title", "device.name", "space.path", "value", "threshold", "rule.name", "link", "occurredAt"];

/** 텔레그램 본문 한도 4,096자(채널 SPI capabilities.maxBodyLength). 다른 채널은 유형 정보의 값 */
export const DEFAULT_MAX_LENGTH: Record<string, number> = { TELEGRAM: 4096 };
export const SUBJECT_MAX = 200;

const VARIABLE = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;

/** 본문에 쓰인 변수 이름(중복 없이, 나온 순서) */
export function variablesIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(VARIABLE)) if (!out.includes(match[1])) out.push(match[1]);
  return out;
}

export function unknownVariables(text: string, known: readonly string[]): string[] {
  const set = new Set(known);
  return variablesIn(text).filter((name) => !set.has(name));
}

export type TemplateProblem = "bodyRequired" | "bodyTooLong" | "subjectTooLong";

export function checkTemplate(input: { subject: string; body: string }, maxLength: number): TemplateProblem | undefined {
  if (!input.body.trim()) return "bodyRequired";
  if (input.body.length > maxLength) return "bodyTooLong";
  if (input.subject.length > SUBJECT_MAX) return "subjectTooLong";
  return undefined;
}

/** 커서 위치에 `{{name}}`을 넣은 새 문자열과 다음 커서 위치 */
export function insertVariable(text: string, start: number, end: number, name: string): { text: string; cursor: number } {
  const token = `{{${name}}}`;
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return { text: text.slice(0, s) + token + text.slice(e), cursor: s + token.length };
}

export function normalizeTemplate(raw: Record<string, unknown>): NotificationTemplate {
  return {
    notificationTemplateId: idOf(raw, "notificationTemplateId"),
    templateKey: String(raw.templateKey ?? ""),
    channel: String(raw.channel ?? ""),
    locale: String(raw.locale ?? "ko"),
    subject: raw.subject === undefined || raw.subject === null ? null : String(raw.subject),
    body: String(raw.body ?? ""),
    builtin: raw.builtin === true,
    version: Number(raw.version ?? 0),
    updatedAt: raw.updatedAt as string | undefined,
  };
}

/** 변수 목록 응답은 문자열 배열 또는 `{name, description}` 목록일 수 있다 */
export function normalizeVariables(value: unknown): TemplateVariable[] {
  const rows = rowsOf<unknown>(value);
  const out = rows
    .map((row) => (typeof row === "string" ? { name: row } : { name: String((row as TemplateVariable).name ?? ""), description: (row as TemplateVariable).description }))
    .filter((v) => v.name);
  return out.length ? out : DEFAULT_VARIABLES.map((name) => ({ name }));
}

/** 저장 경고(TEMPLATE_VARIABLE_UNKNOWN)의 변수 이름 */
export function warningNames(value: unknown): string[] {
  const warnings = (value as { warnings?: { code?: string; name?: string }[] } | null | undefined)?.warnings ?? [];
  return warnings.filter((w) => w.code === "TEMPLATE_VARIABLE_UNKNOWN" && w.name).map((w) => String(w.name));
}
