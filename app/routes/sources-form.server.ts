/**
 * 소스 만들기·편집 화면(UI-DSC-08/02) 공용 서버 처리: 선택지(모델 API-DEV-46, 공간 API-DEV-01, DECODE 스크립트 API-SCR-01)와
 * 폼 `payload` 해석·재검증. 라우트 파일 둘(source-new-form, source-edit)이 함께 쓴다.
 */
import { callApi, callList, field } from "~/bff/api.server";
import type { BffRequestContext } from "~/bff/middleware.server";
import type { SpaceNode } from "~/lib/spaces";
import { mappingFromConfig, validateMapping } from "~/features/sources/model/mapping";
import { DEFAULT_MAPPING, MAX_TOPICS, validateForm, type SourceFormValues, type SourceLimits } from "~/features/sources/model/source";
import { normalizeCatalog, type Connector } from "~/features/sources/model/catalog";
import { blocksDraft, validateConnectorForm, type ConnectorFormValues } from "~/features/sources/model/connector-source";
import type { ConnectorSchema } from "~/features/sources/model/schema-form";

export interface Choices {
  models: { id: string; code?: string; name: string }[];
  spaces: SpaceNode[];
  scripts: { id: string; name: string }[];
  /** 조직 소스 한도(API-DSC-71). 못 불러오면 null(기본 한도로 검사) */
  limits: SourceLimits | null;
}

export async function loadChoices(ctx: BffRequestContext, request: Request): Promise<Choices> {
  const [models, spaces, scripts, limits] = await Promise.all([
    callList<{ id: string; code: string; name: string; status?: string }>(ctx, request, "/api/v1/core/device-models?size=100"),
    callApi<SpaceNode[]>(ctx, request, "/api/v1/core/spaces"),
    callList<{ id: string; name: string }>(ctx, request, "/api/v1/core/scripts?kind=DECODE&size=100"),
    callApi<SourceLimits>(ctx, request, "/api/v1/core/source-limits"),
  ]);
  return {
    models: models.ok ? models.list.responses.filter((m) => m.status !== "DEPRECATED").map((m) => ({ id: String(m.id), code: m.code, name: m.name })) : [],
    spaces: spaces.ok && Array.isArray(spaces.data) ? spaces.data : [],
    scripts: scripts.ok ? scripts.list.responses.map((s) => ({ id: String(s.id), name: s.name })) : [],
    limits: limits.ok && limits.data ? limits.data : null,
  };
}

/** 폼의 payload(JSON)를 읽고 화면과 같은 규칙으로 다시 검사한다. 틀리면 null */
export function readPayload(form: FormData, options: { editing: boolean; secretConfigured?: boolean; maxTopics?: number }): SourceFormValues | null {
  try {
    const values = JSON.parse(field(form, "payload")) as SourceFormValues;
    if (!values || typeof values !== "object" || !Array.isArray(values.topics)) return null;
    const mappingError = values.decoderKey === "generic-json" && validateMapping(mappingFromConfig(values.decoderConfig || DEFAULT_MAPPING)).length > 0 ? "mapping" : null;
    const errors = validateForm(values, { ...options, maxTopics: options.maxTopics ?? MAX_TOPICS, mappingError });
    return Object.keys(errors).length === 0 ? values : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 카탈로그 커넥터(UI-DSC-08, DSC-09.01·09.05)

export interface ConnectorContext {
  schema: ConnectorSchema;
  connector: Connector;
}

/** 커넥터 설정 스키마(API-DSC-56)와 카탈로그 카드(API-DSC-55, 지원 인증 방식·확인 방식). 스키마가 없으면 null */
export async function loadConnector(ctx: BffRequestContext, request: Request, key: string): Promise<ConnectorContext | null> {
  const [schema, catalog] = await Promise.all([
    callApi<ConnectorSchema>(ctx, request, `/api/v1/core/connectors/${encodeURIComponent(key)}/schema`),
    callApi<unknown>(ctx, request, "/api/v1/core/connectors"),
  ]);
  if (!schema.ok || !schema.data?.jsonSchema) return null;
  const connectors = normalizeCatalog(catalog.ok ? catalog.data : null).connectors;
  const connector = connectors.find((c) => c.connectorKey === key) ?? { connectorKey: key, name: schema.data.jsonSchema.title ?? key, category: "", transports: [], authMethods: [], enabled: true };
  return { schema: { ...schema.data, key: schema.data.key ?? key }, connector };
}

/** 커넥터 폼 payload 해석·재검사(화면과 같은 규칙). activate면 비밀값 누락도 막는다 */
export function readConnectorPayload(form: FormData, c: ConnectorContext, options: { editing: boolean; activate: boolean; configuredSecrets?: string[] }): ConnectorFormValues | null {
  try {
    const values = JSON.parse(field(form, "payload")) as ConnectorFormValues;
    if (!values || typeof values !== "object" || typeof values.connection !== "object" || values.connectorKey !== c.schema.key) return null;
    const errors = validateConnectorForm(c.schema, c.connector.authMethods ?? [], values, options);
    if (values.decoderKey === "generic-json" && validateMapping(mappingFromConfig(values.decoderConfig || DEFAULT_MAPPING)).length > 0) return null;
    if (options.activate ? Object.keys(errors).length > 0 : blocksDraft(errors)) return null;
    return values;
  } catch {
    return null;
  }
}

/** 저장 뒤 비밀값 종류별 교체(API-DSC-58 `PUT …/secrets/{kind}` `{value}`). 실패한 종류를 돌려준다 */
export async function putSecrets(ctx: BffRequestContext, request: Request, sourceId: string, secrets: { kind: string; value: string }[]): Promise<{ kind: string; code: string }[]> {
  const failed: { kind: string; code: string }[] = [];
  for (const s of secrets) {
    const result = await callApi(ctx, request, `/api/v1/core/sources/${encodeURIComponent(sourceId)}/secrets/${encodeURIComponent(s.kind)}`, { method: "PUT", body: { value: s.value } });
    if (!result.ok) failed.push({ kind: s.kind, code: result.code });
  }
  return failed;
}
