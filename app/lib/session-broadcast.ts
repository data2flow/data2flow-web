/**
 * 탭 사이 로그아웃 알림(design/auth.md §9.2, UI-IAM-13). 한 탭에서 세션이 끝나면 다른 탭도 로그인 화면으로 보낸다.
 */
export const SESSION_CHANNEL = "data2flow-session";

export interface SessionMessage {
  type: "logout";
  reason?: string;
}

type ChannelFactory = (name: string) => Pick<BroadcastChannel, "postMessage" | "close"> & {
  onmessage: ((event: MessageEvent) => void) | null;
};

const defaultFactory: ChannelFactory | undefined =
  typeof BroadcastChannel === "undefined" ? undefined : (name) => new BroadcastChannel(name);

export function announceLogout(reason?: string, factory: ChannelFactory | undefined = defaultFactory) {
  if (!factory) return;
  const channel = factory(SESSION_CHANNEL);
  channel.postMessage({ type: "logout", reason } satisfies SessionMessage);
  channel.close();
}

export function onLogout(handler: (message: SessionMessage) => void, factory: ChannelFactory | undefined = defaultFactory): () => void {
  if (!factory) return () => {};
  const channel = factory(SESSION_CHANNEL);
  channel.onmessage = (event) => {
    const message = event.data as SessionMessage | undefined;
    if (message?.type === "logout") handler(message);
  };
  return () => channel.close();
}
