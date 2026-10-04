/**
 * UI-IAM-04 내 정보 탭 틀(IAM-01.09). 임시 비밀번호 상태면 보안 탭만 연다.
 * 알림 수신 탭(OPS-06.05, UI-RUL-11)은 M4. API 토큰(IAM-05, M6) 탭은 해당 마일스톤에서 추가한다.
 */
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useRouteLoaderData } from "react-router";
import { PageHeader, Tabs } from "~/components/ui";
import type { RootData } from "~/root";

const TABS = ["profile", "security", "notifications", "sessions"] as const;

export default function MeLayout() {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const location = useLocation();
  const current = TABS.find((tab) => location.pathname.startsWith(`/me/${tab}`)) ?? "profile";
  const locked = !root?.me || Boolean(root.me.mustChangePassword);
  const tabs = (locked ? ["security"] : TABS).map((key) => ({ key, label: t(`me.tabs.${key}`), to: `/me/${key}` }));
  return (
    <>
      <PageHeader title={t("me.title")} />
      <Tabs items={tabs} current={current} />
      <Outlet />
    </>
  );
}
