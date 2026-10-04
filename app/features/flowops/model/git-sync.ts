/**
 * UI-FLW-20 Git 동기화(FLW-11.04, API-FLW-67~69, BR-FLW-35): 설정 검증, 가져오기 미리보기·충돌 해결.
 */
export const GIT_TARGETS = ["FLOW", "SOURCE", "SCRIPT", "RULE"] as const;
export const GIT_AUTH_TYPES = ["SSH_KEY", "HTTPS_TOKEN"] as const;

export interface GitSyncSettings {
  repoUrl: string;
  branch: string;
  path: string;
  auth: { type: (typeof GIT_AUTH_TYPES)[number]; credentialRef: string };
  targets: string[];
  version?: number;
  updatedBy?: { userId: string; name: string };
  updatedAt?: string;
}

export interface GitSyncErrors {
  repoUrl?: "required" | "invalid";
  branch?: "required" | "tooLong";
  path?: "tooLong";
  credentialRef?: "required";
}

export function readGitSyncForm(form: FormData): GitSyncSettings {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const authType = text("authType");
  return {
    repoUrl: text("repoUrl"),
    branch: text("branch"),
    path: text("path") || "/",
    auth: { type: (GIT_AUTH_TYPES as readonly string[]).includes(authType) ? (authType as GitSyncSettings["auth"]["type"]) : "SSH_KEY", credentialRef: text("credentialRef") },
    targets: form.getAll("targets").filter((v): v is string => typeof v === "string" && (GIT_TARGETS as readonly string[]).includes(v)),
  };
}

/** UI-FLW-20 입력 검증: 저장소 URL은 https:// 또는 ssh://, 브랜치 1~100자 */
export function validateGitSync(settings: GitSyncSettings): GitSyncErrors {
  const errors: GitSyncErrors = {};
  if (!settings.repoUrl) errors.repoUrl = "required";
  else if (!/^(https|ssh):\/\/[^\s]+$/.test(settings.repoUrl) || settings.repoUrl.length > 500) errors.repoUrl = "invalid";
  if (!settings.branch) errors.branch = "required";
  else if (settings.branch.length > 100) errors.branch = "tooLong";
  if (settings.path.length > 200) errors.path = "tooLong";
  if (!settings.auth.credentialRef) errors.credentialRef = "required";
  return errors;
}

export interface ImportPreview {
  changes: { objectKey: string; kind: "CREATE" | "UPDATE"; summary: string }[];
  conflicts: { objectKey: string; platformUpdatedAt?: string; gitCommit?: string }[];
  errors: { file: string; line?: number | null; code: string }[];
}

export function normalizeImport(response: unknown): ImportPreview {
  const raw = (response ?? {}) as Partial<ImportPreview>;
  return { changes: raw.changes ?? [], conflicts: raw.conflicts ?? [], errors: raw.errors ?? [] };
}

/** 충돌마다 고른 쪽(`resolve.{objectKey}` = PLATFORM|GIT). 하나라도 고르지 않았으면 `missing`에 남는다 */
export function readResolutions(form: FormData, conflictKeys: string[]) {
  const resolutions: { objectKey: string; choose: "PLATFORM" | "GIT" }[] = [];
  const missing: string[] = [];
  for (const key of conflictKeys) {
    const value = form.get(`resolve.${key}`);
    if (value === "PLATFORM" || value === "GIT") resolutions.push({ objectKey: key, choose: value });
    else missing.push(key);
  }
  return { resolutions, missing };
}

export function validateCommitMessage(message: string): "required" | "tooLong" | undefined {
  const m = message.trim();
  if (!m) return "required";
  if (m.length > 200) return "tooLong";
  return undefined;
}
