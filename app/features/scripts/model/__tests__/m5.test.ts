/**
 * 스크립트 M5 화면 모델: 테스트 케이스(SCR-03.03, UI-SCR-04), 설정값(SCR-04.02), 운영 지표·성능 경고(SCR-03.05·05.03), 로그 수집(SCR-05.02),
 * 배포 후 재처리(SCR-03.06), 공유 모듈 이름(SCR-04.01).
 */
import { describe, expect, it } from "vitest";
import {
  asPercent,
  caseDiffLines,
  caseDraftOf,
  checkConfig,
  checkForceReason,
  checkModuleName,
  checkTestCase,
  configRowsOf,
  effectiveWarnings,
  emptyCaseDraft,
  formatRemaining,
  isSecretName,
  isSlow,
  moduleImportLine,
  nextCaseName,
  remainingSeconds,
  reprocessLink,
  statsByVersion,
  statsRange,
  statsSeries,
} from "../m5";

describe("SCR-03.03 TC-SCR-049 테스트 케이스 입력 검증(UI-SCR-04)", () => {
  const base = { ...emptyCaseDraft(), name: "기본 업링크", input: '{"metrics":[]}', expected: '{"metrics":[]}' };

  it("AT-SCR-07.2 허용 오차 0~1000, 필드 지정은 필드 1개 이상, 이름 1~80자·고유, JSON 형식", () => {
    expect(checkTestCase({ ...base, compareMode: "TOLERANCE", tolerance: "0.01" }, [], null).body).toEqual({ name: "기본 업링크", input: { metrics: [] }, expected: { metrics: [] }, compareMode: "TOLERANCE", tolerance: 0.01 });
    expect(checkTestCase({ ...base, compareMode: "TOLERANCE", tolerance: "1001" }, [], null).errors.tolerance).toBe("tolerance");
    expect(checkTestCase({ ...base, compareMode: "TOLERANCE", tolerance: "" }, [], null).errors.tolerance).toBe("tolerance");
    expect(checkTestCase({ ...base, compareMode: "FIELDS", compareFields: " " }, [], null).errors.compareFields).toBe("fields");
    expect(checkTestCase({ ...base, compareMode: "FIELDS", compareFields: "a, b" }, [], null).body?.compareFields).toEqual(["a", "b"]);
    expect(checkTestCase({ ...base, name: "" }, [], null).errors.name).toBe("name");
    expect(checkTestCase(base, [{ id: "1", name: "기본 업링크" }], null).errors.name).toBe("nameDuplicated");
    expect(checkTestCase(base, [{ id: "1", name: "기본 업링크" }], "1").errors.name).toBeUndefined();
    expect(checkTestCase({ ...base, input: "{" }, [], null).errors.input).toBe("json");
    expect(checkTestCase({ ...base, expected: "x".repeat(300 * 1024) }, [], null).errors.expected).toBe("jsonTooLarge");
    expect(checkTestCase({ ...base, context: '{"config":{"tempOffset":0.5}}' }, [], null).body?.context).toEqual({ config: { tempOffset: 0.5 } });
  });

  it("케이스는 50개까지(새 케이스만), 편집 값 되돌리기, 이름 제안", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: `c${i}` }));
    expect(checkTestCase(base, many, null).errors.quota).toBe("quota");
    expect(checkTestCase(base, many, "3").errors.quota).toBeUndefined();
    const draft = caseDraftOf({ id: "1", name: "n", input: { a: 1 }, expected: null, compareMode: "FIELDS", compareFields: ["a"], tolerance: null });
    expect(draft).toMatchObject({ expected: "null", compareFields: "a", tolerance: "0.01", context: "" });
    expect(nextCaseName("케이스", [{ name: "케이스 1" }])).toBe("케이스 2");
    expect(nextCaseName("케이스", [{ name: "케이스 2" }])).toBe("케이스 3");
  });

  it("차이 줄: changed(expected·actual 또는 from·to), missing, extra", () => {
    expect(caseDiffLines({ changed: [{ key: "temperature", expected: 85, actual: 85.5 }], missing: ["humidity"], extra: [{ key: "dew", value: 1 }] })).toEqual([
      { key: "temperature", expected: 85, actual: 85.5, kind: "changed" },
      { key: "humidity", expected: undefined, kind: "missing" },
      { key: "dew", actual: 1, kind: "extra" },
    ]);
    expect(caseDiffLines({ changed: [{ path: "t", from: 1, to: 2 }] })[0]).toMatchObject({ key: "t", expected: 1, actual: 2 });
    expect(caseDiffLines(null)).toEqual([]);
  });

  it("AT-SCR-07.3 강제 배포 사유는 10~200자", () => {
    expect(checkForceReason("짧음")).toBe(false);
    expect(checkForceReason("현장 긴급 보정 반영 필요")).toBe(true);
    expect(checkForceReason("x".repeat(201))).toBe(false);
  });
});

describe("SCR-04.02 TC-SCR-070 설정값 검증", () => {
  it("AT-SCR-08.3 비밀값 이름(apiToken, password, secret, *_key) 거부, 타입 number/string/boolean, 50개 한도", () => {
    for (const name of ["apiToken", "PASSWORD", "mySecret", "device_key"]) expect(isSecretName(name)).toBe(true);
    expect(isSecretName("tempOffset")).toBe(false);
    const ok = checkConfig([
      { name: "tempOffset", type: "number", value: "0.5" },
      { name: "label", type: "string", value: "A" },
      { name: "enabled", type: "boolean", value: "true" },
    ]);
    expect(ok.config).toEqual({ tempOffset: 0.5, label: "A", enabled: true });
    expect(checkConfig([{ name: "apiToken", type: "string", value: "x" }]).errors[0]).toBe("secret");
    expect(checkConfig([{ name: "1x", type: "string", value: "x" }]).errors[0]).toBe("name");
    expect(checkConfig([{ name: "a", type: "number", value: "abc" }]).errors[0]).toBe("number");
    expect(checkConfig([{ name: "a", type: "boolean", value: "yes" }]).errors[0]).toBe("boolean");
    expect(checkConfig([{ name: "a", type: "string", value: "x".repeat(1025) }]).errors[0]).toBe("tooLarge");
    expect(checkConfig([{ name: "a", type: "string", value: "" }, { name: "a", type: "string", value: "" }]).errors[1]).toBe("duplicated");
    expect(checkConfig(Array.from({ length: 51 }, (_, i) => ({ name: `k${i}`, type: "string" as const, value: "" }))).tooMany).toBe(true);
    expect(configRowsOf({ tempOffset: 0.5, on: false, s: "v" })).toEqual([
      { name: "tempOffset", type: "number", value: "0.5" },
      { name: "on", type: "boolean", value: "false" },
      { name: "s", type: "string", value: "v" },
    ]);
  });
});

describe("SCR-03.05·05.03 TC-SCR-085 운영 지표와 성능 경고", () => {
  const points = [
    { t: "2026-10-03T00:00:00Z", versionNo: 4, processed: 100, errors: 1, timeouts: 1, avgMs: 2, p95Ms: 5 },
    { t: "2026-10-03T00:01:00Z", versionNo: 5, processed: 300, errors: 0, avgMs: 4, p95Ms: 25 },
    { t: "2026-10-03T00:02:00Z", versionNo: 5, processed: 100, errors: 10, avgMs: 8, p95Ms: 22 },
  ];

  it("AT-SCR-10.3 버전별 합계(가중 평균, p95 최댓값, 오류율)", () => {
    expect(statsByVersion(points)).toEqual([
      { versionNo: 5, processed: 400, errors: 10, errorRate: 0.025, avgMs: 5, p95Ms: 25 },
      { versionNo: 4, processed: 100, errors: 2, errorRate: 0.02, avgMs: 2, p95Ms: 5 },
    ]);
    expect(statsByVersion([{ t: "x", processed: 0 }])[0]).toMatchObject({ versionNo: 0, errorRate: 0, avgMs: null, p95Ms: null });
  });

  it("p95 > 20ms면 SLOW(서버 경고 우선), 최근 p95 ≤ 20ms면 SLOW 배지 사라짐", () => {
    expect(effectiveWarnings({ points, warnings: [] })).toEqual([{ type: "SLOW", value: 22, hints: [] }]);
    expect(effectiveWarnings({ points, warnings: [{ type: "SLOW", value: 25, hints: ["LARGE_INPUT"] }] })).toEqual([{ type: "SLOW", value: 25, hints: ["LARGE_INPUT"] }]);
    const recovered = [...points, { t: "2026-10-03T00:03:00Z", versionNo: 5, processed: 10, p95Ms: 19.9 }];
    expect(effectiveWarnings({ points: recovered, warnings: [{ type: "SLOW", value: 25 }, { type: "ERROR_RATE", value: 0.121 }] })).toEqual([{ type: "ERROR_RATE", value: 0.121 }]);
    expect(isSlow(20)).toBe(false);
    expect(isSlow(20.1)).toBe(true);
    expect(isSlow(null)).toBe(false);
    expect(asPercent(0.121)).toBeCloseTo(12.1);
    expect(asPercent(12.1)).toBe(12.1);
    expect(asPercent(undefined)).toBe(0);
  });

  it("기간별 조회 범위(1h·24h는 1m, 7d는 1h)와 차트 계열", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(statsRange("1h", now)).toEqual({ from: "2026-10-03T23:00:00Z", to: "2026-10-04T00:00:00Z", step: "1m" });
    expect(statsRange("7d", now).step).toBe("1h");
    const series = statsSeries(points, { processed: "p", errors: "e", avg: "a", p95: "9" });
    expect(series.map((s) => s.key)).toEqual(["processed", "errors", "avgMs", "p95Ms"]);
    expect(series[1].points[0]).toEqual(["2026-10-03T00:00:00Z", 2, null]);
  });
});

describe("SCR-05.02 TC-SCR-083 로그 수집 남은 시간", () => {
  it("남은 초와 m:ss 표기, 지났으면 0", () => {
    const now = Date.parse("2026-10-04T00:00:00Z");
    expect(remainingSeconds("2026-10-04T00:30:00Z", now)).toBe(1800);
    expect(remainingSeconds("2026-10-03T23:59:00Z", now)).toBe(0);
    expect(remainingSeconds(null, now)).toBe(0);
    expect(remainingSeconds("x", now)).toBe(0);
    expect(formatRemaining(1799)).toBe("29:59");
    expect(formatRemaining(5)).toBe("0:05");
  });
});

describe("SCR-03.06 TC-SCR-062 배포 후 재처리 주소, SCR-04.01 모듈 이름", () => {
  it("재처리 화면 미리 채움 쿼리", () => {
    expect(reprocessLink({ sourceId: 7, deviceIds: [11, 12], from: "2026-09-27T00:00:00Z", to: "2026-10-04T00:00:00Z", memo: "v5 배포 후" })).toBe(
      "/ingest/reprocess?sourceId=7&deviceIds=11%2C12&from=2026-09-27T00%3A00%3A00Z&to=2026-10-04T00%3A00%3A00Z&memo=v5+%EB%B0%B0%ED%8F%AC+%ED%9B%84",
    );
    expect(reprocessLink({})).toBe("/ingest/reprocess?");
  });

  it("모듈 이름 소문자·숫자·- 3~40자, import 줄", () => {
    expect(checkModuleName("milesight-channels")).toBe(true);
    expect(checkModuleName("Milesight")).toBe(false);
    expect(checkModuleName("ab")).toBe(false);
    expect(moduleImportLine("milesight", 2)).toBe("import { … } from 'module:milesight@2';");
    expect(moduleImportLine("milesight", null)).toContain("@1");
  });
});
