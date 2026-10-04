/**
 * 알림 화면이 브라우저에서 부르는 API(BFF `/bff/api/core/**`). 화면 부품은 이 묶음을 받아 쓰고, 테스트는 가짜 묶음을 넣는다.
 * - 메신저 계정 연결 API-RUL-30: 일회용 코드 받기·연결 해제·상태 확인
 * - 템플릿 미리 보기 API-RUL-22
 */
import { bffJson, type BffJsonResult } from "~/lib/bff-client";

export interface LinkStart {
  code: string;
  deepLink: string;
  expiresAt: string;
}

export interface MessengerLink {
  channel: string;
  linkedAt?: string | null;
}

export interface NotifyApi {
  startLink(channel: string): Promise<BffJsonResult<LinkStart>>;
  unlink(channel: string): Promise<BffJsonResult<void>>;
  /** 연결 상태(문서에 조회 API가 없어 목록 조회를 가정한다 — 실패하면 화면은 "확인하지 못함") */
  links(): Promise<BffJsonResult<{ responses: MessengerLink[] } | MessengerLink[]>>;
  previewTemplate(templateId: string, alarmId: string): Promise<BffJsonResult<{ subject?: string | null; body: string }>>;
}

const base = "/bff/api/core";

export const notifyApi: NotifyApi = {
  startLink: (channel) => bffJson(`${base}/accounts/me/messenger-links/start`, { method: "POST", body: { channel } }),
  unlink: (channel) => bffJson(`${base}/accounts/me/messenger-links/${encodeURIComponent(channel)}`, { method: "DELETE" }),
  links: () => bffJson(`${base}/accounts/me/messenger-links`),
  previewTemplate: (id, alarmId) => bffJson(`${base}/notification-templates/${encodeURIComponent(id)}/preview`, { method: "POST", body: { alarmId } }),
};
