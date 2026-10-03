/**
 * 공간 화면(/spaces, /spaces/:id) 공용 서버 코드: 트리 조회(API-DEV-01)와 트리 편집 action(API-DEV-02~05).
 */
import { data, redirect } from "react-router";
import { callApi, field, loginUrl, newIdempotencyKey } from "~/bff/api.server";
import { SessionEndedError, UpstreamUnavailableError, readEnvelope, sessionFetch } from "~/bff/gateway.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import type { TreeActionResult } from "~/features/spaces/components/space-tree";
import { checkSpaceInput, type SpaceNode } from "~/lib/spaces";

export async function loadTree(ctx: BffRequestContext, request: Request): Promise<SpaceNode[]> {
  const result = await callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces?include=counts,mode");
  if (!result.ok) throw data({ code: result.code }, { status: result.status });
  return result.data ?? [];
}

const numberOrUndefined = (raw: string) => (raw.trim() === "" ? undefined : Number(raw));

function fail(intent: string, result: { code: string; message: string; status: number }, extra: Partial<TreeActionResult> = {}) {
  return data({ intent, error: { code: result.code, message: result.message }, ...extra } as TreeActionResult, { status: result.status });
}

/** 트리 편집 intent면 처리하고, 아니면 undefined */
export async function treeAction(ctx: BffRequestContext, request: Request, form: FormData, intent: string, currentId?: string) {
  const id = field(form, "id");
  const base = `/api/v1/core/spaces/${encodeURIComponent(id)}`;
  switch (intent) {
    case "create": {
      const input = { name: field(form, "name"), type: field(form, "type"), timezone: field(form, "timezone"), code: field(form, "code").trim(), latitude: field(form, "latitude").trim(), longitude: field(form, "longitude").trim() };
      const parentId = field(form, "parentId") || undefined;
      const fieldErrors = checkSpaceInput(input);
      if (Object.keys(fieldErrors).length) return data({ intent, parentId, fieldErrors } as TreeActionResult, { status: 400 });
      const result = await callApi<{ id: string }>(ctx, request, "/api/v1/core/spaces", {
        method: "POST",
        idempotencyKey: field(form, "idempotencyKey") || newIdempotencyKey(),
        body: {
          parentId,
          type: input.type,
          name: input.name.trim(),
          code: input.code || undefined,
          timezone: input.type === "SITE" ? input.timezone : undefined,
          address: field(form, "address").trim() || undefined,
          latitude: numberOrUndefined(input.latitude),
          longitude: numberOrUndefined(input.longitude),
        },
      });
      if (!result.ok) {
        if (result.code === "SPACE_NAME_DUPLICATE") return data({ intent, parentId, fieldErrors: { name: "nameDuplicate" } } as TreeActionResult, { status: result.status });
        return fail(intent, result, { parentId });
      }
      return redirect(`/spaces/${result.data.id}`);
    }
    case "rename": {
      const name = field(form, "name").trim();
      if (!name || name.length > 100) return data({ intent, error: { code: "INVALID_REQUEST" } } as TreeActionResult, { status: 400 });
      const current = await callApi<{ version?: number }>(ctx, request, base);
      if (!current.ok) return fail(intent, current);
      const result = await callApi(ctx, request, base, { method: "PATCH", body: { name, baseVersion: current.data.version } });
      return result.ok ? redirect(`/spaces/${id}`) : fail(intent, result);
    }
    case "move": {
      const newParentId = field(form, "newParentId");
      if (!newParentId) return data({ intent, error: { code: "INVALID_REQUEST" } } as TreeActionResult, { status: 400 });
      const result = await callApi(ctx, request, `${base}/move`, { method: "POST", body: { newParentId } });
      return result.ok ? redirect(`/spaces/${id}`) : fail(intent, result);
    }
    case "delete": {
      const result = await deleteSpace(ctx, request, base);
      if (result.ok) return redirect(currentId && currentId !== id ? `/spaces/${currentId}` : "/spaces");
      return data({ intent, error: { code: result.code, message: result.message }, blockers: result.blockers } as TreeActionResult, { status: result.status });
    }
    default:
      return undefined;
  }
}

/**
 * 공간 삭제(API-DEV-05). 막히면(409 SPACE_NOT_EMPTY) 본문 `response.blockers`를 함께 읽어야 해서 응답 본문을 직접 푼다.
 */
async function deleteSpace(ctx: BffRequestContext, request: Request, path: string): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string; blockers: TreeActionResult["blockers"] }> {
  let response: Response;
  try {
    response = await sessionFetch(ctx.session, path, { method: "DELETE" });
  } catch (error) {
    if (error instanceof SessionEndedError) throw redirect(loginUrl(request, "revoked"));
    if (error instanceof UpstreamUnavailableError) return { ok: false, status: error.status, code: error.code, message: "", blockers: null };
    throw error;
  }
  if (response.ok) return { ok: true };
  const envelope = await readEnvelope<{ blockers?: TreeActionResult["blockers"] }>(response);
  return { ok: false, status: response.status, code: envelope.header.resultCode, message: envelope.header.resultMessage, blockers: envelope.response?.blockers ?? null };
}
