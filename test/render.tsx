/**
 * 화면 부품 렌더 도우미(frontend.md §3.3 renderRoute). root 로더 데이터(세션 역할·CSRF)를 심어 라우터 안에서 그린다.
 */
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { Outlet, createRoutesStub } from "react-router";
import { createI18n, type Language } from "~/i18n";
import type { Me } from "~/lib/api-types";

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ["IAM_MANAGE", "AUDIT_READ", "OPS_MANAGE", "DEV_READ"],
  OPERATOR: ["DEV_READ", "DEVICE_CONTROL"],
  VIEWER: ["DEV_READ"],
};

export function meOf(role: string, extra: Partial<Me> = {}): Me {
  return { id: "7", loginId: "kim.op", name: "김운영", role, permissions: ROLE_PERMISSIONS[role] ?? [], version: 1, ...extra };
}

export async function renderRoute(element: ReactElement, options: { path?: string; url?: string; session?: Me | null; lang?: Language } = {}) {
  const lang = options.lang ?? "ko";
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      Component: Outlet,
      loader: () => ({ lang, csrfToken: "csrf-test-token", authenticated: Boolean(options.session), me: options.session ?? null, timezone: "Asia/Seoul", publicOrigin: "https://data2flow.java21.net" }),
      children: !options.path || options.path === "/" ? [{ index: true, Component: () => element }] : [{ path: options.path.replace(/^\//, ""), Component: () => element }],
    },
  ]);
  const result = render(
    <I18nextProvider i18n={createI18n(lang)}>
      <Stub initialEntries={[options.url ?? options.path ?? "/"]} />
    </I18nextProvider>,
  );
  return result;
}
