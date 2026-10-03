/**
 * 스크립트 함수 계약 타입(design/api/SCR-api.md "함수 계약", SCR-01.04 헬퍼). 편집기 자동완성에 넣는다(SCR-03.01).
 * `decode(msg, ctx)`는 원본을 표준 메시지로, `transform(msg, ctx)`는 표준 메시지를 보정·파생한다.
 */
export const CONTRACT_TYPES = `
/** 표준 측정값 하나 */
interface Metric { key: string; value: number | boolean | string | null; unit?: string; quality?: number; }
/** 표준 메시지(CanonicalTelemetry v1) */
interface CanonicalMessage {
  externalId: string;
  measuredAt: string;
  metrics: Metric[];
  meta?: Record<string, unknown>;
}
/** DECODE 입력: 수신한 원본 */
interface RawMessage {
  topic: string;
  /** JSON이면 객체, 아니면 base64 문자열 */
  payload: unknown;
  receivedAt: string;
  source: { code: string; config?: Record<string, unknown> };
}
/** 헬퍼(SCR-01.04) */
interface ScriptUtil {
  /** 섭씨 → 화씨 */ cToF(c: number): number;
  /** 화씨 → 섭씨 */ fToC(f: number): number;
  /** 단위 변환(예: "hPa" → "kPa") */ convert(value: number, from: string, to: string): number;
  /** 이슬점(℃) */ dewPoint(temperatureC: number, humidityPct: number): number;
  /** 불쾌지수 */ thi(temperatureC: number, humidityPct: number): number;
  round(value: number, digits?: number): number;
  clamp(value: number, min: number, max: number): number;
  readUInt8(bytes: Uint8Array, offset: number): number;
  readInt16LE(bytes: Uint8Array, offset: number): number;
  readUInt16LE(bytes: Uint8Array, offset: number): number;
  readInt16BE(bytes: Uint8Array, offset: number): number;
  readUInt16BE(bytes: Uint8Array, offset: number): number;
  readUInt32LE(bytes: Uint8Array, offset: number): number;
  readFloatLE(bytes: Uint8Array, offset: number): number;
  base64ToBytes(text: string): Uint8Array;
  bytesToBase64(bytes: Uint8Array): string;
  hexToBytes(hex: string): Uint8Array;
  bytesToHex(bytes: Uint8Array): string;
}
interface ScriptContext {
  device: { id: string; name?: string; modelCode?: string; attributes: Record<string, unknown> };
  /** 측정 항목별 직전 값 */
  last: Record<string, number | boolean | string | null>;
  /** 스크립트 설정값 */
  config: Record<string, unknown>;
  util: ScriptUtil;
  modules: Record<string, unknown>;
}
declare const ctx: ScriptContext;
declare const msg: CanonicalMessage;
declare const console: { log(...args: unknown[]): void };
`;
