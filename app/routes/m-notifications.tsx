/**
 * UI-DSH-14 내 알림 탭(`/m/notifications`): 이 연결에서 받은 본인 웹 알림(API-DSH-20 `notifications`). 수신 설정은 내 정보 > 알림 수신.
 */
import { useRouteLoaderData } from "react-router";
import { MobileNotifications } from "~/features/field/components/mobile";
import type { RootData } from "~/root";

export default function MobileNotificationsRoute() {
  const root = useRouteLoaderData("root") as RootData | undefined;
  return <MobileNotifications timezone={root?.timezone ?? "Asia/Seoul"} />;
}
