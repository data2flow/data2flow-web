/**
 * 플로우 정의와 노드 카탈로그 형식(design/api/FLW-api.md §3 API-FLW-30, §5 `data2flow.flow-definition/v1`).
 */

export const FLOW_DEFINITION_SCHEMA = "data2flow.flow-definition/v1";

export interface PortSpec {
  name: string;
  /** 포트 타입. `any`는 모두와 호환, `error`는 공통 오류 포트 */
  type: string;
  dynamic?: boolean;
}

/** JSON Schema 부분 집합(설정 폼 자동 생성·화면 검증용, UI-FLW-16) */
export interface ConfigSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, ConfigSchema>;
  required?: string[];
  enum?: (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: ConfigSchema;
  format?: string;
  default?: unknown;
  /** 화면 위젯 힌트: duration · target · space · metric · code · capability */
  "x-widget"?: string;
  oneOf?: ConfigSchema[];
}

/** API-FLW-30 NodeType */
export interface NodeType {
  type: string;
  typeVersion: number;
  category: string;
  name: string;
  description?: string;
  icon?: string;
  configSchema?: ConfigSchema;
  inputs: PortSpec[];
  outputs: PortSpec[];
  statePolicy?: Record<string, string>;
  permissions?: string[];
  defaults?: Record<string, unknown>;
}

export interface RetryPolicy {
  maxAttempts?: number;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface FlowNode {
  id: string;
  type: string;
  typeVersion: number;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  retry?: RetryPolicy;
  position: { x: number; y: number };
  /** 동적 출력 포트 이름(flow-definition.v1 `nodes[].outputs`). 편집기는 바꾸지 않고 그대로 저장한다 */
  outputs?: string[];
  /** 끈 노드(flow-definition.v1 `nodes[].disabled`) */
  disabled?: boolean;
}

export interface Wire {
  from: string;
  port: string;
  to: string;
}

export interface FlowDefinition {
  schema: string;
  mode?: Record<string, unknown>;
  variables?: unknown[];
  nodes: FlowNode[];
  wires: Wire[];
  subflows?: unknown[];
}

/** 편집 중인 그래프(정의와 같은 내용 + 정의의 나머지 필드) */
export interface FlowGraph {
  nodes: FlowNode[];
  wires: Wire[];
  /** mode·variables·subflows 등 편집기가 바꾸지 않는 필드 */
  extra: Omit<FlowDefinition, "schema" | "nodes" | "wires">;
}

/**
 * 검증 문제(API-FLW-06 errors·warnings + 화면 검증). 서버는 api-rules §5 모양 `{field, code, message}`만 준다(ADR-044):
 * `field`가 `nodes[<id>]…`이면 그 노드, `wires[<i>]…`이면 i번째 연결선이다. 편집기는 `normalizeIssues`로 nodeId·path·wire를 채운다.
 */
export interface ValidationIssue {
  code: string;
  /** 서버 문제 위치(`nodes[n-abc].config.value`, `wires[2].port`, `definition`) */
  field?: string;
  nodeId?: string;
  nodeIds?: string[];
  wire?: Wire | string;
  path?: string;
  message?: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export type FlowStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "DEGRADED" | "DISABLED" | "DELETED";

/** API-FLW-02 응답 */
export interface FlowDetail {
  flow: {
    flowId: string;
    name: string;
    description?: string | null;
    kind?: string;
    status: FlowStatus;
    environment?: string;
    activeVersion?: number | null;
    draftVersion?: number | null;
    relatedSpaceIds?: string[];
    version?: number;
    updatedAt?: string;
  };
  version: {
    version: number;
    state: string;
    baseVersion?: number | null;
    definition: FlowDefinition;
    validation?: ValidationResult | null;
    changeSummary?: unknown;
    memo?: string | null;
    appliedBy?: { userId: string; name: string } | null;
    appliedAt?: string | null;
  };
  overlay?: { bypass: string[]; debug: string[]; revision: number };
  applyStatus?: { targetVersion: number; instances: { instanceId: string; appliedVersion: number; reportedAt?: string }[]; converged: boolean } | null;
  editors?: { userId: string; name: string; since: string }[];
  emergencyStop?: { active: boolean; scope?: unknown; since?: string } | null;
}

/** API-FLW-06 응답 */
export interface ValidateResponse extends ValidationResult {
  changeSummary?: { added?: string[]; removed?: { nodeId: string; retainedState: boolean }[]; changed?: { nodeId: string; statePolicy: "KEEP" | "RESET" | "MIGRATE" }[] };
  risky?: { controlNodesChanged: boolean; executionModeChanged: boolean };
  approvalRequired?: boolean;
}

/** API-FLW-04 version-diff 응답 */
export interface VersionDiff {
  added: string[];
  removed: string[];
  changed: { nodeId: string; fields: string[]; statePolicy?: string }[];
  wires?: { added: unknown[]; removed: unknown[] };
  settings?: string[];
}

export interface VersionRow {
  version: number;
  state: string;
  appliedBy?: { userId: string; name: string } | null;
  appliedAt?: string | null;
  memo?: string | null;
  hasControlNode?: boolean;
}

/** API-FLW-14 응답 */
export interface FlowMetrics {
  summary: { executions: number; errors: number; errorRate: number; avgMs?: number; p95Ms?: number; actions?: { command: number; notify: number; sink: number }; droppedTriggers?: number };
  nodes: { nodeId: string; processed: number; errors: number; avgMs?: number }[];
  series?: { t: string; executions: number; errors: number }[];
}
