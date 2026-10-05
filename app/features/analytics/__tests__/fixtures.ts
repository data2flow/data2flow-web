/**
 * 분석 화면 부품 테스트용 가짜 AnalyticsApi와 응답 픽스처(ANA-api §1·§4 모양). 부른 기록은 vi.fn으로 남는다.
 */
import { vi } from "vitest";
import type { AnalyticsApi } from "../api";
import type { CheckResult, ModelItem, Run, RunWithResult, Template, TemplateDetail } from "../model/types";

type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string; message: string; errors?: { field: string; code: string; message: string }[]; detail?: unknown };
export const ok = <T>(data: T, status = 200): Result<T> => ({ ok: true, status, data });
export const failed = (status: number, code: string, errors?: { field: string; code: string; message: string }[]): Result<never> => ({ ok: false, status, code, message: "", errors });

const role = (name: string, semantic: string | null, min = 1, max = 50) => ({ name, type: "series" as const, min, max, semantic, required: min > 0 });

export const TEMPLATES: Template[] = [
  { key: "comfort-index", version: "1.0.0", name: "쾌적도 분석", kind: "DOMAIN", category: "ENV_QUALITY", summary: "온도·습도·CO2로 쾌적한 정도를 점수로 봅니다", questions: ["이 공간은 쾌적한가?", "무엇 때문에 불쾌한가?"], roles: [role("temp", "temperature"), role("co2", "co2", 0, 5)], requirements: { minPeriodDays: 1 }, fast: true },
  { key: "anomaly-detect", version: "1.2.0", name: "이상 탐지", kind: "GENERAL", category: "GENERAL", summary: "평소와 다른 값이나 구간을 찾습니다", questions: ["평소와 다른 값이 있었나?", "어젯밤 CO2가 이상하게 높았나?"], roles: [role("target", null), role("covariates", null, 0, 5)], requirements: { minPeriodDays: 7 } },
  { key: "sensor-health", version: "1.0.0", name: "센서 건강 진단", kind: "DOMAIN", category: "ASSET_HEALTH", summary: "고장 났거나 믿을 수 없는 센서를 찾습니다", questions: ["센서 고장이 있나?"], roles: [role("sensors", null)], requirements: { minPeriodDays: 7 } },
  { key: "forecast", version: "1.0.0", name: "예측", kind: "GENERAL", category: "PREDICTION", summary: "앞으로 어떻게 변하나", questions: ["내일 몇 도일까?"], roles: [role("target", null, 1, 1)], requirements: { minPeriodDays: 14 }, trainable: true },
];

export const ANOMALY: TemplateDetail = {
  ...TEMPLATES[1],
  versions: ["1.2.0", "1.1.0"],
  paramsSchema: {
    type: "object",
    properties: {
      sensitivity: { type: "integer", title: "민감도", description: "높을수록 많이 탐지하고 오탐도 늘어납니다", minimum: 1, maximum: 5, default: 3 },
      method: { type: "string", title: "방식", enum: ["zscore", "iqr"], default: "zscore" },
      seasonal: { type: "boolean", title: "계절성 제거", default: true },
    },
    required: ["sensitivity"],
  },
  guide: {
    summary: "평소 패턴과 다른 값이나 구간을 찾아 점수를 매깁니다",
    whenToUse: ["어젯밤 CO2가 이상하게 높았나?"],
    whenNotToUse: ["데이터가 7일보다 짧을 때"],
    dataRequirements: ["시계열 1개 이상"],
    params: [{ key: "sensitivity", label: "민감도", description: "높을수록 많이 탐지", range: "1~5", default: 3 }],
    howToRead: "빨간 점은 단발 이상, 주황 띠는 이상 구간입니다",
    caveats: ["이상은 평소와 다름이지 잘못됨이 아닙니다"],
    examples: ["실습실 온도 이상 탐지"],
    algorithm: "STL + robust z-score",
    references: ["Cleveland 1990"],
  },
};

export const CHECK_OK: CheckResult = { level: "OK", issues: [], stats: { points: 40_320, estimatedRawPoints: 40_320, missingRate: 0.012, qualityDistribution: { "0": 98, "1": 2 }, virtualPoints: 0, seriesCount: 1, effectiveResolution: "1m" }, limits: { maxPoints: 5_000_000, maxSeries: 50, timeoutSec: 300 } };
export const CHECK_WARN: CheckResult = { ...CHECK_OK, level: "WARN", issues: [{ code: "MISSING_RATE", severity: "WARN", message: "EM300-151547의 10/01~10/02 데이터가 없습니다" }], stats: { ...CHECK_OK.stats, missingRate: 0.15 } };
export const CHECK_FAIL: CheckResult = { ...CHECK_OK, level: "FAIL", issues: [{ code: "TOO_MANY_POINTS", severity: "FAIL", message: "포인트가 한도를 넘습니다", fix: { type: "SET_RESOLUTION", value: "1h" } }], stats: { ...CHECK_OK.stats, points: 6_000_000 } };

export const RUN_OK: Run = { runId: "128", analysisId: "17", status: "SUCCEEDED", trigger: "MANUAL", progress: 100, stage: "SAVE", periodFrom: "2026-09-20T00:00:00Z", periodTo: "2026-10-04T00:00:00Z", startedAt: "2026-10-04T00:00:00Z", finishedAt: "2026-10-04T00:00:12Z", templateVersion: "1.2.0" };

export const RESULT: RunWithResult = {
  run: RUN_OK,
  result: {
    summary: {
      headline: "최근 14일 중 이상 12건, 가장 큰 이상은 10/02 14:10 (점수 5.2)",
      level: "WARN",
      metrics: [
        { key: "anomalies", label: "이상 건수", value: 12, unit: null, level: "WARN" },
        { key: "maxScore", label: "최대 점수", value: 5.2, unit: null, level: "INFO" },
        { key: "meanTemp", label: "평균 온도", value: 22.4, unit: "℃", lower: 21.8, upper: 23, estimate: true },
      ],
    },
    charts: [
      { id: "series", type: "line", title: "온도 추이 + 이상 지점", series: [{ key: "t", label: "온도", data: [["2026-10-02T05:00:00Z", 22.1], ["2026-10-02T05:10:00Z", null], ["2026-10-02T05:20:00Z", 30.2]] }], markers: [{ x: "2026-10-02T05:20:00Z", y: 30.2, label: "5.2", severity: "HIGH" }], thresholds: [{ value: 28, label: "임계값" }] },
      { id: "cal", type: "calendar", title: "날짜별 군집", calendar: { days: [["2026-10-01", 1, 0], ["2026-10-02", 3, 1]] } },
    ],
    tables: [{ id: "anomalies", title: "이상 목록", columns: [{ key: "time", label: "시각", type: "datetime" }, { key: "seriesKey", label: "계열", type: "string" }, { key: "score", label: "점수", type: "number" }], rows: [{ time: "2026-10-02T05:20:00Z", seriesKey: "1042:temperature", score: 5.2 }] }],
    evidence: { threshold: 3, contributors: [{ seriesKey: "1042:temperature", weight: 0.7 }] },
    caveats: ["이상은 평소와 다름이지 잘못됨이 아닙니다"],
    provenance: { template: "anomaly-detect@1.2.0", bindings: [{ role: "target", sources: [{ kind: "DEVICE_METRIC", deviceId: "1042", metricKey: "temperature", label: "실습실 EM300 · temperature" }] }], period: { from: "2026-09-20T00:00:00Z", to: "2026-10-04T00:00:00Z" }, resolution: "1m", points: 40_320, missingRate: 0.012, qualityFilter: "NORMAL_ONLY", virtual: false, seed: 128734, algorithm: "STL + robust z-score" },
    aiCommentaryId: null,
    expiresAt: "2027-10-04T00:00:00Z",
  },
};

export const MODELS: ModelItem[] = [
  { modelId: "301", analysisId: "17", analysisName: "실습실 온도 이상 탐지", templateKey: "anomaly-detect", version: 3, status: "ACTIVE", trainFrom: "2026-08-01T00:00:00Z", trainTo: "2026-09-30T00:00:00Z", metrics: { mae: 0.41, precision: null }, trainedAt: "2026-10-01T00:00:00Z", drift: true },
  { modelId: "302", analysisId: "17", analysisName: "실습실 온도 이상 탐지", templateKey: "anomaly-detect", version: 4, status: "CANDIDATE", trainFrom: "2026-08-15T00:00:00Z", trainTo: "2026-10-03T00:00:00Z", metrics: { mae: 0.38 }, trainedAt: "2026-10-04T00:00:00Z" },
];

export function fakeAnalyticsApi(overrides: Partial<AnalyticsApi> = {}): AnalyticsApi {
  return {
    listTemplates: vi.fn(async () => ok({ responses: TEMPLATES })),
    getTemplate: vi.fn(async () => ok(ANOMALY)),
    candidates: vi.fn(async () => ok({ responses: [{ kind: "DEVICE_METRIC" as const, deviceId: "1042", metricKey: "temperature", label: "실습실 EM300 · temperature", semantic: "temperature", unit: "℃" }] })),
    check: vi.fn(async () => ok(CHECK_OK)),
    createAnalysis: vi.fn(async (body: unknown) => ok({ ...(body as object), analysisId: "17", name: "x", templateKey: "anomaly-detect" }, 201)),
    listAnalyses: vi.fn(async () => ok({ responses: [] })),
    deleteAnalysis: vi.fn(async () => ok(undefined, 204)),
    runAnalysis: vi.fn(async () => ok({ runId: "129", status: "QUEUED", queuePosition: 1 }, 202)),
    getRun: vi.fn(async () => ok(RESULT)),
    listRuns: vi.fn(async () => ok({ responses: [RUN_OK] })),
    cancelRun: vi.fn(async () => ok({ ...RUN_OK, status: "CANCELLED" as const })),
    compare: vi.fn(async () => ok({ metrics: [{ key: "anomalies", base: 8, target: 12, diff: 4.2, diffPct: 6, direction: "UP" }], versionMismatch: false, charts: [] })),
    exportRun: vi.fn(async () => ok({ exportJobId: "77" }, 202)),
    feedback: vi.fn(async () => ok({ feedbackId: "1" }, 201)),
    listModels: vi.fn(async () => ok({ responses: MODELS })),
    activateModel: vi.fn(async () => ok({ modelId: "302", status: "ACTIVE" })),
    trainModel: vi.fn(async () => ok({ modelId: "303", version: 5 }, 202)),
    listDashboards: vi.fn(async () => ok([{ id: "5", name: "실습실 현황" }])),
    pin: vi.fn(async () => ok({ dashboardId: "5", widgetId: "analysis-17", version: 3 })),
    ...overrides,
  } as AnalyticsApi;
}
