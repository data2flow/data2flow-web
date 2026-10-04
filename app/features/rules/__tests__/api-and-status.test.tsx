/** 규칙·알람 브라우저 API 경로(API-RUL-06·12·25)와 규칙 상태 배지(UI-RUL-01 ERROR + 사유) */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meOf, renderRoute } from "../../../../test/render";
import { alarmsApi } from "../../alarms/api";
import { rulesApi } from "../api";
import { RuleStatusBadge } from "../components/rule-status";

afterEach(() => vi.unstubAllGlobals());

describe("BFF 경로", () => {
  it("시뮬레이션(저장 전·저장 후)·일괄 확인·무음", async () => {
    const calls: { url: string; method: string; body?: string; key?: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method), body: init.body as string | undefined, key: new Headers(init.headers).get("Idempotency-Key") });
      return new Response(JSON.stringify({ header: { isSuccessful: true }, response: { alarms: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const body = { rule: {} as never, from: "a", to: "b" };
    const sim = await rulesApi.simulate(body);
    expect(sim.ok && sim.data.alarms).toBe(0);
    await rulesApi.simulate(body, "r 1");
    await alarmsApi.bulkAck(["1"]);
    await alarmsApi.silence({ kind: "ONE_TIME" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /bff/api/core/rules/simulate", "POST /bff/api/core/rules/r%201/simulate", "POST /bff/api/core/alarms/bulk-ack", "POST /bff/api/core/silences"]);
    expect(calls[2].key).toBeTruthy();
  });
});

describe("규칙 상태 배지", () => {
  it("ERROR는 사유를 함께, 그 밖은 상태만", async () => {
    await renderRoute(
      <>
        <RuleStatusBadge status="ERROR" reason="NO_TARGET" />
        <RuleStatusBadge status="INACTIVE" />
      </>,
      { session: meOf("ANALYST") },
    );
    expect(await screen.findByText("대상 기기 없음")).toBeInTheDocument();
    expect(screen.getByText("비활성")).toBeInTheDocument();
  });
});
