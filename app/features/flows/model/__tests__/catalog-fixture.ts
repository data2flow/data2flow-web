/**
 * 노드 카탈로그 픽스처(API-FLW-30 모양). 단위·화면 테스트와 가짜 gateway(test/msw/handlers/flows.ts)가 함께 쓴다.
 * `core-node-types.json`은 data2flow-core-api `src/main/resources/flow/node-types.json`(M3 16종 + 엔진 M4 6종 = 22종, ADR-051)을
 * 그대로 복사한 것이다. core 카탈로그가 바뀌면 이 파일도 함께 바꾼다(모든 노드에 `error` 출력 포트, condition.group, noData restored).
 */
import type { NodeType } from "../types";
import coreNodeTypes from "./core-node-types.json";

/** core가 내려 주는 노드 카탈로그 22종 그대로 */
export const CORE_NODE_TYPES: NodeType[] = coreNodeTypes as unknown as NodeType[];

/** 예전 이름(M3) — 같은 core 카탈로그를 가리킨다 */
export const M3_NODE_TYPES: NodeType[] = CORE_NODE_TYPES;

/** 포트 타입 검사용(BR-FLW-03): 숫자 출력 노드와 불리언 입력 노드 */
export const TYPED_TEST_NODES: NodeType[] = [
  { type: "test.number", typeVersion: 1, category: "transform", name: "숫자", inputs: [{ name: "in", type: "message" }], outputs: [{ name: "value", type: "number" }] },
  { type: "test.boolean", typeVersion: 1, category: "condition", name: "불리언", inputs: [{ name: "in", type: "boolean" }], outputs: [{ name: "out", type: "message" }] },
];
