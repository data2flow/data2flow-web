/**
 * 기기 시맨틱 탭(UI-DEV-18, DEV-13.01, API-DEV-131): Location→Equipment→Point. 폼 값 ↔ API 본문.
 */
export const POINT_TYPES = ["Measurement", "Setpoint", "Command", "Status", "Alarm"] as const;

export interface SemanticPoint {
  id?: string;
  metricKey: string;
  pointType: string;
  quantity?: string | null;
  tags?: string[];
}

export interface SemanticEquipment {
  id?: string;
  equipClass: string;
  name: string;
  spaceId?: string | null;
  points: SemanticPoint[];
}

export interface SemanticDoc {
  deviceId?: string;
  equipment: SemanticEquipment[];
}

/** 폼 필드 이름: `eq.{i}.equipClass`, `eq.{i}.name`, `eq.{i}.pt.{j}.metricKey|pointType|quantity|tags` */
export function semanticFromForm(form: FormData): SemanticDoc {
  const read = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const equipment: SemanticEquipment[] = [];
  for (let i = 0; form.has(`eq.${i}.equipClass`); i++) {
    const points: SemanticPoint[] = [];
    for (let j = 0; form.has(`eq.${i}.pt.${j}.metricKey`); j++) {
      const prefix = `eq.${i}.pt.${j}`;
      points.push({
        metricKey: read(`${prefix}.metricKey`),
        pointType: read(`${prefix}.pointType`),
        quantity: read(`${prefix}.quantity`).trim() || null,
        tags: read(`${prefix}.tags`)
          .split(/[,\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
      });
    }
    equipment.push({ equipClass: read(`eq.${i}.equipClass`).trim(), name: read(`eq.${i}.name`).trim(), points });
  }
  return { equipment };
}

/** API 오류 `errors[].field`(예: `equipment[0].points[1].quantity`)를 폼 필드 이름으로 */
export function fieldNameOf(apiField: string): string {
  return apiField.replace(/^equipment\[(\d+)\]\.points\[(\d+)\]\./, "eq.$1.pt.$2.").replace(/^equipment\[(\d+)\]\./, "eq.$1.");
}

export function errorsByField(errors: { field: string; code: string; message?: string }[] | undefined): Record<string, string> {
  return Object.fromEntries((errors ?? []).map((e) => [fieldNameOf(e.field), e.message || e.code]));
}
