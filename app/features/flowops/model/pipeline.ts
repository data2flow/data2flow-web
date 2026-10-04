/**
 * UI-FLW-19 승격 파이프라인(FLW-11.03, API-FLW-64~66, BR-FLW-31)과 UI-FLW-13 승격 대상 매핑(FLW-09.01~09.03, API-FLW-19, BR-FLW-23).
 */
export const STAGE_ENVS = ["TEST", "VERIFY", "PROD"] as const;
export type StageEnv = (typeof STAGE_ENVS)[number];
export const APPROVER_ROLES = ["ADMIN", "INTEGRATOR", "OPERATOR"] as const;
export const STAGES_MIN = 2;
export const STAGES_MAX = 5;

export interface StageChecks {
  testRunRequired: boolean;
  replayDays: number;
  maxCommands: number;
  maxNotifications: number;
}

export interface Stage {
  key: string;
  env: StageEnv;
  approvers: { userIds: string[]; roles: string[] };
  checks: StageChecks;
}

export interface Pipeline {
  pipelineId: string;
  name: string;
  stages: Stage[];
  version: number;
  updatedAt?: string;
}

export type PromotionStatus = "PENDING" | "CHECK_FAILED" | "APPROVED" | "REJECTED" | "APPLIED";

export interface Promotion {
  promotionId: string;
  pipelineId?: string;
  snapshotId: string;
  snapshotName?: string;
  fromStage: string;
  toStage: string;
  status: PromotionStatus;
  checks?: { name: string; passed: boolean; detail?: string | null }[];
  targetMappings?: { from: string; to: string }[];
  requestedBy?: { userId: string; name: string };
  requestedAt?: string;
  decidedBy?: { userId: string; name: string } | null;
  decidedAt?: string | null;
}

export interface StageError {
  key?: "required" | "invalid" | "duplicated";
  checks?: "range";
}

export interface PipelineErrors {
  name?: "required" | "tooLong";
  stages?: "count";
  stageErrors?: StageError[];
}

const nonNegInt = (n: number) => Number.isInteger(n) && n >= 0;

/** 파이프라인 정의 검증(API-FLW-64: 이름 1~80자, 단계 2~5개, 단계 키 고유) */
export function validatePipeline(input: { name: string; stages: Stage[] }): PipelineErrors {
  const errors: PipelineErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "required";
  else if (name.length > 80) errors.name = "tooLong";
  if (input.stages.length < STAGES_MIN || input.stages.length > STAGES_MAX) errors.stages = "count";
  const seen = new Set<string>();
  const stageErrors = input.stages.map((stage) => {
    const e: StageError = {};
    if (!stage.key) e.key = "required";
    else if (!/^[a-z][a-z0-9-]{0,29}$/.test(stage.key)) e.key = "invalid";
    else if (seen.has(stage.key)) e.key = "duplicated";
    seen.add(stage.key);
    const c = stage.checks;
    if (!nonNegInt(c.replayDays) || c.replayDays > 7 || !nonNegInt(c.maxCommands) || !nonNegInt(c.maxNotifications)) e.checks = "range";
    return e;
  });
  if (stageErrors.some((e) => e.key || e.checks)) errors.stageErrors = stageErrors;
  return errors;
}

export function hasPipelineErrors(errors: PipelineErrors): boolean {
  return Boolean(errors.name || errors.stages || errors.stageErrors);
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};
const int = (form: FormData, name: string) => {
  const raw = text(form, name);
  return raw === "" ? 0 : Number(raw);
};

/**
 * 정의 폼 읽기. 단계 i의 필드는 `stage.{i}.key`·`.env`·`.roles`(여러 값)·`.userIds`(쉼표)·`.testRunRequired`·`.replayDays`·`.maxCommands`·`.maxNotifications`.
 * 키가 비어 있고 다른 값도 없는 줄(빈 추가 줄)은 버린다.
 */
export function readPipelineForm(form: FormData): { name: string; stages: Stage[] } {
  const stages: Stage[] = [];
  for (let i = 0; i < STAGES_MAX + 1; i += 1) {
    const prefix = `stage.${i}.`;
    if (!form.has(`${prefix}key`)) continue;
    const key = text(form, `${prefix}key`);
    if (!key && !form.get(`${prefix}keep`)) continue;
    const rawEnv = text(form, `${prefix}env`);
    stages.push({
      key,
      env: (STAGE_ENVS as readonly string[]).includes(rawEnv) ? (rawEnv as StageEnv) : "TEST",
      approvers: {
        roles: form.getAll(`${prefix}roles`).filter((r): r is string => typeof r === "string" && (APPROVER_ROLES as readonly string[]).includes(r)),
        userIds: text(form, `${prefix}userIds`).split(",").map((s) => s.trim()).filter(Boolean),
      },
      checks: {
        testRunRequired: form.get(`${prefix}testRunRequired`) === "on",
        replayDays: int(form, `${prefix}replayDays`),
        maxCommands: int(form, `${prefix}maxCommands`),
        maxNotifications: int(form, `${prefix}maxNotifications`),
      },
    });
  }
  return { name: text(form, "name"), stages };
}

/** 새 파이프라인 기본값: 시험 → 검증 → 운영(운영 승인 ADMIN, 재생 제어 ≤ 50) — UI-FLW-19 와이어프레임 */
export function defaultPipeline(): { name: string; stages: Stage[] } {
  const checks = (maxCommands: number): StageChecks => ({ testRunRequired: true, replayDays: 1, maxCommands, maxNotifications: 20 });
  return {
    name: "",
    stages: [
      { key: "test", env: "TEST", approvers: { userIds: [], roles: [] }, checks: { testRunRequired: false, replayDays: 0, maxCommands: 0, maxNotifications: 0 } },
      { key: "verify", env: "VERIFY", approvers: { userIds: [], roles: ["ADMIN"] }, checks: checks(100) },
      { key: "prod", env: "PROD", approvers: { userIds: [], roles: ["ADMIN"] }, checks: checks(50) },
    ],
  };
}

/** 단계 키 다음 단계(승격은 바로 다음 단계로만) */
export function nextStage(pipeline: Pick<Pipeline, "stages">, from: string): string | undefined {
  const index = pipeline.stages.findIndex((s) => s.key === from);
  return index >= 0 ? pipeline.stages[index + 1]?.key : undefined;
}

/**
 * 승인 버튼을 쓸 수 있는지(BR-FLW-31): PENDING이고, 요청자 본인이 아니고, 자동 검사를 모두 통과했을 때.
 * 서버가 다시 막는다(FLOW_PROMOTION_SELF_APPROVAL 403, CHECK_FAILED는 FLOW_STATE_CONFLICT 409).
 */
export function approvalBlock(promotion: Promotion, meId: string | undefined): "self" | "checkFailed" | "notPending" | undefined {
  if (promotion.status === "CHECK_FAILED" || (promotion.checks ?? []).some((c) => !c.passed)) return "checkFailed";
  if (promotion.status !== "PENDING") return "notPending";
  if (meId && promotion.requestedBy?.userId === meId) return "self";
  return undefined;
}

export function failedChecks(promotion: Promotion) {
  return (promotion.checks ?? []).filter((c) => !c.passed);
}
