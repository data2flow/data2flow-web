/** CMP-01.01 프로필 편집 상태 검사·본문 변환 — TC-CMP-007(화면 몫), TC-CMP-002 경로 대응 */
import { describe, expect, it } from "vitest";
import { limitText } from "../format";
import { checkDraft, draftFrom, emptyDraft, fieldKeyOf, parseDraft, versionBody, type ProfileDraft } from "../profile-form";
import type { ProfileVersion } from "../types";

const reset: ProfileVersion = {
  versionNo: 1,
  sourceTitle: "RESET Air Standard for Commercial Interiors v2.1",
  sourceUrl: "https://www.reset.build/standard/air",
  effectiveDate: "2023-01-01",
  streak: { days: 90, dailyRatio: 95 },
  facilityTypeRequired: false,
  facilityTypes: [],
  locked: true,
  createdAt: "2026-10-29T00:00:00Z",
  coverage: [{ kind: "DATA_QUALITY", params: { maxMissingRatio: 0.1 } }],
  metrics: [
    { metricKey: "co2", evalWindow: "HOUR_1", upper: 1000, inclusive: false, unit: "ppm", requirement: "LIMIT", bands: [{ name: "허용", upper: 1000, isBase: true }, { name: "고성능", upper: 600, isBase: false }] },
    { metricKey: "temperature", evalWindow: "INSTANT", inclusive: true, unit: "℃", requirement: "CONTINUOUS_MONITORING_ONLY", bands: [] },
  ],
};

function valid(): ProfileDraft {
  return { ...draftFrom(reset, "RESET 복제본"), changeNote: "CO2 강화" };
}

describe("CMP-01.01 편집 상태", () => {
  it("저장된 버전 → 편집 상태 → 본문: 기준 등급·등급·연속 달성·적정성 규칙이 그대로 돈다", () => {
    const body = versionBody(valid());
    expect(body.streak).toEqual({ days: 90, dailyRatio: 95 });
    expect(body.metrics[0]).toMatchObject({ metricKey: "co2", upper: 1000, lower: null, inclusive: false, bands: [{ name: "허용", upper: 1000, isBase: true }, { name: "고성능", upper: 600, isBase: false }] });
    expect(body.metrics[1]).toMatchObject({ requirement: "CONTINUOUS_MONITORING_ONLY", lower: null, upper: null });
    expect(body.metrics[1]).not.toHaveProperty("bands");
    expect(body.coverage).toEqual(reset.coverage);
    expect(checkDraft(valid(), "version")).toEqual({});
  });

  it("[TC-CMP-007] 하한 > 상한, 기준값 없음, 같은 항목 중복, 등급이 기준 밖, 변경 메모 없음", () => {
    const d = valid();
    d.metrics[0] = { ...d.metrics[0], lower: "30", upper: "20", bands: [{ name: "고성능", lower: "", upper: "1200" }] };
    d.metrics.push({ ...d.metrics[0] });
    d.metrics.push({ ...d.metrics[0], metricKey: "pm2_5", lower: "", upper: "" });
    d.changeNote = "";
    const errors = checkDraft(d, "version");
    expect(errors["metrics.0.lower"]).toBe("range");
    expect(errors["metrics.0.bands.0.upper"]).toBe("bandOverlap");
    expect(errors["metrics.2.metricKey"]).toBe("duplicateMetric");
    expect(errors["metrics.3.upper"]).toBe("limitRequired");
    expect(errors.changeNote).toBe("changeNoteRequired");
  });

  it("새 프로필은 이름·출처·기준일 필수, 링크는 https, 연속 달성 범위", () => {
    const d = { ...emptyDraft(), sourceUrl: "http://x", streakDays: "400", streakRatio: "40" };
    const errors = checkDraft(d, "create");
    expect(errors).toMatchObject({ name: "nameRequired", sourceTitle: "sourceRequired", sourceUrl: "url", effectiveDate: "dateRequired", streakDays: "streakDays", streakRatio: "streakRatio", "metrics.0.metricKey": "metricRequired" });
  });

  it("JSON 왕복과 서버 필드 경로 → 화면 경로", () => {
    const d = valid();
    expect(parseDraft(JSON.stringify(d))).toEqual(d);
    expect(parseDraft("{")).toBeNull();
    expect(fieldKeyOf(d, "metrics[co2].lower")).toBe("metrics.0.lower");
    expect(fieldKeyOf(d, "metrics[co2].bands[고성능]")).toBe("metrics.0.bands.0.upper");
    expect(fieldKeyOf(d, "metrics[temperature].unit")).toBe("metrics.1.unit");
    expect(fieldKeyOf(d, "sourceUrl")).toBe("sourceUrl");
  });

  it("[TC-CMP-010] 연산자 표기: 포함 ≤·≥, 미포함 <·>", () => {
    expect(limitText(null, 1000, true)).toBe("≤ 1000");
    expect(limitText(null, 35, false)).toBe("< 35");
    expect(limitText(20, null, true)).toBe("≥ 20");
    expect(limitText(-0.5, 0.5, true)).toBe("-0.5 ~ 0.5");
  });
});
