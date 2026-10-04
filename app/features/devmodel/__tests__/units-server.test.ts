/**
 * DEV-04.04 화면 표시 단위 읽기(API-DSH-12 effectiveTemperatureUnit). 실패하면 ℃.
 */
import { describe, expect, it, vi } from "vitest";

const callApi = vi.fn();
vi.mock("~/bff/api.server", () => ({ callApi: (...args: unknown[]) => callApi(...args) }));

describe("TC-DEV-140 loadTemperatureUnit", () => {
  it("사용자·조직 값(effective)을 쓰고, 실패하면 C", async () => {
    const { loadTemperatureUnit } = await import("../units.server");
    callApi.mockResolvedValueOnce({ ok: true, status: 200, data: { temperatureUnit: null, effectiveTemperatureUnit: "F" } });
    expect(await loadTemperatureUnit({} as never, new Request("https://x/"))).toBe("F");
    expect(callApi.mock.calls[0][2]).toBe("/api/v1/core/accounts/me/preferences");
    callApi.mockResolvedValueOnce({ ok: false, status: 503, code: "SERVICE_UNAVAILABLE", message: "" });
    expect(await loadTemperatureUnit({} as never, new Request("https://x/"))).toBe("C");
  });
});
