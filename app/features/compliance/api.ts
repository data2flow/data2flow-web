/**
 * 준수 리포트 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`): 파일 서명 링크 API-CMP-19, 해시 검증 API-CMP-20.
 * 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 */
import { bffFetch, bffJson, type BffJsonResult } from "~/lib/bff-client";
import type { FileKind, FileLink, VerifyResult } from "./model/reports";

export interface ReportsApi {
  /** API-CMP-19 */
  fileLink(reportId: string, revisionNo: number, kind: FileKind): Promise<BffJsonResult<FileLink>>;
  /** API-CMP-20(multipart file) */
  verifyHash(file: File): Promise<BffJsonResult<VerifyResult>>;
}

const enc = encodeURIComponent;

export const defaultReportsApi: ReportsApi = {
  fileLink: (reportId, revisionNo, kind) => bffJson(`/bff/api/core/compliance/reports/${enc(reportId)}/revisions/${revisionNo}/files/${kind}`),
  verifyHash: async (file) => {
    const form = new FormData();
    form.set("file", file);
    let response: Response;
    try {
      response = await bffFetch("/bff/api/core/compliance/reports/verify-hash", { method: "POST", body: form, headers: { Accept: "application/json" } });
    } catch {
      return { ok: false, status: 0, code: "SERVICE_UNAVAILABLE", message: "" };
    }
    const body = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; response?: VerifyResult; errors?: { field: string; code: string; message: string }[] } | null;
    if (response.ok && body?.response) return { ok: true, status: response.status, data: body.response };
    return { ok: false, status: response.status, code: body?.header?.resultCode ?? "UNKNOWN", message: body?.header?.resultMessage ?? "", errors: body?.errors };
  },
};
