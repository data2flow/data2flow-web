/**
 * 소스 만들기·편집 화면(UI-DSC-08/02) 공용 서버 처리: 선택지(모델 API-DEV-46, 공간 API-DEV-01, DECODE 스크립트 API-SCR-01)와
 * 폼 `payload` 해석·재검증. 라우트 파일 둘(source-new-form, source-edit)이 함께 쓴다.
 */
import { callApi, callList, field } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import type { SpaceNode } from "~/lib/spaces";
import { mappingFromConfig, validateMapping } from "~/features/sources/model/mapping";
import { DEFAULT_MAPPING, validateForm, type SourceFormValues } from "~/features/sources/model/source";

export interface Choices {
  models: { id: string; code?: string; name: string }[];
  spaces: SpaceNode[];
  scripts: { id: string; name: string }[];
}

export async function loadChoices(ctx: BffRequestContext, request: Request): Promise<Choices> {
  const [models, spaces, scripts] = await Promise.all([
    callList<{ id: string; code: string; name: string; status?: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/scripts?kind=DECODE&size=100"),
  ]);
  return {
    models: models.ok ? models.list.responses.filter((m) => m.status !== "DEPRECATED").map((m) => ({ id: String(m.id), code: m.code, name: m.name })) : [],
    spaces: spaces.ok && Array.isArray(spaces.data) ? spaces.data : [],
    scripts: scripts.ok ? scripts.list.responses.map((s) => ({ id: String(s.id), name: s.name })) : [],
  };
}

/** 폼의 payload(JSON)를 읽고 화면과 같은 규칙으로 다시 검사한다. 틀리면 null */
export function readPayload(form: FormData, options: { editing: boolean; secretConfigured?: boolean }): SourceFormValues | null {
  try {
    const values = JSON.parse(field(form, "payload")) as SourceFormValues;
    if (!values || typeof values !== "object" || !Array.isArray(values.topics)) return null;
    const mappingError = values.decoderKey === "generic-json" && validateMapping(mappingFromConfig(values.decoderConfig || DEFAULT_MAPPING)).length > 0 ? "mapping" : null;
    const errors = validateForm(values, { ...options, mappingError });
    return Object.keys(errors).length === 0 ? values : null;
  } catch {
    return null;
  }
}
