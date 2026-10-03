/**
 * M3 기본 노드 카탈로그 픽스처(API-FLW-30 모양). 단위·화면 테스트와 가짜 gateway(test/msw/handlers/flows.ts)가 함께 쓴다.
 */
import type { NodeType } from "../types";

const target = { type: "object", "x-widget": "target", title: "대상" } as const;

export const M3_NODE_TYPES: NodeType[] = [
  {
    type: "trigger.telemetry",
    typeVersion: 1,
    category: "trigger",
    name: "텔레메트리",
    description: "기기·공간·모델 범위의 측정값이 들어올 때 시작합니다",
    icon: "bolt",
    inputs: [],
    outputs: [{ name: "out", type: "message" }],
    configSchema: { type: "object", required: ["target", "metrics"], properties: { target, metrics: { type: "array", minItems: 1, items: { type: "string" }, "x-widget": "metric", title: "측정 항목" } } },
  },
  {
    type: "trigger.schedule",
    typeVersion: 1,
    category: "trigger",
    name: "스케줄",
    description: "cron 또는 운영 시간표에 맞춰 시작합니다",
    icon: "clock",
    inputs: [],
    outputs: [{ name: "out", type: "message" }],
    configSchema: { type: "object", required: ["cron"], properties: { cron: { type: "string", minLength: 9, maxLength: 100, title: "cron" }, timezone: { type: "string", default: "Asia/Seoul", title: "시간대" } } },
  },
  {
    type: "condition.threshold",
    typeVersion: 1,
    category: "condition",
    name: "임계값",
    description: "기준값과 비교하고 지속 시간·해제 값을 적용합니다",
    icon: "diamond",
    inputs: [{ name: "in", type: "message" }],
    outputs: [
      { name: "true", type: "message" },
      { name: "false", type: "message" },
    ],
    statePolicy: { metric: "RESET", op: "RESET", value: "KEEP", for: "KEEP", clear: "KEEP" },
    configSchema: {
      type: "object",
      required: ["metric", "op", "value"],
      properties: {
        metric: { type: "string", "x-widget": "metric", title: "측정 항목" },
        op: { type: "string", enum: [">", ">=", "<", "<=", "==", "!=", "outside", "inside"], default: ">", title: "연산자" },
        value: { type: "number", title: "값" },
        for: { type: "string", format: "duration", title: "지속" },
        clear: { type: "number", title: "해제 값" },
        repeat: { type: "integer", minimum: 1, maximum: 100, title: "반복" },
      },
    },
  },
  {
    type: "condition.timeWindow",
    typeVersion: 1,
    category: "condition",
    name: "시간 창",
    description: "요일·시간대 안인지 확인합니다",
    icon: "calendar",
    inputs: [{ name: "in", type: "message" }],
    outputs: [
      { name: "true", type: "message" },
      { name: "false", type: "message" },
    ],
    configSchema: { type: "object", required: ["from", "to"], properties: { days: { type: "array", items: { type: "string", enum: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] }, title: "요일" }, from: { type: "string", minLength: 5, maxLength: 5, title: "시작" }, to: { type: "string", minLength: 5, maxLength: 5, title: "끝" } } },
  },
  {
    type: "transform.aggregate",
    typeVersion: 1,
    category: "transform",
    name: "집계·창",
    description: "N분 평균, 여러 기기 평균·최대",
    icon: "sigma",
    inputs: [{ name: "in", type: "message" }],
    outputs: [{ name: "out", type: "message" }],
    configSchema: {
      type: "object",
      required: ["window", "fn"],
      properties: { window: { type: "string", format: "duration", default: "PT5M", title: "창" }, fn: { type: "string", enum: ["avg", "min", "max", "sum", "count"], default: "avg", title: "함수" }, groupBy: { type: "string", enum: ["device", "space", "all"], default: "space", title: "묶음" } },
    },
  },
  {
    type: "transform.js",
    typeVersion: 1,
    category: "transform",
    name: "JavaScript 함수",
    description: "메시지를 받아 가공해 반환합니다(SCR과 같은 실행 환경과 제한)",
    icon: "code",
    inputs: [{ name: "in", type: "message" }],
    outputs: [{ name: "out1", type: "message", dynamic: true }],
    configSchema: { type: "object", required: ["code"], properties: { code: { type: "string", "x-widget": "code", default: "function main(msg, ctx) {\n  return msg;\n}\n", title: "코드" }, outputs: { type: "integer", minimum: 1, maximum: 10, default: 1, title: "출력 수" } } },
  },
  {
    type: "flow.delay",
    typeVersion: 1,
    category: "flow",
    name: "지연",
    description: "정한 시간만큼 기다린 뒤 보냅니다",
    icon: "hourglass",
    inputs: [{ name: "in", type: "message" }],
    outputs: [{ name: "out", type: "message" }],
    configSchema: { type: "object", required: ["duration"], properties: { duration: { type: "string", format: "duration", default: "PT1M", title: "기간" } } },
  },
  {
    type: "action.control",
    typeVersion: 1,
    category: "action",
    name: "기기 제어",
    description: "제어 창구를 거쳐 기기에 명령을 보냅니다",
    icon: "power",
    inputs: [{ name: "in", type: "message" }],
    outputs: [
      { name: "ok", type: "message" },
      { name: "failed", type: "message" },
    ],
    permissions: ["FLOW_DEPLOY_CONTROL"],
    configSchema: {
      type: "object",
      required: ["target", "capability", "command", "args"],
      properties: { target, capability: { type: "string", "x-widget": "capability", title: "기능" }, command: { type: "string", title: "명령" }, args: { type: "object", title: "인자" }, validitySeconds: { type: "integer", minimum: 60, maximum: 3600, default: 600, title: "유효 시간(초)" } },
    },
  },
  {
    type: "debug.log",
    typeVersion: 1,
    category: "debug",
    name: "디버그",
    description: "메시지를 디버그 패널에 남깁니다",
    icon: "bug",
    inputs: [{ name: "in", type: "message" }],
    outputs: [{ name: "out", type: "message" }],
    configSchema: { type: "object", properties: { level: { type: "string", enum: ["DEBUG", "INFO", "WARN"], default: "INFO", title: "수준" } } },
  },
];

/** 포트 타입 검사용(BR-FLW-03): 숫자 출력 노드와 불리언 입력 노드 */
export const TYPED_TEST_NODES: NodeType[] = [
  { type: "test.number", typeVersion: 1, category: "transform", name: "숫자", inputs: [{ name: "in", type: "message" }], outputs: [{ name: "value", type: "number" }] },
  { type: "test.boolean", typeVersion: 1, category: "condition", name: "불리언", inputs: [{ name: "in", type: "boolean" }], outputs: [{ name: "out", type: "message" }] },
];
