/**
 * 장기 토큰(API 키·MCP)·서비스 계정 화면 모델(UI-IAM-10, UI-AIA-07, IAM-04.07·05.01~05.04, design/api/IAM-api.md §5).
 * 범위와 권한의 짝은 contracts ApiScope와 같다. 화면은 역할이 가진 범위만 고를 수 있게 하고, 실제 판정은 core가 다시 한다.
 */

export type TokenKind = "MCP" | "API_KEY";
export type TokenStatus = "PENDING_APPROVAL" | "ACTIVE" | "ROTATING" | "REVOKED" | "EXPIRED" | "REJECTED";

/** API-IAM-41 항목(원문 없음) */
export interface TokenItem {
  id: string;
  kind: TokenKind;
  name: string;
  tokenPrefix: string;
  ownerType: "USER" | "SERVICE_ACCOUNT";
  ownerId: string;
  ownerName?: string | null;
  scopes: string[];
  spaceScope: string[];
  status: TokenStatus;
  expiresAt: string;
  rateLimitPerMin: number;
  lastUsedAt?: string | null;
  lastUsedIp?: string | null;
  graceUntil?: string | null;
  createdAt?: string | null;
}

/** API-IAM-40 응답(원문은 이때 한 번만) */
export interface IssuedToken {
  id: string;
  token: string;
  prefix: string;
  status: TokenStatus;
}

/** API-IAM-45 */
export interface ServiceAccount {
  id: string;
  name: string;
  description?: string | null;
  status: "ACTIVE" | "DISABLED";
  tokenCount: number;
  version?: number;
  createdAt?: string | null;
}

export interface ScopeInfo {
  code: string;
  /** 이 권한을 모두 가져야 고를 수 있다 */
  permissions: string[];
  /** 쓰기·제어 범위는 ADMIN 승인 뒤에 쓸 수 있다(BR-IAM-19) */
  approval: boolean;
}

export const SCOPES: ScopeInfo[] = [
  { code: "read:telemetry", permissions: ["TS_READ", "ALARM_READ"], approval: false },
  { code: "read:devices", permissions: ["DEV_READ", "FLOW_READ"], approval: false },
  { code: "read:analytics", permissions: ["ANALYTICS_READ", "ENE_READ"], approval: false },
  { code: "write:devices", permissions: ["DEV_PLACE"], approval: true },
  { code: "control:devices", permissions: ["DEVICE_CONTROL"], approval: true },
  { code: "mcp:write", permissions: ["ANALYTICS_RUN", "ALARM_HANDLE", "RULE_WRITE", "FLOW_WRITE"], approval: true },
];

/** 쓰기·제어 범위는 ADMIN·INTEGRATOR만 요청할 수 있다(core WRITE_SCOPE_ROLES) */
const WRITE_ROLES = ["ADMIN", "INTEGRATOR"];

/** 역할이 고를 수 있는 범위인가: 범위의 권한을 모두 갖고, 쓰기·제어 범위면 ADMIN·INTEGRATOR(core가 400 API_TOKEN_SCOPE_EXCEEDED로 다시 판정) */
export function scopeAllowed(scope: ScopeInfo, permissions: readonly string[] | undefined, role: string | undefined): boolean {
  const owned = new Set(permissions ?? []);
  if (!scope.permissions.every((p) => owned.has(p))) return false;
  return !scope.approval || WRITE_ROLES.includes(role ?? "");
}

export const MAX_GRACE_HOURS = 24;
export const DEFAULT_EXPIRY_DAYS = 90;
export const MCP_ENDPOINT = "https://data2flow-mcp.java21.net/mcp";

export interface IssueForm {
  kind: TokenKind;
  name: string;
  scopes: string[];
  spaceScope: string[];
  expiresOn: string;
  rateLimitPerMin: string;
  serviceAccountId?: string;
}

/** YYYY-MM-DD(현지) + n일 */
export function dateAfter(nowMs: number, days: number): string {
  const d = new Date(nowMs + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function validateIssue(form: IssueForm, nowMs: number): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = form.name.trim();
  if (name.length < 1 || name.length > 50) errors.name = "NAME";
  if (form.scopes.length === 0) errors.scopes = "SCOPES";
  const min = dateAfter(nowMs, 1);
  const max = dateAfter(nowMs, 365);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expiresOn) || form.expiresOn < min || form.expiresOn > max) errors.expiresOn = "EXPIRY";
  const rate = Number(form.rateLimitPerMin);
  if (form.rateLimitPerMin !== "" && (!Number.isInteger(rate) || rate < 1 || rate > 6000)) errors.rateLimitPerMin = "RATE";
  return errors;
}

/** 만료일(그날 끝, UTC)을 ISO로 */
export function expiryIso(expiresOn: string): string {
  return `${expiresOn}T23:59:59Z`;
}

export function issueBody(form: IssueForm) {
  return {
    kind: form.kind,
    name: form.name.trim(),
    scopes: form.scopes,
    spaceScope: form.spaceScope,
    expiresAt: expiryIso(form.expiresOn),
    ...(form.rateLimitPerMin ? { rateLimitPerMin: Number(form.rateLimitPerMin) } : {}),
    ...(form.serviceAccountId ? { serviceAccountId: form.serviceAccountId } : {}),
  };
}

/** 만료 7일 전부터 경고 배지 */
export function expiringSoon(item: Pick<TokenItem, "expiresAt" | "status">, nowMs: number): boolean {
  const left = Date.parse(item.expiresAt) - nowMs;
  return item.status === "ACTIVE" && left > 0 && left <= 7 * 86_400_000;
}

/** 클라이언트별 MCP 설정 예시(UI-AIA-07). 토큰 자리는 원문 또는 `<토큰>` */
export function mcpConfig(client: "claude-desktop" | "claude-code" | "json", token: string): string {
  if (client === "claude-code") return `claude mcp add --transport http data2flow ${MCP_ENDPOINT} --header "Authorization: Bearer ${token}"`;
  const config = { mcpServers: { data2flow: { type: "http", url: MCP_ENDPOINT, headers: { Authorization: `Bearer ${token}` } } } };
  if (client === "claude-desktop") return JSON.stringify(config, null, 2);
  return JSON.stringify({ url: MCP_ENDPOINT, transport: "streamable-http", headers: { Authorization: `Bearer ${token}` } }, null, 2);
}
