/**
 * M5 데이터 관리 화면 모델: 내보내기(TSD-04.01·04.03·07.02), 가져오기(TSD-04.02), 보관(TSD-05.01), 사전(TSD-07.04), 저장 지표(OPS-01.03), 비교(TSD-03.03).
 */
import { describe, expect, it } from "vitest";
import { exportQuery, normalizeSeries, suggestNormalize } from "~/features/explore/model/compare";
import { decodeState, defaultState, encodeState } from "~/features/explore/model/state";
import { axisIndexByUnit } from "~/lib/chart-model";
import { rangeOf } from "~/lib/format";
import { dictionaryFileName, spaceDepths } from "../dictionary";
import {
  activeJobCount,
  autoResolution,
  bffDownloadUrl,
  cronOf,
  emptyScheduleForm,
  estimateRows,
  exportBody,
  exportHeader,
  formOfSchedule,
  isActiveJob,
  previewLines,
  querySummary,
  repeatOf,
  scheduleBody,
  splitRecipients,
  statusTone,
  testTargetBody,
  validateSchedule,
  withoutRange,
  type ExportSchedule,
  type TelemetryQuery,
} from "../exports";
import { badTimeLines, canRun, emptyInfluxForm, errorsCsv, guessMapping, importPercent, importTone, influxBody, isRunningImport, mappingOf, parseCsv, validateCsv, validateInflux } from "../imports";
import { maxDays, newOverride, policyItems, splitPolicies, usageByTable, validateRetention, type EffectivePolicy } from "../retention";
import { averageGrowth, diskLevel, formatBytes, growthSeries, topTables } from "../storage";

const query: TelemetryQuery = {
  series: [
    { deviceId: "1042", metric: "temperature", label: "AM107 temperature" },
    { deviceId: "1042", metric: "co2", label: "AM107 co2" },
    { spaceId: "31", metric: "temperature", agg: "avg", label: "실습실 평균" },
  ],
  from: "2025-10-04T00:00:00Z",
  to: "2026-10-04T00:00:00Z",
  resolution: "1h",
  tz: "Asia/Seoul",
};

describe("TSD-04.01 내보내기 작업 모델", () => {
  it("AT-TSD-04.1 CSV 긴 형식 머리는 time,device_id,device_name,space_path,metric,value,unit,quality", () => {
    expect(exportHeader("LONG", true, []).join(",")).toBe("time,device_id,device_name,space_path,metric,value,unit,quality");
    expect(exportHeader("LONG", false, [])).not.toContain("quality");
    expect(exportHeader("WIDE", true, ["a.t", "b.c"])).toEqual(["time", "a.t", "b.c"]);
  });

  it("TC-TSD-102 예상 행 수: 1년 1시간 긴 형식 3계열 = 8760×3, 100만 이하면 동기", () => {
    expect(estimateRows(query, "LONG")).toBe(8760 * 3);
    expect(estimateRows(query, "WIDE")).toBe(8760);
    expect(estimateRows({ ...query, resolution: "auto" }, "LONG")).toBe(365 * 3);
    expect(estimateRows(query, "LONG", "1m")).toBe(525600 * 3);
    expect(estimateRows({ ...query, series: [] }, "LONG")).toBe(0);
    expect(autoResolution(3600)).toBe("raw");
    expect(autoResolution(86400)).toBe("1m");
    expect(autoResolution(30 * 86400)).toBe("1h");
    expect(autoResolution(400 * 86400)).toBe("1d");
  });

  it("미리 보기 3행: 긴 형식은 기기 ID·이름·항목·단위, 넓은 형식은 계열 열", () => {
    const labels = [{ id: "1042", label: "AM107, 실습실", metric: "temperature", unit: "℃" }];
    const long = previewLines("LONG", true, labels);
    expect(long).toHaveLength(4);
    expect(long[1]).toBe('2026-10-03T00:00:00+09:00,1042,"AM107, 실습실",,temperature,21.5,℃,0');
    const wide = previewLines("WIDE", false, [...labels, { id: "1043", label: "B", metric: "co2", unit: null }]);
    expect(wide[0]).toBe("time,AM107, 실습실,B");
    expect(wide[1].split(",")).toHaveLength(3);
    expect(previewLines("LONG", false, [])).toHaveLength(1);
  });

  it("본문은 API-TSD-20 모양(query는 API-TSD-04 본문 + 파일 시간대)", () => {
    expect(exportBody(query, { format: "XLSX", columns: "WIDE", includeQuality: false, tz: "UTC" })).toEqual({ query: { ...query, tz: "UTC" }, format: "XLSX", columns: "WIDE", includeQuality: false, tz: "UTC" });
  });

  it("다운로드 주소를 BFF 주소로, 진행 중 작업 수(동시 3개)와 상태 색", () => {
    expect(bffDownloadUrl("/api/v1/core/exports/7/file?expires=1&signature=ab")).toBe("/bff/api/core/exports/7/file?expires=1&signature=ab");
    expect(bffDownloadUrl("http://data2flow-api-gateway/api/v1/core/exports/7/file")).toBe("/bff/api/core/exports/7/file");
    expect(bffDownloadUrl("https://evil.example/x")).toBeUndefined();
    expect(bffDownloadUrl(null)).toBeUndefined();
    expect(activeJobCount([{ status: "QUEUED" }, { status: "RUNNING" }, { status: "SUCCEEDED" }])).toBe(2);
    expect(isActiveJob({ status: "FAILED" })).toBe(false);
    expect(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED", "RUNNING", "QUEUED"].map(statusTone)).toEqual(["success", "danger", "neutral", "neutral", "info", "warning"]);
    expect(querySummary(query)).toEqual({ series: 3, from: query.from, to: query.to, resolution: "1h" });
    expect(querySummary(null).series).toBe(0);
  });
});

describe("TSD-04.03 TSD-07.02 정기 내보내기 모델", () => {
  it("AT-TSD-12.1 반복 → cron: 매일 07:00, 매주 월 02:00, 매월 1일", () => {
    expect(cronOf({ kind: "DAILY", time: "07:00", weekday: 1, day: 1 })).toBe("0 7 * * *");
    expect(cronOf({ kind: "WEEKLY", time: "02:30", weekday: 1, day: 1 })).toBe("30 2 * * 1");
    expect(cronOf({ kind: "MONTHLY", time: "01:00", weekday: 1, day: 3 })).toBe("0 1 3 * *");
    expect(cronOf({ kind: "", time: "07:00", weekday: 1, day: 1 })).toBeUndefined();
    expect(cronOf({ kind: "DAILY", time: "25:00", weekday: 1, day: 1 })).toBeUndefined();
    expect(cronOf({ kind: "DAILY", time: "", weekday: 1, day: 1 })).toBeUndefined();
  });

  it("cron → 반복(5·6필드), 모르는 모양은 null", () => {
    expect(repeatOf("0 7 * * *")).toEqual({ kind: "DAILY", time: "07:00", weekday: 1, day: 1 });
    expect(repeatOf("0 30 2 * * 1")).toEqual({ kind: "WEEKLY", time: "02:30", weekday: 1, day: 1 });
    expect(repeatOf("0 1 3 * *")).toEqual({ kind: "MONTHLY", time: "01:00", weekday: 1, day: 3 });
    expect(repeatOf("*/5 * * * *")).toBeNull();
    expect(repeatOf("0 1 3 * 1")).toBeNull();
    expect(repeatOf("0 1 * 2 *")).toBeNull();
    expect(repeatOf(null)).toBeNull();
  });

  it("TC-TSD-075 입력 검증: 이름·반복 규칙 필수, 수신자 메일 형식, 저장소 필수 값, 조회 조건", () => {
    const form = { ...emptyScheduleForm(), name: "일별", recipients: "a@x.kr, b@y.kr" };
    expect(validateSchedule(form, true)).toEqual({});
    expect(validateSchedule({ ...form, name: " " }, true).name).toBe("required");
    expect(validateSchedule({ ...form, repeat: { ...form.repeat, kind: "" } }, true).repeat).toBe("required");
    expect(validateSchedule({ ...form, recipients: "" }, true).recipients).toBe("required");
    expect(validateSchedule({ ...form, recipients: "a@x.kr; nope" }, true).recipients).toBe("email");
    expect(validateSchedule(form, false).query).toBe("required");
    expect(validateSchedule({ ...form, delivery: "STORAGE", target: { endpoint: "https://s3" } }, true).target).toBe("required");
    expect(validateSchedule({ ...form, delivery: "STORAGE", target: { endpoint: "https://s3", bucket: "bi" } }, true)).toEqual({});
    expect(splitRecipients(" a@x.kr ;b@y.kr\nc@z.kr ")).toEqual(["a@x.kr", "b@y.kr", "c@z.kr"]);
  });

  it("본문: 기간은 일정이 정하므로 from·to를 빼고, 저장소는 대상·자격(입력했을 때만)", () => {
    const email = scheduleBody({ ...emptyScheduleForm(), name: " 일별 ", recipients: "a@x.kr" }, query);
    expect(email).toMatchObject({ name: "일별", cron: "0 7 * * *", relativePeriod: "PREVIOUS_DAY", delivery: "EMAIL", recipients: ["a@x.kr"], enabled: true });
    expect((email.query as Record<string, unknown>).from).toBeUndefined();
    const sftp = scheduleBody({ ...emptyScheduleForm(), name: "s", delivery: "STORAGE", targetType: "SFTP", target: { host: "h", port: "2222", username: "u", directory: "" }, credential: { password: "p" } }, undefined);
    expect(sftp).toMatchObject({ targetType: "SFTP", target: { host: "h", port: 2222, username: "u" }, credential: { password: "p" } });
    expect(sftp.query).toBeUndefined();
    const s3 = scheduleBody({ ...emptyScheduleForm(), name: "s", delivery: "STORAGE", target: { endpoint: "e", bucket: "b" } }, undefined);
    expect(s3.credential).toBeUndefined();
    expect(testTargetBody({ ...emptyScheduleForm(), target: { endpoint: "e", bucket: "b" }, credential: { accessKey: "k" } })).toEqual({ targetType: "S3", target: { endpoint: "e", bucket: "b" }, credential: { accessKey: "k" } });
    expect(testTargetBody(emptyScheduleForm()).credential).toBeNull();
    expect(withoutRange(query)).not.toHaveProperty("to");
  });

  it("일정 → 폼(대상 값은 문자열로, 모르는 형식은 CSV)", () => {
    const s: ExportSchedule = { id: "3", name: "주간", query, format: "PARQUET", cron: "0 2 * * 1", relativePeriod: "PREVIOUS_WEEK", delivery: "STORAGE", recipients: [], targetType: "SFTP", target: { host: "h", port: 22, directory: null }, enabled: false, version: 2 };
    const form = formOfSchedule(s);
    expect(form).toMatchObject({ name: "주간", format: "PARQUET", relativePeriod: "PREVIOUS_WEEK", targetType: "SFTP", target: { host: "h", port: "22" }, enabled: false, repeat: { kind: "WEEKLY", weekday: 1, time: "02:00" } });
    expect(formOfSchedule({ ...s, format: "ODS", relativePeriod: "X", cron: "bad", targetType: null, target: null, delivery: "EMAIL", recipients: ["a@x.kr"] })).toMatchObject({ format: "CSV", relativePeriod: "PREVIOUS_DAY", targetType: "S3", recipients: "a@x.kr", repeat: { kind: "DAILY" } });
  });
});

describe("TSD-04.02 가져오기 모델", () => {
  const csv = '\uFEFFtime,devEui,temperature,co2\n2026-09-01T00:00:00+09:00,24e1,22.1,520\n"bad, time",24e1,"2""2",510\r\n1693494000000,24e2,21,500';

  it("CSV 미리 보기: BOM·따옴표·CRLF·최대 줄 수", () => {
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["time", "devEui", "temperature", "co2"]);
    expect(rows[2]).toEqual(["bad, time", "24e1", '2"2', "510"]);
    expect(rows).toHaveLength(4);
    expect(parseCsv(csv, ",", 2)).toHaveLength(2);
    expect(parseCsv("a;b\n1;2\n", ";")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("머리로 매핑 짐작: 넓은 형식·긴 형식·이름 식별", () => {
    expect(guessMapping(["time", "devEui", "temperature", "co2"], "Asia/Seoul")).toMatchObject({ timeColumn: "time", deviceColumn: "devEui", deviceKey: "EXTERNAL_ID", shape: "WIDE", metricColumns: [{ column: "temperature", metricKey: "temperature" }, { column: "co2", metricKey: "co2" }] });
    expect(guessMapping(["_time", "device_name", "metric", "value"], "UTC")).toMatchObject({ timeColumn: "_time", deviceKey: "NAME", shape: "LONG", metricColumns: [], metricColumn: "metric", valueColumn: "value" });
    expect(guessMapping([], "UTC").timeColumn).toBe("");
  });

  it("TC-TSD-113 입력 검증: 출처 라벨 필수, 파일·열·형식 패턴", () => {
    const form = guessMapping(["time", "devEui", "temperature"], "Asia/Seoul");
    expect(validateCsv(form, "아카데미 iot-bucket 2026-09", { size: 10 })).toEqual({});
    expect(validateCsv(form, " ", { size: 10 }).originLabel).toBe("required");
    expect(validateCsv(form, "x", null).file).toBe("required");
    expect(validateCsv(form, "x", { size: 3 * 1024 ** 3 }).file).toBe("tooLarge");
    const broken = { ...form, timeColumn: "", deviceColumn: "", delimiter: "", timeFormat: "CUSTOM" as const, metricColumns: [{ column: "temperature", metricKey: " " }] };
    expect(validateCsv(broken, "x", { size: 1 })).toEqual({ timeColumn: "required", deviceColumn: "required", delimiter: "required", customPattern: "required", metricColumns: "required" });
    expect(validateCsv({ ...form, shape: "LONG", metricColumn: "", valueColumn: "v" }, "x", { size: 1 }).metricColumns).toBe("required");
  });

  it("시각 형식 파싱 실패 줄(머리 1번): ISO·epoch, 사용자 형식은 서버가", () => {
    const rows = parseCsv(csv);
    const form = guessMapping(rows[0], "Asia/Seoul");
    expect(badTimeLines(rows, form)).toEqual([3, 4]);
    expect(badTimeLines(rows, { ...form, timeFormat: "EPOCH_MS" })).toEqual([2, 3]);
    expect(badTimeLines(rows, { ...form, timeFormat: "CUSTOM" })).toEqual([]);
    expect(badTimeLines(rows, { ...form, timeColumn: "nope" })).toEqual([]);
  });

  it("매핑 본문은 core ImportMapping 모양", () => {
    const form = guessMapping(["time", "devEui", "temperature"], "Asia/Seoul");
    expect(mappingOf(form)).toEqual({ timeColumn: "time", timeFormat: "ISO", tz: "Asia/Seoul", deviceColumn: "devEui", deviceKey: "EXTERNAL_ID", metricColumns: [{ column: "temperature", metricKey: "temperature" }], delimiter: "," });
    expect(mappingOf({ ...form, shape: "LONG", metricColumn: "m", valueColumn: "v", timeFormat: "CUSTOM", customPattern: " yyyy ", tz: "" })).toMatchObject({ metricColumn: "m", valueColumn: "v", timeFormat: "yyyy", tz: null });
  });

  it("InfluxDB: URL은 http/https, 필수 값, 기간 순서와 본문(UTC, 토큰 쓰기 전용)", () => {
    const form = { ...emptyInfluxForm(), url: "http://10.116.64.13:8086", org: "iot-org", bucket: "iot-bucket", token: "t", from: "2026-09-01T00:00", to: "2026-10-01T00:00", fields: [{ field: "temperature", metricKey: "temperature" }, { field: "", metricKey: "" }] };
    expect(validateInflux(form, "아카데미", "Asia/Seoul")).toEqual({});
    expect(validateInflux({ ...form, url: "ftp://x" }, "a", "Asia/Seoul").url).toBe("url");
    expect(validateInflux({ ...emptyInfluxForm() }, "", "Asia/Seoul")).toEqual({ url: "url", org: "required", bucket: "required", token: "required", originLabel: "required", range: "order" });
    expect(validateInflux({ ...form, to: "2026-08-01T00:00" }, "a", "Asia/Seoul").range).toBe("order");
    expect(influxBody(form, " 아카데미 ", "Asia/Seoul")).toEqual({
      url: "http://10.116.64.13:8086",
      org: "iot-org",
      bucket: "iot-bucket",
      token: "t",
      from: "2026-08-31T15:00:00Z",
      to: "2026-09-30T15:00:00Z",
      tagMapping: { deviceTag: "device_id" },
      fieldMapping: { temperature: "temperature" },
      dryRun: true,
      originLabel: "아카데미",
    });
    expect(influxBody({ ...form, measurement: "env", deviceTag: " ", fields: [] }, "a", "UTC", false)).toMatchObject({ measurement: "env", tagMapping: { deviceTag: "device_id" }, dryRun: false });
  });

  it("진행률·상태·오류 CSV", () => {
    expect(importPercent({ status: "RUNNING", total: 200, inserted: 50, skippedDuplicate: 40, failed: 10 })).toBe(50);
    expect(importPercent({ status: "SUCCEEDED", total: 0 })).toBe(100);
    expect(importPercent({ status: "QUEUED", total: null })).toBe(0);
    expect(isRunningImport({ status: "VALIDATING" })).toBe(true);
    expect(canRun({ status: "DRY_RUN_DONE", dryRun: true })).toBe(true);
    expect(canRun({ status: "SUCCEEDED", dryRun: false })).toBe(false);
    expect(["SUCCEEDED", "FAILED", "CANCELLED", "DRY_RUN_DONE", "RUNNING"].map(importTone)).toEqual(["success", "danger", "neutral", "info", "warning"]);
    expect(errorsCsv([{ lineOrPoint: "3", errorCode: "TIME_PARSE", message: 'bad "time", x' }, { lineOrPoint: "24e1", errorCode: "DEVICE_NOT_MAPPED" }])).toBe('line,code,message\n3,TIME_PARSE,"bad ""time"", x"\n24e1,DEVICE_NOT_MAPPED,');
  });
});

describe("TSD-05.01 보관 정책 모델", () => {
  const effective: EffectivePolicy[] = [
    { scope: "ORG", dataClass: "TELEMETRY", retainDays: 365, compressAfterDays: 7, archiveBeforeDelete: false, minDays: 30, inherited: true },
    { scope: "ORG", dataClass: "RAW_MESSAGE", retainDays: 30, archiveBeforeDelete: true, minDays: 7 },
    { scope: "ORG", dataClass: "AGG_1D", retainDays: 0, archiveBeforeDelete: false, minDays: 0 },
    { scope: "METRIC", scopeRef: "LAeq", dataClass: "TELEMETRY", retainDays: 90, archiveBeforeDelete: false },
    { scope: "MODEL", scopeRef: "11", dataClass: "AGG_1H", retainDays: 2000, archiveBeforeDelete: true, storeMode: null },
  ];

  it("유효 정책 → 조직 기본(13종 모두) + 재정의", () => {
    const { org, overrides } = splitPolicies(effective);
    expect(org).toHaveLength(13);
    expect(org.find((r) => r.dataClass === "TELEMETRY")).toMatchObject({ retainDays: "365", compressAfterDays: 7, minDays: 30 });
    expect(org.find((r) => r.dataClass === "LINK")).toMatchObject({ retainDays: "", minDays: 7 });
    expect(overrides.map((o) => `${o.scope}:${o.scopeRef}:${o.dataClass}:${o.retainDays}:${o.storeMode}`)).toEqual(["METRIC:LAeq:TELEMETRY:90:ALL", "MODEL:11:AGG_1H:2000:ALL"]);
  });

  it("TC-TSD-125 입력 검증: 허용 범위(최소~최대, 1일 집계는 0만), 대상 필수, 같은 범위·대상·종류 중복 금지", () => {
    const { org, overrides } = splitPolicies(effective);
    const filled = org.map((r) => ({ ...r, retainDays: r.retainDays || String(Math.max(r.minDays, 30)) }));
    expect(validateRetention(filled, overrides)).toEqual({});
    const bad = filled.map((r) => (r.dataClass === "RAW_MESSAGE" ? { ...r, retainDays: "3" } : r.dataClass === "AGG_1D" ? { ...r, retainDays: "10" } : r.dataClass === "ANALYSIS_RESULT" ? { ...r, retainDays: "2000" } : r));
    expect(validateRetention(bad, [])).toEqual({ "org.RAW_MESSAGE": "range", "org.AGG_1D": "range", "org.ANALYSIS_RESULT": "range" });
    const dup = [...overrides, { ...overrides[0], key: "x" }];
    expect(validateRetention(filled, dup)).toEqual({ "ov.x": "duplicate" });
    const extra = { ...newOverride(), scopeRef: "" };
    expect(validateRetention(filled, [extra])[`ov.${extra.key}`]).toBe("required");
    expect(validateRetention(filled, [{ ...extra, scopeRef: "co2", retainDays: "abc" }])[`ov.${extra.key}`]).toBe("range");
    expect(validateRetention(filled, [{ ...extra, scopeRef: "co2", dataClass: "AGG_1D", retainDays: "0" }])).toEqual({});
    expect(maxDays("ANALYSIS_RESULT")).toBe(1095);
    expect(maxDays("TELEMETRY")).toBe(3650);
  });

  it("items: 조직 기본 전부 + 재정의 전체, 압축 일수는 측정값 원본 ORG만, 값 변화만은 측정 항목·측정값 원본만", () => {
    const { org, overrides } = splitPolicies(effective);
    const items = policyItems(
      org.map((r) => ({ ...r, retainDays: r.retainDays || "90" })),
      [...overrides.map((o, i) => (i === 0 ? { ...o, storeMode: "ON_CHANGE" as const } : { ...o, storeMode: "ON_CHANGE" as const }))],
    );
    expect(items).toHaveLength(15);
    expect(items.find((i) => i.dataClass === "TELEMETRY" && i.scope === "ORG")).toMatchObject({ retainDays: 365, compressAfterDays: 7, scopeRef: null });
    expect(items.find((i) => i.dataClass === "RAW_MESSAGE")).not.toHaveProperty("compressAfterDays");
    expect(items[13]).toEqual({ scope: "METRIC", scopeRef: "LAeq", dataClass: "TELEMETRY", retainDays: 90, archiveBeforeDelete: false, storeMode: "ON_CHANGE" });
    expect(items[14]).not.toHaveProperty("storeMode");
  });

  it("저장 현황을 표 이름으로 묶는다(용량 큰 순)", () => {
    expect(
      usageByTable({
        totalBytes: 10,
        partitions: [
          { table: "telemetry", name: "telemetry_2026_09", rows: 10, bytes: 100 },
          { table: "telemetry", name: "telemetry_2026_10", rows: 5, bytes: 50 },
          { table: "raw_messages", name: "raw_2026_10", rows: null, bytes: null },
        ],
      }),
    ).toEqual([
      { table: "telemetry", rows: 15, bytes: 150, partitions: 2 },
      { table: "raw_messages", rows: 0, bytes: 0, partitions: 1 },
    ]);
    expect(usageByTable(null)).toEqual([]);
  });
});

describe("OPS-01.03 저장 지표 모델", () => {
  const metrics = {
    dbSizeBytes: 41_015_000_000,
    tables: [
      { schema: "data2flow_pipeline", table: "telemetry", bytes: 30e9, rows: 9e8 },
      { schema: "data2flow_core", table: "audit_logs", bytes: 1e9, rows: 1e6 },
    ],
    dailyGrowthBytes: [
      { day: "2026-10-01", bytes: 40e9, growthBytes: null },
      { day: "2026-10-02", bytes: 40.5e9, growthBytes: 5e8 },
      { day: "2026-10-03", bytes: 41.5e9, growthBytes: 1e9 },
    ],
    diskFreePercent: 19,
  };

  it("TC-OPS-013 디스크 여유 20% 미만이면 경고, 값이 없으면 알 수 없음", () => {
    expect(diskLevel(19)).toBe("warn");
    expect(diskLevel(64)).toBe("ok");
    expect(diskLevel(null)).toBe("unknown");
  });

  it("용량 표기·평균 증가량·상위 표·추이 계열(GB)", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(41_015_000_000)).toBe("38.2 GB");
    expect(formatBytes(-2048)).toBe("-2.0 KB");
    expect(formatBytes(undefined)).toBe("–");
    expect(averageGrowth(metrics)).toBe(750_000_000);
    expect(averageGrowth({ dailyGrowthBytes: [] })).toBeNull();
    expect(topTables(metrics, 1)[0].table).toBe("telemetry");
    const [series] = growthSeries(metrics, "DB");
    expect(series.unit).toBe("GB");
    expect(series.points[0]).toEqual(["2026-10-01T00:00:00Z", 37.25, null]);
  });
});

describe("TSD-07.04 데이터 사전 모델", () => {
  it("파일 이름에 판 번호, 공간 깊이는 부모를 따라(고리에서 멈춤)", () => {
    expect(dictionaryFileName({ version: 4 }, "json")).toBe("data-dictionary-v4.json");
    const depths = spaceDepths([
      { id: "1", parentId: null },
      { id: "2", parentId: "1" },
      { id: "3", parentId: "2" },
      { id: "8", parentId: "9" },
      { id: "9", parentId: "8" },
    ]);
    expect([depths.get("1"), depths.get("2"), depths.get("3")]).toEqual([0, 1, 2]);
    expect(depths.get("8")).toBe(1);
  });
});

describe("TSD-03.03 여러 측정 항목·기기 비교", () => {
  const s = (key: string, unit: string | null, values: (number | null)[]) => ({ key, label: key, unit, points: values.map((v, i) => [`2026-10-03T0${i}:00:00Z`, v, 0] as [string, number | null, number | null]) });

  it("AT-TSD-03.1 TC-TSD-069 온도(℃)·CO2(ppm)·외기 온도(℃)는 축 2개, 정규화 제안 없음", () => {
    const series = [s("t", "℃", [22]), s("c", "ppm", [520]), s("o", "℃", [30])];
    expect([...axisIndexByUnit(series).entries()]).toEqual([
      ["℃", 0],
      ["ppm", 1],
    ]);
    expect(suggestNormalize(series)).toBe(false);
    expect(suggestNormalize([...series, s("h", "%", [40])])).toBe(true);
  });

  it("정규화: 계열마다 최솟값~최댓값을 0~100%, 모두 같으면 50, null 유지", () => {
    const [a, b] = normalizeSeries([s("t", "℃", [20, 25, null, 30]), s("k", null, [5, 5])]);
    expect(a.points.map((p) => p[1])).toEqual([0, 50, null, 100]);
    expect(a.unit).toBe("%");
    expect(a.label).toBe("t [℃]");
    expect(b.points.map((p) => p[1])).toEqual([50, 50]);
    expect(b.label).toBe("k");
    expect(normalizeSeries([s("e", "x", [])])[0].points).toEqual([]);
  });

  it("정규화 보기는 주소(q)에 남고, 내보내기 조건은 보이는 계열만 API-TSD-04 본문으로", () => {
    const state = { ...defaultState(), normalize: true, series: [{ kind: "device" as const, id: "1042", metric: "co2", label: "AM107 co2" }, { kind: "space" as const, id: "31", metric: "temperature", label: "실습실", agg: "max" }, { kind: "device" as const, id: "9", metric: "x", label: "x", hidden: true }] };
    expect(decodeState(encodeState(state)).normalize).toBe(true);
    expect(decodeState(encodeState({ ...state, normalize: false })).normalize).toBeUndefined();
    expect(exportQuery(state, { from: "a", to: "b" }, "Asia/Seoul")).toEqual({
      series: [
        { deviceId: "1042", metric: "co2", label: "AM107 co2" },
        { spaceId: "31", metric: "temperature", agg: "max", label: "실습실" },
      ],
      from: "a",
      to: "b",
      resolution: "auto",
      fill: "none",
      quality: "normal",
      virtual: false,
      tz: "Asia/Seoul",
    });
  });

  it("1년 기간 키(1y)로 1년치 조회·내보내기를 고른다", () => {
    expect(rangeOf("1y", Date.parse("2026-10-04T00:00:00Z"))).toEqual({ from: "2025-10-04T00:00:00Z", to: "2026-10-04T00:00:00Z" });
    expect(decodeState(JSON.stringify({ range: "1y" })).range).toBe("1y");
  });
});
