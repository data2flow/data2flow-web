/**
 * 화면 표시 단위(DEV-04.04)를 내 화면 설정(API-DSH-12 `effectiveTemperatureUnit`)에서 읽는다. 실패하면 저장 단위(℃) 그대로 보여 준다.
 */
import { callApi } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import { effectiveTemperatureUnit, type TemperatureUnit } from "~/lib/units";

export async function loadTemperatureUnit(ctx: BffRequestContext, request: Request): Promise<TemperatureUnit> {
  const prefs = await callApi<{ temperatureUnit?: string | null; effectiveTemperatureUnit?: string | null }>(ctx, request, "/api/v1/core/accounts/me/preferences", { noGuards: true });
  return effectiveTemperatureUnit(prefs.ok ? prefs.data : null);
}
