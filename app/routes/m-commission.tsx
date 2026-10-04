/**
 * UI-DEV-21 현장 설치(`/m/commission?token=`, DEV-13.05, API-DEV-137). DEV_PLACE(설치 담당자 = 승인·공간 지정 권한).
 */
import { useRouteLoaderData } from "react-router";
import { callApi } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { CommissionWizard } from "~/features/field/components/commission-wizard";
import type { SpaceNode } from "~/lib/spaces";
import type { RootData } from "~/root";
import type { Route } from "./+types/m-commission";

export async function loader({ request, context }: Route.LoaderArgs) {
  const spaces = await callApi<SpaceNode[]>(bff(context), request, "/api/v1/core/spaces");
  return { spaces: spaces.ok ? (spaces.data ?? []) : [], token: new URL(request.url).searchParams.get("token") };
}

export default function MobileCommission({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootData | undefined;
  return <CommissionWizard spaces={loaderData.spaces} timezone={root?.timezone ?? "Asia/Seoul"} initialToken={loaderData.token} />;
}
