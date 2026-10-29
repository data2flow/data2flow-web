/** 환경 기준 프로필·적용(API-CMP-01~09) 응답 모양. core-api ComplianceDtos와 같다 */

export const EVAL_WINDOWS = ["INSTANT", "HOUR_1", "HOUR_8", "DAY_1"] as const;
export const REQUIREMENTS = ["LIMIT", "CONTINUOUS_MONITORING_ONLY", "RECOMMENDED"] as const;
export const TARGET_TYPES = ["SPACE", "SITE", "SPACE_USAGE"] as const;
export type EvalWindow = (typeof EVAL_WINDOWS)[number];
export type Requirement = (typeof REQUIREMENTS)[number];

export interface UserRef {
  userId: string;
  name: string;
}

export interface Band {
  name: string;
  lower?: number | null;
  upper?: number | null;
  isBase: boolean;
}

export interface MetricCriterion {
  metricKey: string;
  facilityType?: string | null;
  evalWindow: EvalWindow | string;
  lower?: number | null;
  upper?: number | null;
  /** 경계값을 충족으로 보는가(이하·이상 true, 미만·초과 false) */
  inclusive: boolean;
  unit: string;
  requirement: Requirement | string;
  note?: string | null;
  bands: Band[];
}

export interface Coverage {
  kind: string;
  params: Record<string, unknown>;
}

export interface ProfileVersion {
  versionNo: number;
  sourceTitle: string;
  sourceUrl?: string | null;
  effectiveDate: string;
  description?: string | null;
  streak?: { days?: number | null; dailyRatio?: number | null } | null;
  facilityTypeRequired: boolean;
  facilityTypes: string[];
  changeNote?: string | null;
  locked: boolean;
  metrics: MetricCriterion[];
  coverage: Coverage[];
  createdBy?: UserRef | null;
  createdAt: string;
}

export interface ProfileSummary {
  profileId: string;
  kind: "SYSTEM" | "ORGANIZATION";
  code?: string | null;
  name: string;
  archived: boolean;
  currentVersionNo: number;
  sourceTitle: string;
  effectiveDate: string;
  applicationCount: number;
  updatedAt: string;
}

export interface ApplicationRef {
  applicationId: string;
  targetType: string;
  targetSpaceId?: string | null;
  targetUsage?: string | null;
}

export interface ProfileDetail extends Omit<ProfileSummary, "sourceTitle" | "effectiveDate" | "applicationCount"> {
  currentVersion: ProfileVersion;
  applications: ApplicationRef[];
  version: number;
}

export interface VersionSummary {
  versionNo: number;
  changeNote?: string | null;
  createdBy?: UserRef | null;
  createdAt: string;
  locked: boolean;
  usage: { applications: number; reports: number };
}

export interface Application {
  applicationId: string;
  profileId: string;
  profileName: string;
  pinnedVersionNo?: number | null;
  versionNo: number;
  targetType: string;
  targetSpaceId?: string | null;
  targetName?: string | null;
  targetUsage?: string | null;
  includeDescendants: boolean;
  facilityType?: string | null;
  appliedBy?: UserRef | null;
  appliedAt: string;
  measurability: { measurable: number; partial: number; unmeasurable: number };
}

export interface MeasurabilityItem {
  metricKey: string;
  status: "MEASURABLE" | "PARTIAL" | "NOT_MEASURABLE";
  reason?: string | null;
  spacesWithout?: { id: string; name: string }[];
  devices?: { id: string; name: string }[];
}
