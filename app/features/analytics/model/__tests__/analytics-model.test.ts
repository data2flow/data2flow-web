/**
 * 분석 화면 모델 단위 시험: ChartSpec 렌더러(TC-ANA-118), 마법사 검증(ANA-03), 갤러리(ANA-01.04·01.07), 결과(ANA-05).
 */
import { describe, expect, it } from "vitest";
import { LIGHT_PALETTE } from "~/lib/palette";
import { calendarColor, chartOption, chartTable, isEchartsType, pairs, toCsv } from "../chartspec";
import { filterTemplates, highlightParts, mergeRunnable, requirementSummary, sortByRunnable } from "../gallery";
import { diffText, feedbackTarget, isActive, levelTone, metricText, resultBadges, statusTone } from "../result";
import type { ChartSpec, Template, TemplateDetail } from "../types";
import { addSource, analysisBody, checkBody, loadDraft, newDraft, removeSource, renameSource, saveDraft, clearDraft, schemaFields, validCron, validateBindings, validateConfirm, validateParams, validatePeriod, scheduleOf } from "../wizard";

const line: ChartSpec = { id: "s", type: "line", title: "온도", series: [{ key: "a", label: "A", data: [["2026-10-01T00:00:00Z", 1], ["2026-10-01T01:00:00Z", null]] }, { key: "b", data: { x: ["2026-10-01T00:00:00Z"], y: [2] }, style: "dashed", color: "#123456" }] };

describe("TC-ANA-118 ANA-05.02 ChartSpec → ECharts option", () => {
  it("9종 중 ECharts 6종은 option, 달력·타임라인·표는 화면 부품(null)", () => {
    for (const type of ["line", "band", "scatter", "bar", "heatmap", "gauge"] as const) expect(chartOption({ id: type, type, series: [], heatmap: { xLabels: [], yLabels: [], values: [] }, gauge: { value: 1, min: 0, max: 2 } })).not.toBeNull();
    for (const type of ["calendar", "timeline", "table"] as const) expect(chartOption({ id: type, type })).toBeNull();
    expect(isEchartsType("band")).toBe(true);
    expect(isEchartsType("calendar")).toBe(false);
  });

  it("gaps 기본 true면 null을 잇지 않고(connectNulls:false), 색 미지정은 색약 친화 팔레트 순서, style dashed·지정 색 유지", () => {
    const option = chartOption(line) as { series: Record<string, unknown>[]; xAxis: { type: string }; legend: { show: boolean } };
    expect(option.xAxis.type).toBe("time");
    expect(option.series[0]).toMatchObject({ type: "line", connectNulls: false, itemStyle: { color: LIGHT_PALETTE[0] } });
    expect(option.series[1]).toMatchObject({ itemStyle: { color: "#123456" }, lineStyle: { type: "dashed" } });
    expect(option.legend.show).toBe(true);
    expect((chartOption({ ...line, gaps: false }) as { series: { connectNulls: boolean }[] }).series[0].connectNulls).toBe(true);
  });

  it("마커·기준선·구간과 신뢰구간 띠(아래 경계 + 폭)", () => {
    const spec: ChartSpec = { ...line, type: "band", bands: [{ key: "ci", lower: [0, 1], upper: [2, null], label: "95%" }], markers: [{ x: "2026-10-01T00:00:00Z", y: 1, severity: "LOW" }], thresholds: [{ value: 3, label: "기준" }], regions: [{ from: "a", to: "b" }] };
    const option = chartOption(spec) as { series: Record<string, unknown>[] };
    expect(option.series).toHaveLength(4);
    expect(option.series[2]).toMatchObject({ id: "ci-lower", stack: "band-ci" });
    expect((option.series[3].data as unknown[][])[0]).toEqual(["2026-10-01T00:00:00Z", 2]);
    expect((option.series[3].data as unknown[][])[1]).toEqual(["2026-10-01T01:00:00Z", null]);
    expect(option.series[0].markPoint).toBeDefined();
    expect(option.series[0].markLine).toMatchObject({ data: [{ yAxis: 3 }] });
    expect(option.series[0].markArea).toBeDefined();
  });

  it("막대·산점도·축 종류 추정(숫자 x는 value, 글자 x는 category)", () => {
    expect((chartOption({ id: "b", type: "bar", series: [{ key: "k", data: [["월", 1]] }] }) as { xAxis: { type: string } }).xAxis.type).toBe("category");
    const scatter = chartOption({ id: "c", type: "scatter", xAxis: { label: "온도", unit: "℃" }, series: [{ key: "k", data: [[1, 2]] }] }) as { xAxis: { type: string; name: string }; tooltip: { trigger: string } };
    expect(scatter.xAxis).toMatchObject({ type: "value", name: "온도 (℃)" });
    expect(scatter.tooltip.trigger).toBe("item");
  });

  it("히트맵은 [x, y, 값]과 최소·최대 visualMap, 게이지는 값·범위", () => {
    const heat = chartOption({ id: "h", type: "heatmap", heatmap: { xLabels: ["0", "1"], yLabels: ["월"], values: [[1, null]] } }, true) as { series: { data: unknown[] }[]; visualMap: { min: number; max: number } };
    expect(heat.series[0].data).toEqual([[0, 0, 1], [1, 0, null]]);
    expect(heat.visualMap).toMatchObject({ min: 1, max: 1 });
    const gauge = chartOption({ id: "g", type: "gauge", title: "점수", gauge: { value: 72, min: 0, max: 100 } }) as { series: { data: { value: number }[]; max: number }[] };
    expect(gauge.series[0]).toMatchObject({ max: 100, data: [{ value: 72, name: "점수" }] });
  });

  it("데이터 표로 보기·CSV(따옴표 처리)", () => {
    expect(chartTable(line)).toEqual({ columns: ["x", "A", "b"], rows: [["2026-10-01T00:00:00Z", 1, 2], ["2026-10-01T01:00:00Z", null, null]] });
    expect(chartTable({ id: "h", type: "heatmap", heatmap: { xLabels: ["0"], yLabels: ["월"], values: [[3]] } }).rows).toEqual([["월", 3]]);
    expect(chartTable({ id: "g", type: "gauge", gauge: { value: 1, min: 0, max: 2 } }).rows).toEqual([[1, 0, 2]]);
    expect(chartTable({ id: "c", type: "calendar", calendar: { days: [["2026-10-01", 1]] } }).rows).toEqual([["2026-10-01", 1, null]]);
    expect(chartTable({ id: "t", type: "timeline", timeline: { items: [{ from: "a", to: "b" }] } }).rows).toEqual([["a", "b", null, null]]);
    expect(chartTable({ id: "t", type: "table", table: { id: "t", columns: [{ key: "a", label: "가" }], rows: [{ a: 1 }] } })).toEqual({ columns: ["가"], rows: [[1]] });
    expect(toCsv(["a", "b"], [["x,y", 'q"'], [null, 2]])).toBe('a,b\n"x,y","q"""\n,2');
    expect(pairs({ key: "k", data: { x: [1, 2], y: [3] } })).toEqual([[1, 3], [2, null]]);
  });

  it("TC-ANA-075 달력 색: 군집 번호면 팔레트, 값이면 진하기", () => {
    expect(calendarColor(1, 2, 0, 1).color).toBe(LIGHT_PALETTE[2]);
    expect(calendarColor(null, undefined, 0, 1).color).toBe("transparent");
    expect(calendarColor(0.5, undefined, 0, 1).opacity).toBeCloseTo(0.6);
  });
});

const T: TemplateDetail = {
  key: "anomaly-detect",
  version: "1.2.0",
  name: "이상 탐지",
  kind: "GENERAL",
  category: "GENERAL",
  roles: [{ name: "target", min: 1, max: 2 }, { name: "covariates", min: 0 }],
  requirements: { minPeriodDays: 7, maxPeriodDays: 90 },
  paramsSchema: { properties: { s: { type: "integer", minimum: 1, maximum: 5, default: 3 }, m: { type: "string", enum: ["a", "b"] }, n: { type: "string", maxLength: 3 }, f: { type: "boolean" }, x: { type: "number" } }, required: ["s"] },
};
const SRC = { kind: "DEVICE_METRIC" as const, deviceId: "1", metricKey: "t", label: "A" };

describe("ANA-03 마법사 모델", () => {
  it("새 초안은 역할마다 빈 연결, 기본값 채움, 기간은 최소 기간과 14일 중 큰 값", () => {
    const d = newDraft(T);
    expect(d.bindings).toEqual([{ role: "target", sources: [] }, { role: "covariates", sources: [] }]);
    expect(d.params).toEqual({ s: 3 });
    expect(d.days).toBe(14);
  });

  it("ANA-01.05 BR-ANA-02 연결 추가(중복 무시)·이름 바꾸기·빼기와 역할 개수 검증", () => {
    let b = addSource([], "target", SRC);
    b = addSource(b, "target", SRC);
    expect(b[0].sources).toHaveLength(1);
    b = renameSource(b, "target", 0, "실습실");
    expect(b[0].sources[0].label).toBe("실습실");
    expect(validateBindings(T.roles!, b)).toEqual([]);
    b = addSource(addSource(b, "target", { ...SRC, deviceId: "2" }), "target", { ...SRC, deviceId: "3" });
    expect(validateBindings(T.roles!, b)).toEqual([{ field: "bindings.target", code: "ROLE_COUNT", params: { role: "target", min: 1, max: 2 } }]);
    expect(removeSource(b, "target", 0)[0].sources).toHaveLength(2);
  });

  it("기간: N 범위(템플릿 최대), 고정 기간 순서·미래", () => {
    const d = newDraft(T);
    expect(validatePeriod({ ...d, days: 91 }, T, 0)[0].params).toEqual({ max: 90 });
    expect(validatePeriod({ ...d, days: 30 }, T, 0)).toEqual([]);
    const fixed = { ...d, periodType: "FIXED" as const, from: "2026-10-02T00:00", to: "2026-10-01T00:00" };
    expect(validatePeriod(fixed, T, Date.now())[0].code).toBe("FIXED_ORDER");
    expect(validatePeriod({ ...fixed, from: "2026-10-01T00:00", to: "2999-01-01T00:00" }, T, Date.parse("2026-10-04T00:00:00Z"))[0].code).toBe("FIXED_FUTURE");
    expect(validatePeriod({ ...fixed, from: "2026-10-01T00:00", to: "2026-10-02T00:00" }, T, Date.parse("2026-10-04T00:00:00Z"))).toEqual([]);
  });

  it("TC-ANA-084 스키마 폼 칸과 파라미터 검증(필수·숫자·범위·enum·길이)", () => {
    expect(schemaFields(T.paramsSchema).map((f) => [f.key, f.control, f.required])).toEqual([["s", "slider", true], ["m", "select", false], ["n", "text", false], ["f", "switch", false], ["x", "slider", false]]);
    expect(validateParams(T.paramsSchema, {}).map((e) => e.code)).toEqual(["REQUIRED"]);
    expect(validateParams(T.paramsSchema, { s: 9, m: "z", n: "toolong", x: "abc" }).map((e) => e.code)).toEqual(["RANGE", "ENUM", "LENGTH", "NUMBER"]);
    expect(validateParams(T.paramsSchema, { s: 2.5 })[0].code).toBe("NUMBER");
    expect(validateParams(T.paramsSchema, { s: 2, m: "a" })).toEqual([]);
  });

  it("ANA-04.01 cron 5필드·최소 1시간, 확인 단계 검증(이름·일정·충분성)", () => {
    expect(validCron("0 6 * * 1")).toBe(true);
    expect(validCron("*/30 * * * *")).toBe(false);
    expect(validCron("0 6 * *")).toBe(false);
    expect(validCron("0 */2 1-5 * 1,3")).toBe(true);
    const d = { ...newDraft(T), name: "x" };
    expect(validateConfirm(d, { level: "FAIL" }, true).map((e) => e.code)).toEqual(["CHECK_FAIL"]);
    expect(validateConfirm(d, { level: "FAIL" }, false)).toEqual([]);
    expect(validateConfirm(d, { level: "WARN" }, true).map((e) => e.code)).toEqual(["ACK"]);
    expect(validateConfirm({ ...d, name: " ", runMode: "SCHEDULE", scheduleAt: "25:00" }, null, false).map((e) => e.code)).toEqual(["NAME", "SCHEDULE"]);
  });

  it("요청 본문: 빈 역할은 빼고, 고정 기간은 UTC ISO, 일정은 프리셋·cron", () => {
    const d = { ...newDraft(T), bindings: addSource(newDraft(T).bindings, "target", SRC), name: " 이름 ", periodType: "FIXED" as const, from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" };
    expect(checkBody(d)).toMatchObject({ bindings: [{ role: "target" }], period: { type: "FIXED", from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" } });
    expect(analysisBody(d)).not.toHaveProperty("schedule");
    expect(analysisBody({ ...d, runMode: "SCHEDULE", schedulePreset: "CRON", cron: " 0 6 * * 1 " })).toMatchObject({ name: "이름", schedule: { cron: "0 6 * * 1" } });
    expect(scheduleOf({ ...d, runMode: "SCHEDULE", schedulePreset: "DAILY" })).toEqual({ preset: "DAILY", at: "06:00" });
  });

  it("TC-ANA-079 초안 저장·복구·삭제, 다른 템플릿이나 망가진 값은 무시", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } as unknown as Storage;
    saveDraft(newDraft(T), "period", storage);
    expect(loadDraft("anomaly-detect", storage)?.step).toBe("period");
    expect(loadDraft("forecast", storage)).toBeNull();
    store.set("data2flow:analytics:draft:forecast", "{broken");
    expect(loadDraft("forecast", storage)).toBeNull();
    clearDraft("anomaly-detect", storage);
    expect(loadDraft("anomaly-detect", storage)).toBeNull();
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } } as unknown as Storage;
    expect(() => saveDraft(newDraft(T), "template", broken)).not.toThrow();
    expect(() => clearDraft("x", broken)).not.toThrow();
    expect(loadDraft("x", broken)).toBeNull();
  });
});

const TEMPLATES: Template[] = [
  { key: "a", version: "1", name: "A", kind: "GENERAL", category: "GENERAL", roles: [{ name: "target", min: 1 }], requirements: { minPeriodDays: 7 } },
  { key: "b", version: "1", name: "B", kind: "DOMAIN", category: "ENV_QUALITY", roles: [{ name: "co2", semantic: "co2", required: true }, { name: "opt", min: 0 }] },
];

describe("ANA-01.04·01.07 갤러리 모델", () => {
  it("카테고리·종류 거르기, 실행 가능성 합치기(평가에 없는 키는 실행 불가)와 끝으로 정렬", () => {
    expect(filterTemplates(TEMPLATES, { category: "ENV_QUALITY", kinds: [] }).map((t) => t.key)).toEqual(["b"]);
    expect(filterTemplates(TEMPLATES, { category: "ALL", kinds: ["GENERAL"] }).map((t) => t.key)).toEqual(["a"]);
    const merged = mergeRunnable(TEMPLATES, [{ ...TEMPLATES[1], runnable: true }]);
    expect(merged[0].runnable).toBe(false);
    expect(sortByRunnable(merged).map((t) => t.key)).toEqual(["b", "a"]);
    expect(mergeRunnable(TEMPLATES, null)).toBe(TEMPLATES);
  });

  it("강조 조각과 필요 데이터 요약", () => {
    expect(highlightParts("센서 고장 진단", "고장 센서")).toEqual([{ text: "센서", hit: true }, { text: " ", hit: false }, { text: "고장", hit: true }, { text: " 진단", hit: false }]);
    expect(highlightParts("abc", "")).toEqual([{ text: "abc", hit: false }]);
    expect(highlightParts("a.b", "a.b")[0].hit).toBe(true);
    expect(requirementSummary(TEMPLATES[1])).toEqual({ roles: ["co2"], minDays: null });
    expect(requirementSummary(TEMPLATES[0])).toEqual({ roles: ["target"], minDays: 7 });
  });
});

describe("ANA-05 결과 모델", () => {
  it("상태 판정·색, 수준 색, 차이 문구", () => {
    expect(isActive("QUEUED")).toBe(true);
    expect(isActive("SUCCEEDED")).toBe(false);
    expect([statusTone("SUCCEEDED"), statusTone("FAILED"), statusTone("CANCELLED"), statusTone("RUNNING")]).toEqual(["good", "bad", "muted", "warn"]);
    expect([levelTone("OK"), levelTone("WARN"), levelTone("FAIL"), levelTone(null)]).toEqual(["success", "warning", "danger", "neutral"]);
    expect(diffText(4.2, 6, "ko")).toBe("+4.2 (▲6%)");
    expect(diffText(-1.04, -2, "ko")).toBe("−1 (▼2%)");
    expect(diffText(0, null, "ko")).toBe("±0");
    expect(diffText(null, null, "ko")).toBe("–");
  });

  it("배지·수치·피드백 대상", () => {
    const run = { runId: "1", status: "SUCCEEDED" as const };
    expect(resultBadges({ templateVersion: "1.2.0" }, run, { provenance: { template: "x@1.1.0", virtual: true }, summary: { metrics: [{ key: "a", value: 1, lower: 0, upper: 2 }] } })).toEqual({ virtual: true, versionMismatch: true, estimate: true });
    expect(resultBadges({ templateVersion: "1.2.0" }, run, null)).toEqual({ virtual: false, versionMismatch: false, estimate: false });
    expect(metricText({ key: "a", value: 22.4, unit: "℃", lower: 21.8, upper: 23 }, "ko")).toEqual({ value: "22.4℃", range: "21.8~23" });
    expect(metricText({ key: "a", value: "높음", unit: "등급" }, "ko").value).toBe("높음 등급");
    expect(metricText({ key: "a", value: null }, "ko").value).toBe("–");
    expect(feedbackTarget({ time: "t", seriesKey: "s" })).toEqual({ occurredAt: "t", seriesKey: "s" });
    expect(feedbackTarget({ time: "t" })).toBeNull();
  });
});
