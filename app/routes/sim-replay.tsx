/**
 * UI-SIM-11 실제 데이터 재생 — 파일 가져오기(SIM-06.03). 조회 SIM_READ, 업로드·재생 SIM_RUN.
 * 업로드는 이 화면 action이 multipart를 그대로 core에 중계한다(API-SIM-23, ≤10MB — BFF 본문 한도와 같다). M3에서는 core가 재생 경로(API-SIM-22·23)를 아직 열지 않아(M4) 404·405·501이면 "아직 쓸 수 없음"으로 보인다.
 * 미리 보기·대상 건수·재생 시작은 브라우저에서 API-SIM-22(`dryRun`)로.
 */
import { useTranslation } from "react-i18next";
import { data, useNavigate, useRouteLoaderData } from "react-router";
import { callApi, callList, field } from "~/bff/api.server";
import { bff } from "~/bff/middleware.server";
import { PageHeader } from "~/components/ui";
import { simApi } from "~/features/sim/api";
import { SimAreaTabs } from "~/features/sim/components/common";
import { REPLAY_UNAVAILABLE, ReplayView, type UploadError } from "~/features/sim/components/replay-view";
import { MAX_REPLAY_BYTES, MAX_REPLAY_MB } from "~/features/sim/model/replay";
import type { ReplayFile, SimSpace } from "~/features/sim/model/types";
import { hasAny } from "~/lib/permissions";
import type { RootData } from "~/root";
import type { Route } from "./+types/sim-replay";

export function meta() {
  return [{ title: "data2flow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = bff(context);
  const spaces = await callList<SimSpace>(ctx, request, "/api/v1/core/sim/spaces");
  return { spaces: spaces.ok ? spaces.list.responses.map((s) => ({ spaceId: String(s.spaceId), name: s.name })) : [] };
}

type ActionResult = { uploaded?: ReplayFile; uploadError?: UploadError };

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = bff(context);
  const form = await request.formData();
  if (field(form, "intent") !== "upload") return data<ActionResult>({ uploadError: { code: "INVALID_REQUEST" } }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return data<ActionResult>({ uploadError: { code: "SIM_IMPORT_INVALID", reason: null } }, { status: 400 });
  if (file.size > MAX_REPLAY_BYTES) return data<ActionResult>({ uploadError: { code: "SIM_IMPORT_INVALID", reason: `${MAX_REPLAY_MB}MB` } }, { status: 400 });
  const upstream = new FormData();
  upstream.set("file", file, file.name);
  const result = await callApi<ReplayFile>(ctx, request, "/api/v1/core/sim/replay-files", { method: "POST", rawBody: upstream });
  if (!result.ok) {
    if (REPLAY_UNAVAILABLE.includes(result.status)) return data<ActionResult>({ uploadError: { code: "SIM_REPLAY_UNAVAILABLE" } }, { status: 503 });
    const first = result.errors?.[0];
    const row = first ? Number(/\d+/.exec(first.field)?.[0]) : Number.NaN;
    return data<ActionResult>({ uploadError: { code: result.code, message: result.message, row: Number.isFinite(row) ? row : null, reason: first?.message ?? null } }, { status: result.status });
  }
  return { uploaded: result.data } satisfies ActionResult;
}

export default function SimReplayPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const result = actionData as ActionResult | undefined;
  return (
    <>
      <PageHeader crumb={t("nav.sim")} title={t("sim.replay.title")} />
      <SimAreaTabs current="replay" />
      <ReplayView
        key={result?.uploaded?.fileId ?? "none"}
        uploaded={result?.uploaded}
        uploadError={result?.uploadError}
        spaces={loaderData.spaces}
        canRun={hasAny(root?.me?.permissions, ["SIM_RUN"])}
        api={simApi}
        navigate={(to) => navigate(to)}
      />
    </>
  );
}
