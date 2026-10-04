/**
 * 알림 채널 설정 폼을 채널 SPI 설정 스키마로 만든다(OPS-06.06, BR-OPS-32, API-OPS-34, TC-OPS-143).
 * JSON Schema 2020-12 중 채널 설정에 쓰는 부분만 그린다: 문자열·정수·실수·참거짓·열거·문자열/정수 목록.
 * 비밀값은 설정(config)이 아니라 `secret`으로 보낸다(API-OPS-30, contracts ChannelSettings.secrets). 스키마에서
 * `writeOnly`·`x-secret`·`format: password`인 속성이 비밀값이다. 스키마에 비밀값이 없는 텔레그램은 문서(OPS-06.01,
 * OPS domain-model §채널 설정)의 봇 토큰·웹훅 시크릿 토큰을 비밀값으로 더한다.
 */
import type { JsonSchema } from "./types";

export type FieldKind = "string" | "secret" | "integer" | "number" | "boolean" | "enum" | "stringList" | "integerList";

export interface SchemaField {
  name: string;
  kind: FieldKind;
  title?: string;
  description?: string;
  required: boolean;
  enumValues?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  defaultValue?: unknown;
}

/** 텔레그램 형식(UI-OPS-06 입력 검증): 봇 토큰 `숫자:문자열`, chat_id 숫자(음수 허용)·최대 20개, 웹훅 시크릿 1~256자 [A-Za-z0-9_-] */
export const TELEGRAM_BOT_TOKEN = "^\\d{3,20}:[A-Za-z0-9_-]{20,}$";
export const TELEGRAM_WEBHOOK_SECRET = "^[A-Za-z0-9_-]{1,256}$";

/** API-OPS-34가 스키마를 주지 않을 때 쓰는 텔레그램 스키마(action TelegramChannel.configSchema와 같다: chat_id는 숫자 문자열) */
export const TELEGRAM_FALLBACK_SCHEMA: JsonSchema = {
  type: "object",
  required: ["chatIds"],
  properties: {
    chatIds: { type: "array", items: { type: "string", pattern: "^-?[0-9]+$" }, minItems: 1, maxItems: 20 },
    botUsername: { type: "string", pattern: "^[A-Za-z0-9_]{5,32}$" },
    parseMode: { enum: ["MarkdownV2", "PLAIN"], default: "MarkdownV2" },
  },
};

const TELEGRAM_SECRETS: SchemaField[] = [
  { name: "botToken", kind: "secret", required: true, pattern: TELEGRAM_BOT_TOKEN },
  { name: "webhookSecret", kind: "secret", required: true, pattern: TELEGRAM_WEBHOOK_SECRET },
];

function typeOf(schema: JsonSchema): string | undefined {
  return Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
}

function fieldOf(name: string, schema: JsonSchema, required: boolean): SchemaField | undefined {
  const base = { name, title: schema.title, description: schema.description, required, defaultValue: schema.default };
  if (schema.writeOnly || schema["x-secret"] || schema.format === "password") return { ...base, kind: "secret", minLength: schema.minLength, maxLength: schema.maxLength, pattern: schema.pattern };
  if (Array.isArray(schema.enum)) return { ...base, kind: "enum", enumValues: schema.enum.map(String) };
  const type = typeOf(schema);
  if (type === "string") return { ...base, kind: "string", minLength: schema.minLength, maxLength: schema.maxLength, pattern: schema.pattern };
  if (type === "integer" || type === "number") return { ...base, kind: type, minimum: schema.minimum, maximum: schema.maximum };
  if (type === "boolean") return { ...base, kind: "boolean" };
  if (type === "array" && schema.items) {
    const itemType = typeOf(schema.items);
    if (itemType === "string" || itemType === "integer") return { ...base, kind: itemType === "string" ? "stringList" : "integerList", minItems: schema.minItems, maxItems: schema.maxItems, pattern: schema.items.pattern, minimum: schema.items.minimum, maximum: schema.items.maximum };
  }
  // 그리지 못하는 모양(중첩 객체 등)은 건너뛴다. 서버가 SETTING_INVALID로 거부한다
  return undefined;
}

/**
 * 스키마 → 폼 필드 목록(속성 순서 그대로). 비밀값 필드는 뒤에.
 * `secretSchema`(core 기본 유형 목록)가 있으면 그 속성은 모두 비밀값이다. 텔레그램은 같은 이름의 형식 규칙(TELEGRAM_SECRETS)을 쓴다.
 */
export function schemaFields(type: string, schema: JsonSchema | null | undefined, secretSchema?: JsonSchema | null): SchemaField[] {
  const source = schema?.properties ? schema : type === "TELEGRAM" ? TELEGRAM_FALLBACK_SCHEMA : { properties: {} };
  const required = new Set(source.required ?? []);
  const fields = Object.entries(source.properties ?? {})
    .map(([name, prop]) => fieldOf(name, prop, required.has(name)))
    .filter((f): f is SchemaField => Boolean(f));
  const secretRequired = new Set(secretSchema?.required ?? []);
  for (const [name, prop] of Object.entries(secretSchema?.properties ?? {})) {
    if (fields.some((f) => f.name === name)) continue;
    const known = type === "TELEGRAM" ? TELEGRAM_SECRETS.find((f) => f.name === name) : undefined;
    fields.push(known ?? { name, kind: "secret", title: prop.title, description: prop.description, required: secretRequired.has(name), minLength: prop.minLength, maxLength: prop.maxLength, pattern: prop.pattern });
  }
  if (type === "TELEGRAM") for (const secret of TELEGRAM_SECRETS) if (!fields.some((f) => f.name === secret.name)) fields.push(secret);
  return [...fields.filter((f) => f.kind !== "secret"), ...fields.filter((f) => f.kind === "secret")];
}

export type FieldProblem = "required" | "pattern" | "tooShort" | "tooLong" | "notInteger" | "notNumber" | "range" | "tooFewItems" | "tooManyItems" | "notInEnum";

function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function checkString(field: SchemaField, value: string): FieldProblem | undefined {
  if (field.minLength !== undefined && value.length < field.minLength) return "tooShort";
  if (field.maxLength !== undefined && value.length > field.maxLength) return "tooLong";
  if (field.pattern && !new RegExp(field.pattern).test(value)) return "pattern";
  return undefined;
}

function checkNumber(field: SchemaField, value: number): FieldProblem | undefined {
  if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) return "range";
  return undefined;
}

export interface ParsedChannelForm {
  config: Record<string, unknown>;
  secret: Record<string, string>;
  errors: Record<string, FieldProblem>;
}

/**
 * 폼 값(`cfg.<이름>`, `secret.<이름>`) → 설정·비밀값. 수정할 때(`hasSecret`) 비밀값은 바꿀 때만 입력하므로 비어 있으면 보내지 않는다.
 */
export function parseChannelForm(fields: SchemaField[], read: (name: string) => string, options: { editing: boolean; hasSecret: boolean }): ParsedChannelForm {
  const config: Record<string, unknown> = {};
  const secret: Record<string, string> = {};
  const errors: Record<string, FieldProblem> = {};
  for (const field of fields) {
    const raw = read(field.kind === "secret" ? `secret.${field.name}` : `cfg.${field.name}`);
    const value = raw.trim();
    if (field.kind === "secret") {
      if (!value) {
        if (field.required && !(options.editing && options.hasSecret)) errors[field.name] = "required";
        continue;
      }
      const problem = checkString(field, value);
      if (problem) errors[field.name] = problem;
      else secret[field.name] = value;
      continue;
    }
    if (field.kind === "boolean") {
      config[field.name] = raw === "on" || raw === "true";
      continue;
    }
    if (field.kind === "stringList" || field.kind === "integerList") {
      const items = splitList(raw);
      if (items.length === 0) {
        if (field.required) errors[field.name] = "required";
        continue;
      }
      if (field.minItems !== undefined && items.length < field.minItems) errors[field.name] = "tooFewItems";
      else if (field.maxItems !== undefined && items.length > field.maxItems) errors[field.name] = "tooManyItems";
      else if (field.kind === "integerList") {
        const numbers = items.map((v) => (/^-?\d+$/.test(v) ? Number(v) : NaN));
        if (numbers.some((n) => !Number.isSafeInteger(n))) errors[field.name] = "notInteger";
        else {
          const problem = numbers.map((n) => checkNumber(field, n)).find(Boolean);
          if (problem) errors[field.name] = problem;
          else config[field.name] = numbers;
        }
      } else {
        const problem = items.map((v) => (field.pattern && !new RegExp(field.pattern).test(v) ? "pattern" : undefined)).find(Boolean) as FieldProblem | undefined;
        if (problem) errors[field.name] = problem;
        else config[field.name] = items;
      }
      continue;
    }
    if (!value) {
      if (field.required) errors[field.name] = "required";
      continue;
    }
    if (field.kind === "enum") {
      if (!field.enumValues?.includes(value)) errors[field.name] = "notInEnum";
      else config[field.name] = value;
    } else if (field.kind === "integer") {
      const n = /^-?\d+$/.test(value) ? Number(value) : NaN;
      const problem = Number.isSafeInteger(n) ? checkNumber(field, n) : "notInteger";
      if (problem) errors[field.name] = problem;
      else config[field.name] = n;
    } else if (field.kind === "number") {
      const n = Number(value);
      const problem = Number.isFinite(n) ? checkNumber(field, n) : "notNumber";
      if (problem) errors[field.name] = problem;
      else config[field.name] = n;
    } else {
      const problem = checkString(field, value);
      if (problem) errors[field.name] = problem;
      else config[field.name] = value;
    }
  }
  return { config, secret, errors };
}

/** 저장된 설정을 폼 기본값 문자열로(목록은 줄마다 하나) */
export function fieldDefault(field: SchemaField, config: Record<string, unknown> | undefined): string {
  const value = config?.[field.name] ?? field.defaultValue;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(String).join("\n");
  return String(value);
}

/** 목록 화면의 "대상 요약"(텔레그램: 채팅방 n개) */
export function targetCount(config: Record<string, unknown>): number {
  const list = Object.values(config).find(Array.isArray) as unknown[] | undefined;
  return list?.length ?? 0;
}

export const RATE_LIMIT_MIN = 1;
export const RATE_LIMIT_MAX = 600;
export const DIGEST_MAX = 900;

export type CommonProblem = "nameRequired" | "nameTooLong" | "rateRange" | "digestRange";

/** 공통 필드(이름 1~50자, 분당 한도, 묶음 창 0~900초 — ERD notification_channels) */
export function checkCommon(input: { name: string; rateLimitPerMin: number; digestWindowSec: number }): Partial<Record<"name" | "rateLimitPerMin" | "digestWindowSec", CommonProblem>> {
  const errors: Partial<Record<"name" | "rateLimitPerMin" | "digestWindowSec", CommonProblem>> = {};
  if (!input.name.trim()) errors.name = "nameRequired";
  else if (input.name.trim().length > 50) errors.name = "nameTooLong";
  if (!Number.isInteger(input.rateLimitPerMin) || input.rateLimitPerMin < RATE_LIMIT_MIN || input.rateLimitPerMin > RATE_LIMIT_MAX) errors.rateLimitPerMin = "rateRange";
  if (!Number.isInteger(input.digestWindowSec) || input.digestWindowSec < 0 || input.digestWindowSec > DIGEST_MAX) errors.digestWindowSec = "digestRange";
  return errors;
}
