/**
 * 가입 신청 허용 여부(IAM-01.08). 로그인 전 화면이 core 공개 API(API-IAM-74 `GET /api/v1/core/public/signup-settings`)로
 * 조직 설정 `signupRequestEnabled`를 읽는다. gateway·core가 응답하지 않으면 배포 설정
 * `DATA2FLOW_SIGNUP_REQUEST_ENABLED`(기본 false)로 대신한다.
 */
import { callApi } from "./api.server";
import type { BffRequestContext } from "./middleware.server";

export const SIGNUP_SETTINGS_PATH = "/api/v1/core/public/signup-settings";

export async function signupRequestEnabled(ctx: BffRequestContext, request: Request): Promise<boolean> {
  try {
    const result = await callApi<{ signupRequestEnabled?: boolean }>(ctx, request, SIGNUP_SETTINGS_PATH, { anonymous: true, noGuards: true });
    if (result.ok) return result.data?.signupRequestEnabled === true;
  } catch {
    // 아래 대체값으로
  }
  return ctx.runtime.config.signupRequestEnabled;
}
