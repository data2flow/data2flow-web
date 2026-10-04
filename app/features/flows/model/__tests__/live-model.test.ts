import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowSocket, socketUrl, CLOSE_FORBIDDEN, CLOSE_SESSION_ENDED } from "../../live/flow-socket";
import { fakeSockets } from "../../__tests__/fake-socket";
import { DEBUG_SAMPLE_RATE, SAMPLE_BUFFER, SAMPLE_RATE, WIRE_ACTIVE_MS, initialLiveState, isWireActive, liveReducer, parseLiveMessage, totalOut, type LiveState, type NodeSample } from "../live";
import { avatars, initialPresence, othersSelection, parsePresence, presenceReducer, updatedByName } from "../presence";

const T0 = Date.parse("2026-10-04T00:00:00Z");
const stats = (nodes: { nodeId: string; in?: number; out?: Record<string, number>; errors?: number; status?: "OK" | "WARN" | "ERROR"; lastError?: string }[]) =>
  ({ type: "node.stats", t: "2026-10-04T00:00:01Z", version: 13, nodes: nodes.map((n) => ({ in: 0, out: {}, errors: 0, status: "OK" as const, ...n })) }) as const;
const sample = (nodeId: string, i: number, extra: Partial<NodeSample> = {}) => ({ type: "node.sample" as const, t: "2026-10-04T00:00:01Z", version: 13, nodeId, messageId: `m-${i}`, direction: "out" as const, port: "true", payload: { temperature: 27 + i / 10 }, masked: false, ...extra });

describe("FLW-03.01 TC-FLW-065 AT-FLW-04.1 노드 카운터와 와이어 움직임", () => {
  it("node.stats로 노드별 처리 수·상태가 바뀌고, 출력이 늘어난 포트의 와이어만 1.5초 동안 움직인다", () => {
    let s = liveReducer(initialLiveState(), { type: "message", message: stats([{ nodeId: "n-thr", in: 10, out: { true: 2, false: 8 } }]), now: T0 });
    expect(s.stats["n-thr"].in).toBe(10);
    expect(totalOut(s.stats["n-thr"])).toBe(10);
    expect(s.version).toBe(13);
    expect(isWireActive(s, "n-thr", "true", T0)).toBe(true);
    s = liveReducer(s, { type: "message", message: stats([{ nodeId: "n-thr", in: 14, out: { true: 2, false: 12 } }]), now: T0 + 1000 });
    expect(isWireActive(s, "n-thr", "false", T0 + 1000)).toBe(true);
    // true 포트는 그대로라 첫 갱신(T0)에서 1.5초가 지나면 멈춘다
    expect(isWireActive(s, "n-thr", "true", T0 + WIRE_ACTIVE_MS)).toBe(false);
    s = liveReducer(s, { type: "message", message: stats([{ nodeId: "n-thr", in: 14, out: { true: 2, false: 12 } }]), now: T0 + 3000 });
    expect(Object.keys(s.activePorts)).toEqual([]);
    expect(totalOut(undefined)).toBe(0);
  });

  it("TC-FLW-065 노드당 초당 20건 샘플이 와도 화면에는 초당 5건(디버그 켠 노드 50건), 버퍼는 최근 20건", () => {
    let s: LiveState = initialLiveState();
    for (let i = 0; i < 20; i++) s = liveReducer(s, { type: "message", message: sample("n-thr", i), now: T0 + i * 50 });
    expect(s.samples["n-thr"]).toHaveLength(SAMPLE_RATE);
    expect(s.skipped["n-thr"]).toBe(20 - SAMPLE_RATE);
    // 다음 1초 창
    for (let i = 20; i < 40; i++) s = liveReducer(s, { type: "message", message: sample("n-thr", i), now: T0 + 1000 + (i - 20) * 50 });
    expect(s.samples["n-thr"]).toHaveLength(SAMPLE_RATE * 2);
    expect(s.samples["n-thr"][0].messageId).toBe("m-24");
    for (let i = 0; i < 60; i++) s = liveReducer(s, { type: "message", message: sample("n-dbg", i), now: T0, debugNodes: ["n-dbg"] });
    expect(s.window["n-dbg"].count).toBe(DEBUG_SAMPLE_RATE);
    expect(s.samples["n-dbg"]).toHaveLength(SAMPLE_BUFFER);
    s = liveReducer(s, { type: "clear", nodeId: "n-dbg" });
    expect(s.samples["n-dbg"]).toBeUndefined();
    s = liveReducer(s, { type: "clear" });
    expect(s.samples).toEqual({});
  });

  it("AT-FLW-04.3 가려진(masked) 샘플은 내용을 버린다", () => {
    const s = liveReducer(initialLiveState(), { type: "message", message: sample("n-thr", 1, { masked: true, payload: { secret: 1 } }), now: T0 });
    expect(s.samples["n-thr"][0].payload).toBeUndefined();
    expect(s.samples["n-thr"][0].masked).toBe(true);
  });

  it("apply.status·flow.status·sampling·pong, 연결 상태, 모르는 메시지", () => {
    let s = liveReducer(initialLiveState(), { type: "connection", state: "open" });
    s = liveReducer(s, { type: "message", message: { type: "apply.status", targetVersion: 14, instances: [{ instanceId: "e-1", appliedVersion: 14 }], converged: true }, now: T0 });
    s = liveReducer(s, { type: "message", message: { type: "flow.status", status: "DEGRADED", reason: "DEGRADED" }, now: T0 });
    s = liveReducer(s, { type: "message", message: { type: "sampling", nodeId: "n-thr", droppedPerSec: 15 }, now: T0 });
    s = liveReducer(s, { type: "message", message: { type: "pong" }, now: T0 + 5 });
    expect(s).toMatchObject({ connection: "open", applyStatus: { targetVersion: 14, converged: true }, flowStatus: { status: "DEGRADED" }, sampling: { "n-thr": 15 }, lastMessageAt: T0 + 5 });
    expect(parseLiveMessage('{"type":"pong"}')).toEqual({ type: "pong" });
    expect(parseLiveMessage("{nope")).toBeNull();
    expect(parseLiveMessage('{"x":1}')).toBeNull();
    expect(parseLiveMessage(42)).toBeNull();
  });
});

describe("FLW-03.01 TC-FLW-065 라이브 연결(가짜 WebSocket): 구독·ping 30초·재연결·4401·4403", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("연결되면 subscribe, 30초마다 ping. 끊기면 '재연결 중' 뒤 1초·2초 백오프로 다시 연결", () => {
    const { sockets, create } = fakeSockets();
    const states: string[] = [];
    const messages: unknown[] = [];
    const socket = new FlowSocket({ url: "ws://x/bff/stream/flows/f-1", create, hello: () => [{ type: "subscribe", samples: true }], keepAlive: { message: { type: "ping" }, everyMs: 30_000 }, onState: (s) => states.push(s), onMessage: (m) => messages.push(m) });
    socket.start();
    expect(states).toEqual(["connecting"]);
    expect(socket.send({ type: "x" })).toBe(false);
    sockets[0].open();
    expect(sockets[0].sent).toEqual([{ type: "subscribe", samples: true }]);
    vi.advanceTimersByTime(30_000);
    expect(sockets[0].sent).toEqual([{ type: "subscribe", samples: true }, { type: "ping" }]);
    sockets[0].emit({ type: "pong" });
    expect(messages).toEqual(['{"type":"pong"}']);
    sockets[0].serverClose(1006);
    expect(states.at(-1)).toBe("reconnecting");
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].serverClose(1011);
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(3);
    sockets[2].open();
    expect(states.at(-1)).toBe("open");
    socket.stop();
    expect(sockets[2].closedWith).toBe(1000);
    expect(states.at(-1)).toBe("idle");
  });

  it("4401(세션 끝)이면 다시 연결하지 않고 로그인으로, 4403이면 '권한 없음'에서 멈춘다", () => {
    const { sockets, create } = fakeSockets();
    const ended = vi.fn();
    const states: string[] = [];
    const a = new FlowSocket({ url: "u", create, onState: (s) => states.push(s), onMessage: () => undefined, onSessionEnded: ended });
    a.start();
    sockets[0].open();
    sockets[0].serverClose(CLOSE_SESSION_ENDED);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(ended).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe("ended");
    const b = new FlowSocket({ url: "u", create, onState: (s) => states.push(s), onMessage: () => undefined });
    b.start();
    sockets[1].serverClose(CLOSE_FORBIDDEN);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    expect(states.at(-1)).toBe("denied");
  });

  it("socketUrl은 같은 출처의 ws(s) 주소", () => {
    expect(socketUrl("/bff/stream/flows/f-1", { protocol: "https:", host: "data2flow.java21.net" })).toBe("wss://data2flow.java21.net/bff/stream/flows/f-1");
    expect(socketUrl("/p", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/p");
    expect(socketUrl("/p", undefined)).toBe("/p");
  });
});

describe("FLW-11.01 FLW-06.09 UI-FLW-17 동시 편집 표시 상태", () => {
  it("참여자 목록·선택 노드 색·아바타 8명 + N, 잠금 허가·거절, 다른 사람 저장 안내", () => {
    const people = Array.from({ length: 10 }, (_, i) => ({ userId: String(i + 1), name: `사용자${i + 1}`, color: "#f00", selected: i === 1 ? ["n-thr"] : [] }));
    let s = presenceReducer(initialPresence(), { type: "message", message: { type: "presence.snapshot", participants: people } });
    expect(avatars(s, "1")).toEqual({ shown: people.slice(1, 9), more: 1 });
    expect(othersSelection(s, "1").get("n-thr")).toEqual({ name: "사용자2", color: "#f00" });
    s = presenceReducer(s, { type: "message", message: { type: "presence.changed", participant: { userId: "2", name: "사용자2", selected: [] }, left: true } });
    expect(s.participants).toHaveLength(9);
    s = presenceReducer(s, { type: "message", message: { type: "presence.changed", participant: { userId: "11", name: "새 사람" } } });
    expect(s.participants.at(-1)?.name).toBe("새 사람");
    s = presenceReducer(s, { type: "message", message: { type: "presence.changed" } });
    s = presenceReducer(s, { type: "message", message: { type: "presence.changed", participants: [people[0]] } });
    expect(s.participants).toEqual([people[0]]);
    s = presenceReducer(s, { type: "message", message: { type: "lock.granted", nodeId: "n-thr", holder: { userId: "1", name: "사용자1" } }, me: "1" });
    expect(s.locks).toEqual(["n-thr"]);
    s = presenceReducer(s, { type: "message", message: { type: "lock.denied", nodeId: "n-act", holder: { userId: "2", name: "B" } }, me: "1" });
    expect(s.heldBy["n-act"]).toEqual({ userId: "2", name: "B" });
    // B가 떠나면(창을 닫아 잠금 TTL이 지남) 잠금 표시도 지운다(AT-FLW-25.3)
    s = presenceReducer(s, { type: "message", message: { type: "presence.snapshot", participants: [people[0]] } });
    expect(s.heldBy["n-act"]).toBeUndefined();
    s = presenceReducer(s, { type: "message", message: { type: "lock.denied", nodeId: "n-act", holder: { userId: "2", name: "B" } }, me: "1" });
    s = presenceReducer(s, { type: "message", message: { type: "presence.changed", participant: { userId: "2", name: "B" }, left: true } });
    expect(s.heldBy["n-act"]).toBeUndefined();
    s = presenceReducer(s, { type: "message", message: { type: "lock.denied", nodeId: "n-x", holder: "C" }, me: "1" });
    expect(s.heldBy["n-x"].name).toBe("C");
    s = presenceReducer(s, { type: "message", message: { type: "lock.granted", nodeId: "n-y", holder: { userId: "3", name: "D" } }, me: "1" });
    expect(s.heldBy["n-y"].name).toBe("D");
    s = presenceReducer(s, { type: "released", nodeId: "n-thr" });
    expect(s.locks).toEqual([]);
    s = presenceReducer(s, { type: "message", message: { type: "flow.updated", version: 15, by: { userId: "1", name: "나" } }, me: "1" });
    expect(s.updated).toBeUndefined();
    s = presenceReducer(s, { type: "message", message: { type: "flow.updated", version: 15, by: { userId: "2", name: "B" } }, me: "1" });
    expect(updatedByName(s.updated)).toBe("B");
    expect(updatedByName({ version: 1, by: "C" })).toBe("C");
    expect(updatedByName(undefined)).toBe("");
    s = presenceReducer(s, { type: "dismissUpdate" });
    expect(s.updated).toBeUndefined();
    s = presenceReducer({ ...s, locks: ["a"] }, { type: "connection", state: "reconnecting" });
    expect(s.locks).toEqual([]);
    expect(presenceReducer(s, { type: "message", message: { type: "unknown" } as never })).toBe(s);
    expect(parsePresence('{"type":"lock.granted","nodeId":"a"}')).toEqual({ type: "lock.granted", nodeId: "a" });
    expect(parsePresence("x")).toBeNull();
    expect(parsePresence(1)).toBeNull();
  });
});
