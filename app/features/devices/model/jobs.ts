/**
 * UI-DEV-12 일괄 작업 화면 모델(DEV-02.09, API-DEV-70~74, BR-DEV-20·25).
 * 작업 인자(params) 모양은 DEV-api에 "유형별 인자"로만 적혀 있어, 각 단건 API의 본문 이름을 그대로 쓴다
 * (SET_MODEL {modelId}, SET_SPACE {spaceId}, SET_STATUS {status}, ADD_TAGS·REMOVE_TAGS {tags}, SET_ATTRIBUTES {scope, attributes}, SEND_COMMAND {capability, command, args}).
 */

export const JOB_TYPES = ["SET_MODEL", "SET_SPACE", "SET_STATUS", "ADD_TAGS", "REMOVE_TAGS", "SET_ATTRIBUTES", "SEND_COMMAND"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIALLY_FAILED" | "FAILED" | "CANCELLED";

export const JOB_TARGET_LIMIT = 5000;

export interface DeviceJobSummary {
  id: string;
  type: JobType | string;
  status: JobStatus | string;
  total: number;
  succeeded: number;
  failed: number;
  createdBy?: string | { userId: string; name?: string } | null;
  createdAt?: string | null;
  finishedAt?: string | null;
}

export interface DeviceJob extends DeviceJobSummary {
  target?: unknown;
  params?: Record<string, unknown> | null;
  progressPercent?: number | null;
  retryOfJobId?: string | null;
  startedAt?: string | null;
}

export interface DeviceJobItem {
  id: string;
  deviceId: string;
  deviceName?: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | string;
  errorCode?: string | null;
  errorMessage?: string | null;
  finishedAt?: string | null;
  /** SEND_COMMAND면 기기별 명령 ID(AT-DEV-14.3). 문서 모양에는 없어 있으면 쓴다 */
  commandId?: string | null;
}

export interface JobForm {
  type: JobType;
  modelId: string;
  spaceId: string;
  status: "ACTIVE" | "INACTIVE";
  tags: string;
  attrScope: "SERVER" | "SHARED";
  attributes: string;
  capability: string;
  command: string;
  args: string;
}

export function emptyJobForm(): JobForm {
  return { type: "SET_SPACE", modelId: "", spaceId: "", status: "INACTIVE", tags: "", attrScope: "SERVER", attributes: "{}", capability: "", command: "set", args: "{}" };
}

const parseObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

export const splitTags = (text: string) =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** 마법사 검사: 대상 1~5,000대(BR-DEV-20), 유형별 필수 값 */
export function jobProblems(form: JobForm, targetCount: number): string[] {
  const problems: string[] = [];
  if (targetCount < 1) problems.push("targetEmpty");
  if (targetCount > JOB_TARGET_LIMIT) problems.push("targetLimit");
  switch (form.type) {
    case "SET_MODEL":
      if (!form.modelId) problems.push("modelId");
      break;
    case "SET_SPACE":
      if (!form.spaceId) problems.push("spaceId");
      break;
    case "ADD_TAGS":
    case "REMOVE_TAGS":
      if (splitTags(form.tags).length === 0) problems.push("tags");
      break;
    case "SET_ATTRIBUTES": {
      const attrs = parseObject(form.attributes);
      if (!attrs || Object.keys(attrs).length === 0) problems.push("attributes");
      break;
    }
    case "SEND_COMMAND":
      if (!form.capability.trim() || !form.command.trim()) problems.push("command");
      if (!parseObject(form.args)) problems.push("args");
      break;
  }
  return problems;
}

export function jobParams(form: JobForm): Record<string, unknown> {
  switch (form.type) {
    case "SET_MODEL":
      return { modelId: form.modelId };
    case "SET_SPACE":
      return { spaceId: form.spaceId };
    case "SET_STATUS":
      return { status: form.status };
    case "ADD_TAGS":
    case "REMOVE_TAGS":
      return { tags: splitTags(form.tags) };
    case "SET_ATTRIBUTES":
      return { scope: form.attrScope, attributes: parseObject(form.attributes) ?? {} };
    case "SEND_COMMAND":
      return { capability: form.capability.trim(), command: form.command.trim(), args: parseObject(form.args) ?? {} };
  }
}

export function isRunning(status: string): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

export function jobPercent(job: Pick<DeviceJob, "total" | "succeeded" | "failed" | "progressPercent">): number {
  if (typeof job.progressPercent === "number") return Math.max(0, Math.min(100, job.progressPercent));
  return job.total > 0 ? Math.round(((job.succeeded + job.failed) / job.total) * 100) : 0;
}

export function jobTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "COMPLETED") return "success";
  if (status === "PARTIALLY_FAILED") return "warning";
  if (status === "FAILED") return "danger";
  if (isRunning(status)) return "info";
  return "neutral";
}

export function creatorName(createdBy: DeviceJobSummary["createdBy"]): string {
  if (!createdBy) return "–";
  return typeof createdBy === "string" ? createdBy : (createdBy.name ?? createdBy.userId);
}

/** `?deviceIds=a,b` → 대상 기기 목록(중복 제거) */
export function parseDeviceIds(raw: string | null | undefined): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
