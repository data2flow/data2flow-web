/**
 * 모니터링 커버리지 점검(API-CMP-25, UI-CMP-11) 응답 모양. core-api CoverageDtos와 같다. 결측률·비정상 비율은 %다.
 */
export type Signal = "GREEN" | "YELLOW" | "RED" | "NA";
export type CalibrationStatus = "OK" | "DUE_SOON" | "OVERDUE" | "NO_RECORD";

export interface Ref {
  id: string;
  name: string;
}

export interface DensityRow {
  space: Ref;
  usage?: string | null;
  areaM2?: number | null;
  required?: number | null;
  actual: number;
  shortage?: number | null;
  undeterminedReason?: string | null;
}

export interface PublicDisplay {
  scopeAreaM2: number;
  required: number;
  actual: { links: number; qr: number };
  shortage: number;
  actualAvailable: boolean;
  recommendations: { spaceId: string; name: string; areaM2: number }[];
}

export interface CalibrationRow {
  device: Ref;
  space?: Ref | null;
  model?: string | null;
  intervalDays: number;
  lastCalibratedOn?: string | null;
  dueOn?: string | null;
  elapsedDays?: number | null;
  status: CalibrationStatus;
}

export interface QualityRow {
  space: Ref;
  devices: number;
  missingRatio?: number | null;
  intervalViolations: number;
  abnormalQualityRatio?: number | null;
  belowStandard: boolean;
}

export interface Coverage {
  siteId: string;
  profile?: { profileId: string; name: string; versionNo: number } | null;
  period: { from: string; to: string };
  summary: { density: Signal; publicDisplay: Signal; calibration: Signal; quality: Signal };
  density: DensityRow[];
  publicDisplay?: PublicDisplay | null;
  calibration: CalibrationRow[];
  quality: QualityRow[];
}

export function signalTone(signal: Signal): "success" | "warning" | "danger" | "neutral" {
  return signal === "GREEN" ? "success" : signal === "YELLOW" ? "warning" : signal === "RED" ? "danger" : "neutral";
}

export function calibrationTone(status: CalibrationStatus): "success" | "warning" | "danger" | "neutral" {
  return status === "OK" ? "success" : status === "DUE_SOON" ? "warning" : status === "OVERDUE" ? "danger" : "neutral";
}

/** 신호등 요약 문구 값: 설치 밀도 부족 공간 수, 공개 표시 부족 수, 교정 초과 대수, 품질 미달 공간 수 */
export function summaryCounts(c: Coverage) {
  return {
    density: c.density.filter((r) => (r.shortage ?? 0) > 0).length,
    publicDisplay: c.publicDisplay?.shortage ?? 0,
    calibration: c.calibration.filter((r) => r.status === "OVERDUE").length,
    quality: c.quality.filter((r) => r.belowStandard).length,
  };
}
