import { describe, expect, it } from "vitest";
import {
  NODE_ID_PATTERN,
  addNode,
  alignToGrid,
  canConnect,
  catalogOf,
  configSummary,
  connect,
  createFlowGraph,
  distanceToSegment,
  emptyGraph,
  fromDefinition,
  hasThroughWires,
  insertOnWire,
  isControlNode,
  moveNodes,
  newNodeId,
  outputPorts,
  inputPorts,
  referencedSpaceIds,
  removeNodes,
  removeWire,
  setPosition,
  toDefinition,
  updateNode,
  wireUnder,
} from "../flow-graph";
import { checkDuration, isoToSeconds, joinDuration, secondsToIso, splitDuration } from "../duration";
import { issueNodeIds, nodeProblems, normalizeIssue, normalizeIssues, validateConfig, validateGraph } from "../validation";
import { M3_NODE_TYPES, TYPED_TEST_NODES } from "./catalog-fixture";

const catalog = catalogOf([...M3_NODE_TYPES, ...TYPED_TEST_NODES]);

describe("FLW-01.01 TC-FLW-001 AT-FLW-02.1 노드 놓기와 와이어 연결 → 초안 정의", () => {
  it("트리거와 임계값 노드를 놓고 연결하면 정의에 노드 2개·와이어 1개, ID는 n- + 8자 이상으로 고정", () => {
    let graph = emptyGraph();
    const a = addNode(graph, "trigger.telemetry", catalog);
    graph = a.graph;
    const b = addNode(graph, "condition.threshold", catalog);
    graph = b.graph;
    const connected = connect(graph, { from: a.node.id, port: "out", to: b.node.id }, catalog);
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    const definition = toDefinition(connected.graph);
    expect(definition.schema).toBe("data2flow.flow-definition/v1");
    expect(definition.nodes).toHaveLength(2);
    expect(definition.wires).toEqual([{ from: a.node.id, port: "out", to: b.node.id }]);
    expect(a.node.id).toMatch(NODE_ID_PATTERN);
    expect(b.node.id).toMatch(NODE_ID_PATTERN);
    // 다시 읽어도 같은 ID(고정)
    expect(fromDefinition(definition).nodes.map((n) => n.id)).toEqual([a.node.id, b.node.id]);
    expect(definition.nodes[1].config).toMatchObject({ op: ">" });
    expect(definition.nodes[1].position.x % 16).toBe(0);
  });

  it("ID 충돌이면 다시 만든다, 정의의 mode·variables는 보존", () => {
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const id = newNodeId(["n-aaaaaaaa"], () => values[i++ % values.length]);
    expect(id).toBe("n-ssssssss");
    const graph = fromDefinition({ schema: "data2flow.flow-definition/v1", mode: { concurrency: "single" }, variables: [{ name: "x" }], nodes: [], wires: [] });
    expect(toDefinition(graph)).toMatchObject({ mode: { concurrency: "single" }, variables: [{ name: "x" }] });
    expect(fromDefinition(null).nodes).toEqual([]);
  });
});

describe("FLW-01.01 TC-FLW-002 AT-FLW-02.3 노드 50개 규모 편집이 끊기지 않음", () => {
  it("50개 노드에서 이동·정렬·연결·검증 한 번이 한 프레임(33ms) 안", () => {
    let graph = emptyGraph();
    for (let i = 0; i < 50; i += 1) graph = addNode(graph, i === 0 ? "trigger.telemetry" : "debug.log", catalog, { position: { x: i * 200, y: (i % 5) * 100 } }).graph;
    for (let i = 1; i < 50; i += 1) {
      const result = connect(graph, { from: graph.nodes[i - 1].id, port: "out", to: graph.nodes[i].id }, catalog);
      if (result.ok) graph = result.graph;
    }
    expect(graph.wires).toHaveLength(49);
    const ids = graph.nodes.map((n) => n.id);
    const ops: (() => unknown)[] = [() => moveNodes(graph, ids, 7, 3), () => alignToGrid(moveNodes(graph, ids, 7, 3)), () => validateGraph(graph, catalog), () => toDefinition(graph), () => connect(graph, { from: ids[3], port: "out", to: ids[40] }, catalog)];
    for (const op of ops) {
      const start = performance.now();
      op();
      expect(performance.now() - start).toBeLessThan(33);
    }
  });
});

describe("FLW-01.03 TC-FLW-005 BR-FLW-03 connect() 규칙", () => {
  const graph = createFlowGraph(catalog).node("trigger.telemetry", "n-trigger01").node("test.number", "n-number01").node("test.boolean", "n-boolean1").node("condition.threshold", "n-thresh01").node("action.control", "n-action01").wire("n-trigger01", "out", "n-number01").build();

  it("number 출력 → boolean 입력은 거부(TYPE_MISMATCH)", () => {
    expect(connect(graph, { from: "n-number01", port: "value", to: "n-boolean1" }, catalog)).toEqual({ ok: false, reason: "TYPE_MISMATCH" });
    expect(canConnect(graph, { from: "n-number01", port: "value", to: "n-boolean1" }, catalog)).toBe(false);
  });

  it("같은 포트 쌍 중복, 자기 자신, 없는 포트·노드, 입력 없는 트리거는 거부", () => {
    expect(connect(graph, { from: "n-trigger01", port: "out", to: "n-number01" }, catalog)).toEqual({ ok: false, reason: "DUPLICATE" });
    expect(connect(graph, { from: "n-thresh01", port: "true", to: "n-thresh01" }, catalog)).toEqual({ ok: false, reason: "SELF" });
    expect(connect(graph, { from: "n-thresh01", port: "maybe", to: "n-action01" }, catalog)).toEqual({ ok: false, reason: "NO_PORT" });
    expect(connect(graph, { from: "n-thresh01", port: "true", to: "n-nothing1" }, catalog)).toEqual({ ok: false, reason: "UNKNOWN_NODE" });
    expect(connect(graph, { from: "n-thresh01", port: "true", to: "n-trigger01" }, catalog)).toEqual({ ok: false, reason: "NO_INPUT" });
  });

  it("분기 포트(true/false)마다 다른 와이어, 연결 후 edges.length +1, 공통 error 포트는 message 입력에 이어진다", () => {
    const step1 = connect(graph, { from: "n-trigger01", port: "out", to: "n-thresh01" }, catalog);
    expect(step1.ok && step1.graph.wires.length).toBe(graph.wires.length + 1);
    if (!step1.ok) return;
    const step2 = connect(step1.graph, { from: "n-thresh01", port: "true", to: "n-action01" }, catalog);
    const step3 = step2.ok ? connect(step2.graph, { from: "n-thresh01", port: "false", to: "n-boolean1" }, catalog) : step2;
    expect(step3.ok).toBe(false); // message → boolean
    const step4 = step2.ok ? connect(step2.graph, { from: "n-action01", port: "error", to: "n-number01" }, catalog) : step2;
    expect(step4.ok).toBe(true);
    expect(outputPorts({ type: "condition.threshold", config: {} }, catalog).map((p) => p.name)).toEqual(["true", "false", "error"]);
    // contracts flow-node-type.v1: 트리거를 포함한 모든 노드에 error 출력 포트
    expect(outputPorts({ type: "trigger.telemetry", config: {} }, catalog).map((p) => p.name)).toEqual(["out", "error"]);
    expect(outputPorts({ type: "transform.js", config: { outputs: 3 } }, catalog).map((p) => p.name)).toEqual(["out1", "out2", "out3", "error"]);
    expect(outputPorts({ type: "unknown.x", config: {} }).map((p) => p.name)).toEqual(["out", "error"]);
    expect(inputPorts({ type: "unknown.x" })).toEqual([{ name: "in", type: "any" }]);
    expect(inputPorts({ type: "trigger.unknown" })).toEqual([]);
  });

  it("제어·장면 노드는 제어 배포 권한이 필요한 노드", () => {
    expect(isControlNode("action.control", catalog)).toBe(true);
    expect(isControlNode("action.scene")).toBe(true);
    expect(isControlNode("debug.log", catalog)).toBe(false);
  });
});

describe("FLW-01.01 노드 삭제(앞뒤 잇기)·와이어 위 드롭(자동 재연결)", () => {
  const base = createFlowGraph(catalog).node("trigger.telemetry", "n-trigger01").node("transform.aggregate", "n-agg00001").node("condition.threshold", "n-thresh01").wire("n-trigger01", "out", "n-agg00001").wire("n-agg00001", "out", "n-thresh01").build();

  it("앞뒤를 이을까요? 예 → trigger → threshold 직접 연결, 아니요 → 와이어 없이", () => {
    expect(hasThroughWires(base, "n-agg00001")).toBe(true);
    expect(hasThroughWires(base, "n-trigger01")).toBe(false);
    expect(removeNodes(base, ["n-agg00001"], { reconnect: true, catalog }).wires).toEqual([{ from: "n-trigger01", port: "out", to: "n-thresh01" }]);
    expect(removeNodes(base, ["n-agg00001"]).wires).toEqual([]);
    expect(removeWire(base, { from: "n-trigger01", port: "out", to: "n-agg00001" }).wires).toHaveLength(1);
  });

  it("와이어 위에 노드를 놓으면 from → 새 노드 → to로 다시 잇는다", () => {
    let graph = addNode(base, "debug.log", catalog, { id: "n-debug001", position: { x: 0, y: 0 } }).graph;
    const trigger = graph.nodes[0].position;
    const agg = graph.nodes[1].position;
    graph = setPosition(graph, "n-debug001", { x: (trigger.x + 180 + agg.x) / 2 - 90, y: trigger.y });
    const wire = wireUnder(graph, "n-debug001");
    expect(wire).toEqual({ from: "n-trigger01", port: "out", to: "n-agg00001" });
    const result = insertOnWire(graph, wire!, "n-debug001", catalog);
    expect(result.ok && result.graph.wires).toEqual([
      { from: "n-agg00001", port: "out", to: "n-thresh01" },
      { from: "n-trigger01", port: "out", to: "n-debug001" },
      { from: "n-debug001", port: "out", to: "n-agg00001" },
    ]);
    expect(insertOnWire(graph, wire!, "n-trigger01", catalog).ok).toBe(false);
    // 이미 이어진 노드는 드롭 대상이 아니다
    expect(wireUnder(base, "n-agg00001")).toBeUndefined();
    expect(distanceToSegment({ x: 0, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("요약·공간 참조", () => {
  it("노드 카드 요약 문구와 대상 공간 ID", () => {
    let graph = createFlowGraph(catalog)
      .node("condition.threshold", "n-thresh01", { metric: "temperature", op: ">", value: 27, for: "PT5M" })
      .node("action.control", "n-action01", { target: { spaceId: "31", relation: "controls" }, capability: "Thermostat", command: "set", args: { mode: "cool", targetTemperature: 24 } })
      .node("trigger.telemetry", "n-trigger01", { metrics: ["temperature"] })
      .node("transform.aggregate", "n-agg00001", { fn: "avg", window: "PT5M" })
      .node("transform.js", "n-js000001", { outputs: 2 })
      .node("flow.delay", "n-delay001", { duration: "PT1M" })
      .node("trigger.schedule", "n-sched001", { cron: "0 9 * * MON" })
      .build();
    graph = updateNode(graph, "n-sched001", {});
    expect(graph.nodes.map(configSummary)).toEqual(["temperature > 27 · PT5M", "Thermostat.set(cool, 24)", "temperature", "avg · PT5M", "JS · 2 out", "PT1M", "0 9 * * MON"]);
    expect(configSummary({ id: "n-x", type: "debug.log", typeVersion: 1, name: "d", config: { level: "INFO" }, position: { x: 0, y: 0 } })).toBe("level=INFO");
    expect(configSummary({ id: "n-x", type: "debug.log", typeVersion: 1, name: "d", config: {}, position: { x: 0, y: 0 } })).toBe("");
    expect(referencedSpaceIds(graph)).toEqual(["31"]);
    expect(() => createFlowGraph(catalog).node("debug.log", "n-a0000001").wire("n-a0000001", "out", "n-a0000001")).toThrow(/SELF/);
  });
});

describe("UI-FLW-16 기간 위젯 ↔ ISO-8601", () => {
  it("PT5M ↔ 5분, 1초~24시간", () => {
    expect(isoToSeconds("PT5M")).toBe(300);
    expect(isoToSeconds("PT1H30M")).toBe(5400);
    expect(isoToSeconds("5m")).toBeNull();
    expect(isoToSeconds(3)).toBeNull();
    expect(secondsToIso(300)).toBe("PT5M");
    expect(secondsToIso(7200)).toBe("PT2H");
    expect(secondsToIso(45)).toBe("PT45S");
    expect(splitDuration("PT5M")).toEqual({ amount: "5", unit: "m" });
    expect(splitDuration("PT2H")).toEqual({ amount: "2", unit: "h" });
    expect(splitDuration("PT90S")).toEqual({ amount: "90", unit: "s" });
    expect(splitDuration(undefined)).toEqual({ amount: "", unit: "m" });
    expect(joinDuration("5", "m")).toBe("PT5M");
    expect(joinDuration("", "m")).toBeNull();
    expect(joinDuration("-1", "m")).toBeNull();
    expect(checkDuration("PT0S")).toBe("range");
    expect(checkDuration("PT25H")).toBe("range");
    expect(checkDuration("x")).toBe("format");
    expect(checkDuration("PT24H")).toBeUndefined();
  });
});

describe("FLW-01.02 BR-FLW-05 설정 스키마 검증·그래프 검증", () => {
  it("required·type·min·max·enum·length·duration·items", () => {
    const schema = M3_NODE_TYPES.find((t) => t.type === "condition.threshold")!.configSchema!;
    expect(validateConfig(schema, { metric: "temperature", op: ">" })).toEqual([{ path: "value", rule: "required" }]);
    expect(validateConfig(schema, { metric: "temperature", op: "~", value: "27", for: "PT0S", repeat: 0 })).toEqual([
      { path: "op", rule: "enum" },
      { path: "value", rule: "type", limit: "number" },
      { path: "for", rule: "duration" },
      { path: "repeat", rule: "minimum", limit: 1 },
    ]);
    expect(validateConfig({ type: "string", minLength: 2, maxLength: 3 }, "a")).toEqual([{ path: "", rule: "minLength", limit: 2 }]);
    expect(validateConfig({ type: "string", maxLength: 3 }, "abcd")).toEqual([{ path: "", rule: "maxLength", limit: 3 }]);
    expect(validateConfig({ type: "integer", maximum: 10 }, 11)).toEqual([{ path: "", rule: "maximum", limit: 10 }]);
    expect(validateConfig({ type: "array", minItems: 1, maxItems: 1, items: { type: "string" } }, [1, 2])).toEqual([
      { path: "", rule: "maxItems", limit: 1 },
      { path: "[0]", rule: "type", limit: "string" },
      { path: "[1]", rule: "type", limit: "string" },
    ]);
    expect(validateConfig({ type: "array", minItems: 1 }, [])).toEqual([{ path: "", rule: "minItems", limit: 1 }]);
    expect(validateConfig({ type: "boolean" }, true)).toEqual([]);
    expect(validateConfig({ type: "object" }, [])).toEqual([{ path: "", rule: "type", limit: "object" }]);
    expect(validateConfig({ type: "weird" }, 1)).toEqual([]);
    expect(validateConfig(undefined, 1)).toEqual([]);
  });

  it("노드 이름 1~60자, JS 코드 64KB, 재시도 0~10", () => {
    const node = { id: "n-js000001", type: "transform.js", typeVersion: 1, name: "", config: { code: "x".repeat(64 * 1024 + 1) }, retry: { maxAttempts: 11 }, position: { x: 0, y: 0 } };
    expect(nodeProblems(node, catalog).map((p) => `${p.path}:${p.rule}`)).toEqual(["name:required", "code:maxBytes", "retry.maxAttempts:maximum"]);
    expect(nodeProblems({ ...node, name: "a".repeat(61), config: { code: "ok" }, retry: { maxAttempts: -1 } }, catalog).map((p) => `${p.path}:${p.rule}`)).toEqual(["name:maxLength", "retry.maxAttempts:minimum"]);
  });

  it("NO_TRIGGER·UNCONNECTED·CYCLE·INVALID_CONFIG", () => {
    const graph = createFlowGraph(catalog).node("debug.log", "n-a0000001").node("debug.log", "n-b0000001").wire("n-a0000001", "out", "n-b0000001").wire("n-b0000001", "out", "n-a0000001").node("condition.threshold", "n-c0000001", { metric: "t", op: ">" }).build();
    const result = validateGraph(graph, catalog);
    expect(result.errors.map((e) => e.code)).toEqual(["NO_TRIGGER", "UNCONNECTED", "CYCLE", "INVALID_CONFIG"]);
    expect(issueNodeIds(result.errors[2])).toEqual(["n-a0000001", "n-b0000001"]);
    expect(issueNodeIds(result.errors[3])).toEqual(["n-c0000001"]);
    expect(issueNodeIds({ code: "X" })).toEqual([]);
  });

  it("ADR-044 서버 문제 {field, code, message}: nodes[<id>]…는 노드·설정 경로, wires[<i>]는 i번째 연결선의 양 끝 노드", () => {
    const graph = createFlowGraph(catalog).node("trigger.telemetry", "n-trg00001").node("debug.log", "n-dbg00001").wire("n-trg00001", "out", "n-dbg00001").build();
    expect(issueNodeIds({ field: "nodes[n-trg00001].config.metrics", code: "INVALID_CONFIG" })).toEqual(["n-trg00001"]);
    expect(normalizeIssue({ field: "nodes[n-trg00001].config.metrics", code: "INVALID_CONFIG", message: "m" })).toMatchObject({ nodeId: "n-trg00001", path: "metrics" });
    expect(normalizeIssue({ field: "nodes[n-trg00001]", code: "UNCONNECTED" })).toMatchObject({ nodeId: "n-trg00001", path: undefined });
    expect(normalizeIssue({ field: "nodes[n-trg00001].id", code: "INVALID_CONFIG" }).path).toBeUndefined();
    expect(normalizeIssue({ field: "wires[0].port", code: "UNKNOWN_PORT" }, graph)).toMatchObject({ nodeIds: ["n-trg00001", "n-dbg00001"], path: "port", wire: graph.wires[0] });
    expect(normalizeIssue({ field: "wires[5]", code: "UNCONNECTED" }, graph)).toMatchObject({ path: "wires[5]" });
    expect(normalizeIssue({ field: "nodes", code: "NO_TRIGGER" })).toEqual({ field: "nodes", code: "NO_TRIGGER" });
    expect(normalizeIssues({ errors: [{ field: "nodes[n-x]", code: "CYCLE" }] }, graph)).toEqual({ errors: [{ field: "nodes[n-x]", code: "CYCLE", nodeId: "n-x", path: undefined }], warnings: [] });
    expect(normalizeIssues(null)).toBeNull();
  });

  it("contracts flow-definition.v1: 정의의 노드 outputs·disabled와 트리거 error 연결을 그대로 읽고 저장한다", () => {
    const definition = {
      schema: "data2flow.flow-definition/v1",
      nodes: [
        { id: "n-trg00001", type: "trigger.telemetry", typeVersion: 1, name: "t", config: {}, position: { x: 0, y: 0 }, outputs: ["out", "error"], disabled: false },
        { id: "n-dbg00001", type: "debug.log", typeVersion: 1, name: "d", config: {}, position: { x: 200, y: 0 }, disabled: true },
      ],
      wires: [{ from: "n-trg00001", port: "error", to: "n-dbg00001" }],
    };
    const graph = fromDefinition(definition);
    expect(toDefinition(graph).nodes).toEqual(definition.nodes);
    expect(validateGraph(graph, catalog).errors.filter((e) => e.code !== "INVALID_CONFIG")).toEqual([]);
    expect(connect(graph, { from: "n-trg00001", port: "error", to: "n-dbg00001" }, catalog)).toEqual({ ok: false, reason: "DUPLICATE" });
    expect(validateGraph(emptyGraph(), catalog).errors).toEqual([]);
  });
});
