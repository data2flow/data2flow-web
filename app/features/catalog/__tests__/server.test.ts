/** 카탈로그 action 응답 도우미 */
import { describe, expect, it } from "vitest";
import { can, failed, invalid, outcome } from "../server";

describe("카탈로그 action 결과", () => {
  it("성공·실패·검증 오류·권한 확인", () => {
    expect(outcome("x", { ok: true })).toEqual({ intent: "x", done: true });
    const fail = outcome("x", { ok: false, status: 409, code: "GROUP_IN_USE", message: "m" }) as unknown as { init: { status: number }; data: unknown };
    expect(fail.init.status).toBe(409);
    expect(fail.data).toMatchObject({ intent: "x", error: { code: "GROUP_IN_USE" } });
    expect((failed("y", { ok: false, status: 400, code: "A", message: "" }) as unknown as { data: unknown }).data).toMatchObject({ intent: "y" });
    expect((invalid("z", { name: "nameRequired" }) as unknown as { data: unknown; init: { status: number } }).init.status).toBe(400);
    expect(can(["DEV_ADMIN"], "DEV_ADMIN")).toBe(true);
    expect(can(undefined, "DEV_ADMIN")).toBe(false);
  });
});
