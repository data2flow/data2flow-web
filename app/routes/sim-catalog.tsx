/**
 * UI-SIM-02 가상 기기 카탈로그(SIM-09.01, SIM-09.07). 조회 SIM_READ, 배치 SIM_MANAGE.
 * API: 카탈로그 API-SIM-02, 남은 한도·가상 공간 API-SIM-01, 프로필 API-SIM-08, 배치 API-SIM-05(Idempotency-Key), 키트 API-SIM-06.
 */
import { useTranslation } from "react-i18next";
import { data, useRouteLoaderData, useSearchParams } from "react-router";
import { callApi, callList, field, newIdempotencyKey, orThrow } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { CatalogView, type CatalogActionResult, type CatalogTab } from "~/features/sim/components/catalog-view";
import { SimAreaTabs } from "~/features/sim/components/common";
import { checkPlacement } from "~/features/sim/model/sim";
import type { KitPlacement, SimCatalog, SimOverview, SimProfile, SimSpace } from "~/features/sim/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-catalog";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const [catalog, overview, profiles, spaces] = await Promise.all([
    callApi<SimCatalog>(ctx, request, "/api/v1/core/sim/catalog"),
    callApi<SimOverview>(ctx, request, "/api/v1/core/sim/overview"),
    callList<SimProfile>(ctx, request, "/api/v1/core/sim/profiles"),
    callList<SimSpace>(ctx, request, "/api/v1/core/sim/spaces"),
  ]);
  const usage = overview.ok ? overview.data.usage : null;
  return {
    catalog: orThrow(catalog),
    // 배치 대상은 가상 공간 목록(API-SIM-10 GET). 못 읽으면 요약(API-SIM-01)의 공간
    spaces: spaces.ok ? spaces.list.responses.map((s) => ({ spaceId: String(s.spaceId), name: s.name })) : overview.ok ? overview.data.spaces.map((s) => ({ spaceId: s.spaceId, name: s.name })) : [],
    remaining: usage ? usage.devicesLimit - usage.devices : null,
    profiles: profiles.ok ? profiles.list.responses : [],
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  const intent = field(form, "intent");
  const key = field(form, "idempotencyKey") || newIdempotencyKey();
  if (intent === "place") {
    const input = { spaceId: field(form, "spaceId"), count: Number(field(form, "count")), namePrefix: field(form, "namePrefix").trim() };
    const fieldErrors = checkPlacement(input, null);
    if (Object.keys(fieldErrors).length) return data<CatalogActionResult>({ intent, fieldErrors }, { status: 400 });
    const body: Record<string, unknown> = { typeId: field(form, "typeId"), spaceId: input.spaceId, count: input.count, reportMode: field(form, "reportMode") || "ALWAYS" };
    if (input.namePrefix) body.namePrefix = input.namePrefix;
    if (field(form, "profileId")) body.profileId = field(form, "profileId");
    const result = await callApi<{ devices: { deviceId: string; name: string }[] }>(ctx, request, "/api/v1/core/sim/devices", { method: "POST", body, idempotencyKey: key });
    if (!result.ok) return data<CatalogActionResult>({ intent, error: { code: result.code, message: result.message, errors: result.errors } }, { status: result.status });
    return { intent, placed: result.data.devices ?? [] } satisfies CatalogActionResult;
  }
  if (intent === "kit") {
    const kitKey = field(form, "kitKey");
    const body: Record<string, unknown> = {};
    if (field(form, "mode") === "new") {
      const name = field(form, "newSpaceName").trim();
      if (!name || name.length > 100) return data<CatalogActionResult>({ intent, fieldErrors: { newSpaceName: { key: "length", values: { min: 1, max: 100 } } } }, { status: 400 });
      body.newSpace = { name, preset: field(form, "preset") || "CLASSROOM" };
    } else {
      if (!field(form, "spaceId")) return data<CatalogActionResult>({ intent, fieldErrors: { spaceId: { key: "spaceRequired" } } }, { status: 400 });
      body.spaceId = field(form, "spaceId");
    }
    const result = await callApi<KitPlacement>(ctx, request, `/api/v1/core/sim/kits/${encodeURIComponent(kitKey)}/place`, { method: "POST", body, idempotencyKey: key });
    if (!result.ok) return data<CatalogActionResult>({ intent, error: { code: result.code, message: result.message, errors: result.errors } }, { status: result.status });
    return { intent, kit: result.data } satisfies CatalogActionResult;
  }
  return data<CatalogActionResult>({ intent, error: { code: "INVALID_REQUEST" } }, { status: 400 });
}

export default function SimCatalogPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const tabParam = params.get("tab");
  const tab: CatalogTab = tabParam === "actuator" || tabParam === "kit" ? tabParam : "sensor";
  const result = actionData as CatalogActionResult | undefined;
  const spaces = result?.kit && !loaderData.spaces.some((s) => s.spaceId === result.kit?.spaceId) ? [...loaderData.spaces, { spaceId: result.kit.spaceId, name: result.kit.spaceId }] : loaderData.spaces;
  return (
    <>
      <PageHeader crumb={t("nav.sim")} title={t("sim.catalog.title")} />
      <SimAreaTabs current="catalog" />
      <CatalogView
        catalog={loaderData.catalog}
        tab={tab}
        spaces={spaces}
        profiles={loaderData.profiles}
        remaining={loaderData.remaining}
        canManage={hasAny(root?.me?.permissions, ["SIM_MANAGE"])}
        canWriteFlow={hasAny(root?.me?.permissions, ["FLOW_WRITE"])}
        result={result}
        idempotencyKey={loaderData.idempotencyKey}
      />
    </>
  );
}
