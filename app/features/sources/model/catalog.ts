/**
 * 커넥터 카탈로그(UI-DSC-07, DSC-09.01, API-DSC-55). M2는 기본 유형 3개(MQTT 구독·플랫폼 브로커·가상 환경)를
 * 항상 보여 주고, 카탈로그 API가 실패해도 이 셋으로 소스를 만들 수 있다.
 */

export interface Connector {
  connectorKey: string;
  version?: string;
  name: string;
  category: string;
  standard?: string;
  transports: string[];
  authMethods: string[];
  payloadFormats?: string[];
  ackMode?: string;
  scaling?: string;
  supportsSend?: boolean;
  enabled: boolean;
  disabledReason?: string | null;
}

export interface ConnectorTemplate {
  key: string;
  name: string;
  connectorKey: string;
  description?: string;
}

export const CATEGORIES = ["MQTT", "LORAWAN", "CLOUD", "QUEUE", "HTTP", "LIGHTWEIGHT", "INDUSTRIAL", "BUILDING", "FILE", "PLATFORM"] as const;

/** M2 기본 유형(카탈로그 API가 없어도 보인다) */
export const BASIC_CONNECTORS: Connector[] = [
  { connectorKey: "mqtt", version: "5.0", name: "MQTT 3.1.1/5.0", category: "MQTT", standard: "MQTT 5.0", transports: ["tcp", "ssl", "ws", "wss"], authMethods: ["NONE", "USERPASS", "HEADER", "MTLS"], ackMode: "AFTER_STORE", scaling: "DUAL_ACTIVE", enabled: true },
  { connectorKey: "platform-broker", version: "1", name: "Platform broker", category: "PLATFORM", standard: "MQTT (iot-data WSS)", transports: ["wss"], authMethods: ["USERPASS"], ackMode: "AFTER_STORE", scaling: "DUAL_ACTIVE", enabled: true },
  { connectorKey: "simulation", version: "1", name: "Simulation", category: "PLATFORM", standard: "data2flow SIM", transports: ["internal"], authMethods: ["NONE"], ackMode: "AFTER_STORE", scaling: "SCALABLE", enabled: true },
];

/** 기록 전에 확인(ACK)하는 커넥터는 장애 때 메시지를 잃을 수 있다(DSC-09.03 "유실 가능") */
export function isLossy(connector: Pick<Connector, "ackMode">): boolean {
  return Boolean(connector.ackMode) && connector.ackMode !== "AFTER_STORE" && connector.ackMode !== "AFTER_COMMIT";
}

/** API 응답(배열 또는 `{connectors, templates}`)을 정리하고 기본 유형을 앞에 둔다 */
export function normalizeCatalog(response: unknown): { connectors: Connector[]; templates: ConnectorTemplate[] } {
  let connectors: Connector[] = [];
  let templates: ConnectorTemplate[] = [];
  if (Array.isArray(response)) connectors = response as Connector[];
  else if (response && typeof response === "object") {
    const r = response as { connectors?: Connector[]; templates?: ConnectorTemplate[]; responses?: Connector[] };
    connectors = r.connectors ?? r.responses ?? [];
    templates = r.templates ?? [];
  }
  const keys = new Set(connectors.map((c) => c.connectorKey));
  const merged = [...BASIC_CONNECTORS.filter((b) => !keys.has(b.connectorKey)), ...connectors].map((c) => ({ ...c, transports: c.transports ?? [], authMethods: c.authMethods ?? [], enabled: c.enabled !== false }));
  return { connectors: merged, templates };
}

/** 분류 탭 + 검색(이름·표준·키) */
export function filterConnectors(connectors: Connector[], category: string, query: string): Connector[] {
  const q = query.trim().toLowerCase();
  return connectors.filter((c) => (category === "ALL" || c.category === category) && (!q || [c.name, c.standard ?? "", c.connectorKey, ...(c.transports ?? [])].some((v) => v.toLowerCase().includes(q))));
}
