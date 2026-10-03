import { describe, expect, it } from "vitest";
import { paramsFromForm } from "../template-params";

describe("FLW-01.05 템플릿 파라미터 폼 → instantiate params", () => {
  it("공간·숫자·기간(숫자+단위 → ISO)·불리언·빈 값 생략", () => {
    const form = new FormData();
    form.set("p.spaceId", "31");
    form.set("p.threshold", "27");
    form.set("p.duration", "5");
    form.set("p.duration.unit", "m");
    form.set("p.enabled", "true");
    form.set("p.bad", "x");
    form.set("p.note", "");
    const schema = { properties: { spaceId: { type: "string", "x-widget": "space" }, threshold: { type: "number" }, duration: { type: "string", format: "duration" }, enabled: { type: "boolean" }, bad: { type: "integer" }, note: { type: "string" } } };
    expect(paramsFromForm(schema, form)).toEqual({ spaceId: "31", threshold: 27, duration: "PT5M", enabled: true, bad: "x" });
    const odd = new FormData();
    odd.set("p.duration", "-1");
    expect(paramsFromForm({ properties: { duration: { type: "string", "x-widget": "duration" } } }, odd)).toEqual({ duration: "-1" });
    expect(paramsFromForm(undefined, odd)).toEqual({});
  });
});
