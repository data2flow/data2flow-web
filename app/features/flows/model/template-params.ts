/**
 * 템플릿 파라미터 폼(UI-FLW-04) 값 → instantiate 요청 params(API-FLW-20). 스키마 타입대로 바꾸고, 기간은 숫자 + 단위 → ISO-8601.
 */
import { joinDuration, type DurationUnit } from "./duration";
import type { ConfigSchema } from "./types";

const value = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/** 폼 값 → 파라미터(스키마 타입대로). 기간은 숫자 + 단위 → ISO-8601 */
export function paramsFromForm(schema: ConfigSchema | undefined, form: FormData): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
    const raw = value(form, `p.${key}`).trim();
    if (raw === "") continue;
    if (prop.format === "duration" || prop["x-widget"] === "duration") params[key] = joinDuration(raw, (value(form, `p.${key}.unit`) || "m") as DurationUnit) ?? raw;
    else if (prop.type === "number" || prop.type === "integer") params[key] = Number.isFinite(Number(raw)) ? Number(raw) : raw;
    else if (prop.type === "boolean") params[key] = raw === "true";
    else params[key] = raw;
  }
  return params;
}

